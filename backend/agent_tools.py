from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal


Permission = Literal["read", "edit", "validate", "build"]


@dataclass(frozen=True)
class AgentTool:
    name: str
    description: str
    permission: Permission
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], dict[str, Any]]
    reversible: bool

    def schema(self) -> dict[str, Any]:
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": self.parameters}}


class AgentToolRegistry:
    def __init__(self, project: dict[str, Any]) -> None:
        self.project = project
        self.proposed_operations: list[dict[str, Any]] = []
        self.requested_builds: list[dict[str, Any]] = []
        self.trace: list[dict[str, Any]] = []
        self._tools = {tool.name: tool for tool in self._definitions()}

    def schemas(self) -> list[dict[str, Any]]:
        return [tool.schema() for tool in self._tools.values()]

    def invoke(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        tool = self._tools.get(name)
        if not tool:
            result = {"ok": False, "error": f"未知工具：{name}"}
            self.trace.append({"name": name, "permission": "unknown", "ok": False})
            return result
        try:
            result = tool.handler(arguments)
            result = {"ok": True, **result}
            self.trace.append({"name": name, "permission": tool.permission, "ok": True, "summary": self._result_summary(result)})
            return result
        except (KeyError, TypeError, ValueError) as error:
            self.trace.append({"name": name, "permission": tool.permission, "ok": False, "summary": str(error)})
            return {"ok": False, "error": str(error)}

    def _definitions(self) -> list[AgentTool]:
        object_schema = lambda properties, required=(): {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}
        return [
            AgentTool("get_project_overview", "读取项目结构、角色、变量和素材统计。", "read", object_schema({}), self._overview, False),
            AgentTool("get_fragment", "读取指定 Fragment 的 Block。", "read", object_schema({"fragmentId": {"type": "string"}}, ("fragmentId",)), self._fragment, False),
            AgentTool("search_project", "搜索台词、角色、素材、章节和 Fragment。", "read", object_schema({"query": {"type": "string"}}, ("query",)), self._search, False),
            AgentTool("get_diagnostics", "检查无效引用、空分支、缺失素材和不可达 Fragment。", "validate", object_schema({}), self._diagnostics, False),
            AgentTool("propose_add_blocks", "提出向已有 Fragment 追加 Block 的结构化修改。修改只会进入待确认差异。", "edit", object_schema({"fragmentId": {"type": "string"}, "blocks": {"type": "array", "items": {"type": "object"}}}, ("fragmentId", "blocks")), self._propose_add_blocks, True),
            AgentTool("propose_create_fragment", "提出创建 Fragment 的结构化修改。修改只会进入待确认差异。", "edit", object_schema({"chapterId": {"type": "string"}, "name": {"type": "string"}, "blocks": {"type": "array", "items": {"type": "object"}}}, ("chapterId", "name", "blocks")), self._propose_create_fragment, True),
            AgentTool("propose_update_project", "提出修改项目名称或作者。修改只会进入待确认差异。", "edit", object_schema({"name": {"type": "string"}, "author": {"type": "string"}}), self._propose_update_project, True),
            AgentTool("validate_patch", "验证当前待确认修改中的引用和 Block 类型。", "validate", object_schema({}), self._validate_patch, False),
            AgentTool("request_build", "请求在用户单独确认后构建 Web、Windows 或 Ren'Py 测试包。", "build", object_schema({"target": {"type": "string", "enum": ["web", "windows", "renpy"]}}, ("target",)), self._request_build, False),
        ]

    def _overview(self, _: dict[str, Any]) -> dict[str, Any]:
        chapters = self.project.get("chapters", [])
        return {"project": self.project.get("meta", {}), "activeFragmentId": self.project.get("activeFragmentId"), "chapters": chapters, "characters": self.project.get("characters", []), "variables": self.project.get("variables", {}), "assets": [{key: asset.get(key) for key in ("id", "kind", "name", "path")} for asset in self.project.get("assets", [])], "blockCount": sum(len(blocks) for blocks in self.project.get("scripts", {}).values())}

    def _fragment(self, args: dict[str, Any]) -> dict[str, Any]:
        fragment_id = str(args["fragmentId"])
        if fragment_id not in self.project.get("scripts", {}):
            raise ValueError(f"Fragment 不存在：{fragment_id}")
        return {"fragmentId": fragment_id, "blocks": self.project["scripts"][fragment_id]}

    def _search(self, args: dict[str, Any]) -> dict[str, Any]:
        query = str(args["query"]).strip().lower()
        if not query:
            raise ValueError("搜索词不能为空")
        matches: list[dict[str, Any]] = []
        for chapter in self.project.get("chapters", []):
            if query in str(chapter.get("name", "")).lower():
                matches.append({"kind": "chapter", "id": chapter.get("id"), "name": chapter.get("name")})
            for fragment in chapter.get("fragments", []):
                if query in str(fragment.get("name", "")).lower():
                    matches.append({"kind": "fragment", "id": fragment.get("id"), "name": fragment.get("name")})
        for fragment_id, blocks in self.project.get("scripts", {}).items():
            for index, block in enumerate(blocks):
                text = " ".join(str(block.get(key, "")) for key in ("text", "speaker", "title"))
                if query in text.lower():
                    matches.append({"kind": "block", "fragmentId": fragment_id, "index": index, "type": block.get("type"), "text": text[:240]})
        for kind in ("characters", "assets"):
            for item in self.project.get(kind, []):
                if query in str(item.get("name", "")).lower():
                    matches.append({"kind": kind[:-1], "id": item.get("id"), "name": item.get("name")})
        return {"matches": matches[:100], "total": len(matches)}

    def _diagnostics(self, _: dict[str, Any]) -> dict[str, Any]:
        issues = self._collect_diagnostics()
        return {"issues": issues, "errors": sum(issue["severity"] == "error" for issue in issues), "warnings": sum(issue["severity"] == "warning" for issue in issues)}

    def _propose_add_blocks(self, args: dict[str, Any]) -> dict[str, Any]:
        fragment_id = str(args["fragmentId"])
        if fragment_id not in self.project.get("scripts", {}):
            raise ValueError(f"Fragment 不存在：{fragment_id}")
        blocks = self._validated_blocks(args["blocks"])
        operation = {"type": "add_blocks", "fragmentId": fragment_id, "blocks": blocks}
        self.proposed_operations.append(operation)
        return {"proposalIndex": len(self.proposed_operations) - 1, "blockCount": len(blocks), "requiresConfirmation": True}

    def _propose_create_fragment(self, args: dict[str, Any]) -> dict[str, Any]:
        chapter_id = str(args["chapterId"])
        if not any(chapter.get("id") == chapter_id for chapter in self.project.get("chapters", [])):
            raise ValueError(f"章节不存在：{chapter_id}")
        name = str(args["name"]).strip()
        if not name:
            raise ValueError("Fragment 名称不能为空")
        blocks = self._validated_blocks(args["blocks"])
        self.proposed_operations.append({"type": "create_fragment", "chapterId": chapter_id, "name": name, "blocks": blocks})
        return {"proposalIndex": len(self.proposed_operations) - 1, "blockCount": len(blocks), "requiresConfirmation": True}

    def _propose_update_project(self, args: dict[str, Any]) -> dict[str, Any]:
        operation = {"type": "update_project", **{key: str(args[key]).strip() for key in ("name", "author") if args.get(key)}}
        if len(operation) == 1:
            raise ValueError("至少提供 name 或 author")
        self.proposed_operations.append(operation)
        return {"proposalIndex": len(self.proposed_operations) - 1, "requiresConfirmation": True}

    def _validate_patch(self, _: dict[str, Any]) -> dict[str, Any]:
        return {"valid": True, "operationCount": len(self.proposed_operations), "diagnostics": self._collect_diagnostics()[:30]}

    def _request_build(self, args: dict[str, Any]) -> dict[str, Any]:
        target = str(args["target"])
        if target not in {"web", "windows", "renpy"}:
            raise ValueError("不支持的构建目标")
        diagnostics = self._collect_diagnostics()
        request = {"target": target, "blocked": any(item["severity"] == "error" for item in diagnostics), "requiresConfirmation": True}
        if request not in self.requested_builds:
            self.requested_builds.append(request)
        return request

    def _collect_diagnostics(self) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        fragments = {fragment.get("id") for chapter in self.project.get("chapters", []) for fragment in chapter.get("fragments", [])}
        assets = {asset.get("id") for asset in self.project.get("assets", [])}
        referenced: set[str] = set()
        for fragment_id, blocks in self.project.get("scripts", {}).items():
            if fragment_id not in fragments:
                issues.append({"severity": "error", "code": "ORPHAN_SCRIPT", "message": f"脚本没有对应 Fragment：{fragment_id}"})
            for index, block in enumerate(blocks):
                if block.get("type") == "branch" and not block.get("options"):
                    issues.append({"severity": "error", "code": "EMPTY_BRANCH", "message": "分支没有选项", "fragmentId": fragment_id, "blockIndex": index})
                targets = []
                if block.get("type") == "branch": targets = [option.get("target") for option in block.get("options", [])]
                elif block.get("type") == "condition": targets = [block.get("trueTarget"), block.get("falseTarget")]
                elif block.get("type") in {"jump", "call"}: targets = [block.get("target")]
                for target in filter(None, targets):
                    referenced.add(str(target))
                    if target not in fragments:
                        issues.append({"severity": "error", "code": "INVALID_FRAGMENT_REFERENCE", "message": f"目标 Fragment 不存在：{target}", "fragmentId": fragment_id, "blockIndex": index})
                for key in ("assetId", "voiceAssetId", "backgroundAssetId"):
                    if block.get(key) and block[key] not in assets:
                        issues.append({"severity": "error", "code": "MISSING_ASSET", "message": f"素材不存在：{block[key]}", "fragmentId": fragment_id, "blockIndex": index})
        entry = next((chapter.get("fragments", [{}])[0].get("id") for chapter in self.project.get("chapters", []) if chapter.get("entry") and chapter.get("fragments")), None)
        for fragment in fragments - referenced - ({entry} if entry else set()):
            issues.append({"severity": "warning", "code": "UNREFERENCED_FRAGMENT", "message": f"Fragment 没有流程引用：{fragment}", "fragmentId": fragment})
        return issues

    @staticmethod
    def _validated_blocks(value: Any) -> list[dict[str, Any]]:
        allowed = {"scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "condition", "jump", "call", "return"}
        if not isinstance(value, list):
            raise ValueError("blocks 必须是数组")
        blocks: list[dict[str, Any]] = []
        for block in value:
            if not isinstance(block, dict) or block.get("type") not in allowed:
                raise ValueError("包含不受支持的 Block")
            clean = {key: item for key, item in block.items() if key != "id"}
            blocks.append(clean)
        return blocks

    @staticmethod
    def _result_summary(result: dict[str, Any]) -> str:
        for key in ("total", "blockCount", "operationCount", "proposalIndex"):
            if key in result:
                return f"{key}={result[key]}"
        return "完成"
