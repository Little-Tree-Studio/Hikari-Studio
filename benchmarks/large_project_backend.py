from __future__ import annotations

import json
import tempfile
import time
import tracemalloc
from pathlib import Path
from typing import Any

from backend.project_store import ProjectStore


PROFILE = {"chapters": 10, "fragments": 100, "blocks": 10_000, "assets": 5_000, "timelineClips": 1_000}
BUDGETS = {"saveMs": 15_000, "loadMs": 2_500, "diskBytes": 64 * 1024 * 1024, "peakAllocatedBytes": 512 * 1024 * 1024}


def _block(index: int) -> dict[str, Any]:
    asset_id = f"asset-{index % 2_500}"
    audio_id = f"asset-{2_500 + index % 1_500}"
    kind = index % 13
    fragment_id = f"fragment-{index // 100}"
    if kind == 0:
        return {"id": f"block-{index}", "type": "scene", "title": f"Scene {index}", "assetId": asset_id, "transition": "dissolve", "duration": 0.4}
    if kind == 1:
        return {"id": f"block-{index}", "type": "sound", "title": f"Audio {index}", "assetId": audio_id, "channel": "sfx", "action": "play", "volume": 0.7}
    if kind == 2:
        return {"id": f"block-{index}", "type": "characterShow", "characterId": "benchmark-hero", "expression": "default", "position": "center"}
    if kind == 3:
        return {"id": f"block-{index}", "type": "camera", "cameraX": index % 40, "cameraY": -(index % 20), "zoom": 1.1, "duration": 0.3}
    if kind == 4:
        return {"id": f"block-{index}", "type": "setVariable", "variable": f"flag-{index % 50}", "value": index}
    if kind == 5:
        return {"id": f"block-{index}", "type": "dialogue", "speaker": "Benchmark Hero", "expression": "default", "text": f"Dialogue line {index}", "voice": audio_id}
    if kind == 6:
        return {"id": f"block-{index}", "type": "narration", "text": f"Narration line {index}"}
    if kind == 7:
        return {"id": f"block-{index}", "type": "branch", "title": f"Branch {index}", "options": [{"text": "Continue", "target": fragment_id}]}
    if kind == 8:
        return {"id": f"block-{index}", "type": "condition", "variable": f"flag-{index % 50}", "operator": "gte", "compareValue": 1}
    if kind == 9:
        return {"id": f"block-{index}", "type": "jump", "target": fragment_id}
    if kind == 10:
        return {"id": f"block-{index}", "type": "call", "target": fragment_id}
    if kind == 11:
        return {"id": f"block-{index}", "type": "return"}
    return {"id": f"block-{index}", "type": "characterHide", "characterId": "benchmark-hero", "animation": "fade"}


def _timeline(fragment_index: int) -> dict[str, Any]:
    kinds = ("scene", "character", "camera", "audio")
    tracks = [{"id": f"timeline-{fragment_index}-{kind}", "name": kind, "kind": kind, "clips": []} for kind in kinds]
    properties = {"scene": "opacity", "character": "x", "camera": "zoom", "audio": "volume"}
    for clip_index in range(10):
        kind = kinds[clip_index % len(kinds)]
        global_index = fragment_index * 10 + clip_index
        clip = {
            "id": f"timeline-clip-{global_index}",
            "name": f"Clip {global_index}",
            "start": clip_index * 2,
            "duration": 2,
            "blockId": f"block-{fragment_index * 100 + clip_index}",
            "assetId": f"asset-{2_500 + global_index % 1_500}" if kind == "audio" else f"asset-{global_index % 2_500}",
            "keyframes": [
                {"id": f"keyframe-{global_index}-start", "time": 0, "property": properties[kind], "value": 0, "easing": "linear"},
                {"id": f"keyframe-{global_index}-end", "time": 2, "property": properties[kind], "value": 1, "easing": "easeInOut"},
            ],
        }
        if kind == "character":
            clip["characterId"] = "benchmark-hero"
        if kind == "audio":
            clip["audioChannel"] = "bgm"
        tracks[clip_index % len(tracks)]["clips"].append(clip)
    return {"version": 1, "fragmentId": f"fragment-{fragment_index}", "duration": 22, "fps": 30, "tracks": tracks}


def create_large_project() -> dict[str, Any]:
    fragments = [{"id": f"fragment-{index}", "name": f"Fragment {index}"} for index in range(PROFILE["fragments"])]
    chapters = [
        {"id": f"chapter-{index}", "name": f"Chapter {index}", "entry": index == 0, "fragments": fragments[index * 10:index * 10 + 10]}
        for index in range(PROFILE["chapters"])
    ]
    assets = []
    for index in range(PROFILE["assets"]):
        kind, extension = ("image", "webp") if index < 2_500 else ("audio", "ogg") if index < 4_000 else ("video", "webm") if index < 4_500 else ("font", "woff2")
        assets.append({"id": f"asset-{index}", "kind": kind, "name": f"Asset {index}", "path": f"assets/files/asset-{index}.{extension}", "size": 16_384 + index, "forceBundle": index % 997 == 0})
    variables = {f"flag-{index}": 0 for index in range(50)}
    return {
        "version": 3,
        "meta": {"id": "large-project-benchmark", "name": "Large Project Benchmark", "author": "Hikari Studio", "resolution": [1920, 1080], "updatedAt": "2026-08-02T00:00:00.000Z"},
        "characters": [{"id": "benchmark-hero", "name": "Benchmark Hero", "color": "#d65b4a", "expressions": ["default", "smile"], "portraits": {"default": "asset-0", "smile": "asset-1"}}],
        "scenes": [{"id": f"scene-{index}", "name": f"Scene {index}", "layers": [{"id": f"scene-layer-{index}", "name": "Background", "assetId": f"asset-{index}", "opacity": 1, "blendMode": "normal", "offsetX": 0, "offsetY": 0, "scale": 1, "distance": 1}]} for index in range(100)],
        "sceneGroups": [],
        "chapters": chapters,
        "activeFragmentId": "fragment-0",
        "scripts": {fragment["id"]: [_block(fragment_index * 100 + block_index) for block_index in range(100)] for fragment_index, fragment in enumerate(fragments)},
        "timelines": {fragment["id"]: _timeline(index) for index, fragment in enumerate(fragments)},
        "assets": assets,
        "variables": variables,
        "variableDefinitions": {name: {"type": "number", "scope": "project", "persistence": "slot"} for name in variables},
        "settings": {"textSpeed": 35, "autoSave": True, "skipRead": True, "editorSession": {"openFragmentIds": ["fragment-0"], "selectedBlockByFragment": {"fragment-0": 5}, "scrollTopByFragment": {"fragment-0": 0}, "inspectorDock": "preview", "scriptView": "cards"}},
        "locale": {"default": "zh-CN", "languages": ["zh-CN"]},
        "ui": {"theme": "hikari-light", "dialogueStyle": "glass"},
    }


def project_shape(project: dict[str, Any]) -> dict[str, int]:
    return {
        "chapters": len(project.get("chapters", [])),
        "fragments": sum(len(chapter.get("fragments", [])) for chapter in project.get("chapters", [])),
        "blocks": sum(len(blocks) for blocks in project.get("scripts", {}).values()),
        "assets": len(project.get("assets", [])),
        "timelineClips": sum(len(track.get("clips", [])) for timeline in project.get("timelines", {}).values() for track in timeline.get("tracks", [])),
    }


def _directory_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def run_backend_benchmark() -> dict[str, Any]:
    project = create_large_project()
    with tempfile.TemporaryDirectory(prefix="hikari-large-project-") as directory:
        root = Path(directory)
        store = ProjectStore(root / "data", root / "state")
        started = time.perf_counter()
        store.save(project)
        save_ms = (time.perf_counter() - started) * 1_000
        started = time.perf_counter()
        loaded = store.load()
        load_ms = (time.perf_counter() - started) * 1_000

        # tracemalloc changes allocation behavior enough to distort wall-clock
        # results, so memory is measured in a separate reload pass.
        tracemalloc.start()
        store.load()
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        report = {
            "version": 1,
            "shape": project_shape(loaded),
            "saveMs": round(save_ms, 3),
            "loadMs": round(load_ms, 3),
            "diskBytes": _directory_bytes(store.project_root),
            "peakAllocatedBytes": peak,
            "budgets": BUDGETS,
        }
    report["violations"] = [f"{name} {report[name]} exceeds {budget}" for name, budget in BUDGETS.items() if report[name] > budget]
    return report


def main() -> int:
    report = run_backend_benchmark()
    print("HIKARI_DESKTOP_LARGE_PROJECT_BENCHMARK=" + json.dumps(report, ensure_ascii=False))
    if report["shape"] != PROFILE:
        print(f"Unexpected benchmark shape: {report['shape']}")
        return 1
    if report["violations"]:
        print("Performance budget violations: " + "; ".join(report["violations"]))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
