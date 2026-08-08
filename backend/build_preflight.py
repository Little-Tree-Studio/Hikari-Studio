from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


BuildIssue = dict[str, Any]


class BuildPreflightError(RuntimeError):
    def __init__(self, report: dict[str, Any]) -> None:
        self.report = report
        super().__init__(f"Build blocked by {report['errors']} preflight error(s)")


def _issue(
    severity: str,
    category: str,
    code: str,
    message: str,
    **location: Any,
) -> BuildIssue:
    return {
        "severity": severity,
        "blocking": severity == "error",
        "category": category,
        "code": code,
        "message": message,
        "source": "desktop",
        **{key: value for key, value in location.items() if value is not None},
    }


def _enabled_fragments(project: dict[str, Any]) -> set[str]:
    return {
        str(fragment.get("id"))
        for chapter in project.get("chapters", [])
        if not chapter.get("disabled")
        for fragment in chapter.get("fragments", [])
        if fragment.get("id")
    }


def _targets(block: dict[str, Any]) -> list[str]:
    block_type = block.get("type")
    if block_type == "branch":
        return [str(option.get("target")) for option in block.get("options", []) if option.get("target")]
    if block_type == "condition":
        return [str(target) for target in (block.get("trueTarget"), block.get("falseTarget")) if target]
    if block_type in {"jump", "call"} and block.get("target"):
        return [str(block["target"])]
    return []


def _asset_references(project: dict[str, Any], enabled: set[str]) -> list[tuple[str, dict[str, Any]]]:
    references: list[tuple[str, dict[str, Any]]] = []

    def add(asset_id: Any, **location: Any) -> None:
        if asset_id:
            references.append((str(asset_id), location))

    assets = project.get("assets", [])
    by_id = {str(asset.get("id")): asset for asset in assets if asset.get("id")}
    by_name: dict[str, dict[str, Any]] = {}
    for asset in assets:
        for value in (asset.get("name"), Path(str(asset.get("path", ""))).name):
            if value:
                by_name[str(value)] = asset

    title = project.get("ui", {}).get("title", {})
    add(title.get("backgroundAssetId"), relatedId="ui-title", detail="标题背景")
    add(title.get("logoAssetId"), relatedId="ui-title", detail="标题 Logo")
    add(project.get("ui", {}).get("runtimeTheme", {}).get("fontAssetId"), relatedId="ui-theme", detail="对白字体")
    for character in project.get("characters", []):
        for expression, asset_id in character.get("portraits", {}).items():
            add(asset_id, relatedId=character.get("id"), detail=f"角色表情：{expression}")
        for overlay in character.get("overlays", []):
            add(overlay.get("assetId"), relatedId=character.get("id"), detail=f"角色覆盖：{overlay.get('name', '')}")
    scenes = {str(scene.get("id")): scene for scene in project.get("scenes", []) if scene.get("id")}
    for fragment_id, blocks in project.get("scripts", {}).items():
        if fragment_id not in enabled:
            continue
        for block_index, block in enumerate(blocks):
            location = {"fragmentId": fragment_id, "blockId": block.get("id"), "blockIndex": block_index}
            add(block.get("assetId"), **location)
            scene = scenes.get(str(block.get("sceneId", "")))
            for layer in scene.get("layers", []) if scene else []:
                add(layer.get("assetId"), **location)
            for layer in block.get("layers", []):
                add(layer.get("assetId"), **location)
            voice = str(block.get("voice", ""))
            if voice:
                asset = by_id.get(voice) or by_name.get(voice)
                add(asset.get("id") if asset else voice, **location)
    for fragment_id, timeline in project.get("timelines", {}).items():
        if fragment_id not in enabled:
            continue
        for track in timeline.get("tracks", []):
            for clip in track.get("clips", []):
                add(clip.get("assetId"), fragmentId=fragment_id, blockId=clip.get("blockId"), relatedId=clip.get("id"), detail="时间轴片段")
    for asset in assets:
        if asset.get("forceBundle"):
            add(asset.get("id"), relatedId=asset.get("id"), detail="强制打包")
    return references


def _asset_source(asset: dict[str, Any], builtin_assets: Path, custom_assets: Path) -> Path | None:
    path_value = str(asset.get("path", ""))
    if not path_value:
        return None
    name = Path(path_value).name
    if path_value.startswith("builtin/") or (path_value.startswith("assets/") and (builtin_assets / name).is_file()):
        return builtin_assets / name
    return custom_assets / name


def _strongly_connected(graph: dict[str, set[str]]) -> list[set[str]]:
    index = 0
    indices: dict[str, int] = {}
    lowlinks: dict[str, int] = {}
    stack: list[str] = []
    stacked: set[str] = set()
    components: list[set[str]] = []

    def visit(node: str) -> None:
        nonlocal index
        indices[node] = lowlinks[node] = index
        index += 1
        stack.append(node)
        stacked.add(node)
        for target in graph.get(node, set()):
            if target not in graph:
                continue
            if target not in indices:
                visit(target)
                lowlinks[node] = min(lowlinks[node], lowlinks[target])
            elif target in stacked:
                lowlinks[node] = min(lowlinks[node], indices[target])
        if lowlinks[node] != indices[node]:
            return
        component: set[str] = set()
        while stack:
            current = stack.pop()
            stacked.remove(current)
            component.add(current)
            if current == node:
                break
        components.append(component)

    for node in graph:
        if node not in indices:
            visit(node)
    return components


def _deduplicate(issues: Iterable[BuildIssue]) -> list[BuildIssue]:
    result: list[BuildIssue] = []
    seen: set[tuple[Any, ...]] = set()
    for issue in issues:
        key = (issue.get("code"), issue.get("fragmentId"), issue.get("blockId"), issue.get("blockIndex"), None if issue.get("code") == "MISSING_ASSET" else issue.get("relatedId"))
        if key in seen:
            continue
        seen.add(key)
        result.append(issue)
    return result


def collect_build_preflight(
    project: dict[str, Any],
    target: str,
    builtin_assets: Path,
    custom_assets: Path,
    frontend_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if target not in {"web", "windows"}:
        raise ValueError(f"Unsupported build preflight target: {target}")
    enabled = _enabled_fragments(project)
    scripts = {fragment_id: blocks for fragment_id, blocks in project.get("scripts", {}).items() if fragment_id in enabled}
    assets = {str(asset.get("id")): asset for asset in project.get("assets", []) if asset.get("id")}
    issues: list[BuildIssue] = []

    graph: dict[str, set[str]] = {fragment_id: set() for fragment_id in enabled}
    for fragment_id, blocks in scripts.items():
        for block_index, block in enumerate(blocks):
            for destination in _targets(block):
                if destination not in enabled:
                    issues.append(_issue("error", "flow", "INVALID_TARGET", f"目标片段不存在或已被禁用：{destination}", fragmentId=fragment_id, blockId=block.get("id"), blockIndex=block_index, relatedId=destination))
                else:
                    graph[fragment_id].add(destination)

    for asset_id, location in _asset_references(project, enabled):
        asset = assets.get(asset_id)
        if not asset:
            asset_location = {**location}
            asset_location.setdefault("relatedId", asset_id)
            issues.append(_issue("error", "assets", "MISSING_ASSET", f"项目没有登记素材：{asset_id}", **asset_location))
            continue
        source = _asset_source(asset, builtin_assets, custom_assets)
        if not source or not source.is_file():
            asset_location = {**location}
            asset_location.setdefault("relatedId", asset_id)
            issues.append(_issue("error", "assets", "ASSET_FILE_MISSING", f"素材文件不存在：{asset.get('name') or asset_id}（{asset.get('path', '未设置路径')}）", **asset_location))

    visible = {
        fragment_id
        for fragment_id, blocks in scripts.items()
        if any(block.get("type") in {"dialogue", "narration", "branch"} for block in blocks)
    }
    for component in _strongly_connected(graph):
        cyclic = len(component) > 1 or any(node in graph.get(node, set()) for node in component)
        has_exit = any(target not in component for node in component for target in graph.get(node, set()))
        if cyclic and not has_exit and not (component & visible):
            fragment_id = sorted(component)[0]
            issues.append(_issue("error", "flow", "DETERMINISTIC_LOOP", f"无可见内容的控制流循环：{' → '.join(sorted(component))}", fragmentId=fragment_id))

    entry = next((str(chapter.get("fragments", [{}])[0].get("id")) for chapter in project.get("chapters", []) if chapter.get("entry") and not chapter.get("disabled") and chapter.get("fragments")), None)
    if not entry:
        entry = next(iter(enabled), None)
    reachable: set[str] = set()
    queue = [entry] if entry else []
    while queue:
        fragment_id = queue.pop(0)
        if fragment_id in reachable:
            continue
        reachable.add(fragment_id)
        queue.extend(target for target in graph.get(fragment_id, set()) if target not in reachable)
    for fragment_id in sorted(enabled - reachable):
        issues.append(_issue("warning", "reachability", "UNREACHABLE_FRAGMENT", f"入口流程无法到达片段：{fragment_id}", fragmentId=fragment_id))

    for asset_id in {asset_id for asset_id, _ in _asset_references(project, enabled)}:
        asset = assets.get(asset_id)
        if asset and str(asset.get("kind", "")).lower() == "video":
            issues.append(_issue("warning", "compatibility", "VIDEO_RUNTIME_LIMITED", f"视频素材“{asset.get('name', asset_id)}”尚未接入正式播放器", relatedId=asset_id))

    if frontend_report and frontend_report.get("projectId") == project.get("meta", {}).get("id") and frontend_report.get("target") == target:
        for raw in frontend_report.get("issues", []):
            if not isinstance(raw, dict) or raw.get("severity") not in {"error", "warning", "info"}:
                continue
            issues.append({key: value for key, value in raw.items() if key in {"severity", "blocking", "category", "code", "message", "fragmentId", "blockId", "blockIndex", "relatedId", "source"}})

    issues = _deduplicate(issues)
    errors = sum(issue.get("severity") == "error" for issue in issues)
    warnings = sum(issue.get("severity") == "warning" for issue in issues)
    frontend_stats = frontend_report.get("stats", {}) if frontend_report else {}
    simulation = frontend_report.get("simulation", {}) if frontend_report else {}
    return {
        "version": 1,
        "target": target,
        "projectId": project.get("meta", {}).get("id", ""),
        "generatedAt": frontend_report.get("generatedAt", "") if frontend_report else datetime.now(timezone.utc).isoformat(),
        "blocked": any(issue.get("blocking") or issue.get("severity") == "error" for issue in issues),
        "errors": errors,
        "warnings": warnings,
        "issues": issues,
        "stats": {
            "assets": len(project.get("assets", [])),
            "bundledAssets": len({asset_id for asset_id, _ in _asset_references(project, enabled)}),
            "fragments": len(enabled),
            "blocks": sum(len(blocks) for blocks in scripts.values()),
            "unreachableFragments": sum(issue.get("code") == "UNREACHABLE_FRAGMENT" for issue in issues),
            "simulatedPaths": int(frontend_stats.get("simulatedPaths", 0)),
        },
        "simulation": {
            "completed": bool(simulation.get("completed", False)),
            "truncated": bool(simulation.get("truncated", False)),
            "loops": int(simulation.get("loops", 0)),
            "runtimeErrors": int(simulation.get("runtimeErrors", 0)),
            "coveragePercent": int(simulation.get("coveragePercent", 0)),
        },
    }


def enforce_build_preflight(
    project: dict[str, Any],
    target: str,
    builtin_assets: Path,
    custom_assets: Path,
    frontend_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    report = collect_build_preflight(project, target, builtin_assets, custom_assets, frontend_report)
    if report["blocked"]:
        raise BuildPreflightError(report)
    return report
