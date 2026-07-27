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
            AgentTool("propose_upsert_character", "提出新增角色或更新角色设定，可配置表情对应的素材 ID。", "edit", object_schema({"characterId": {"type": "string"}, "name": {"type": "string"}, "color": {"type": "string"}, "description": {"type": "string"}, "expressions": {"type": "array", "items": {"type": "string"}}, "portraits": {"type": "object", "additionalProperties": {"type": "string"}}, "defaultPosition": {"type": "string", "enum": ["farLeft", "left", "center", "right", "farRight", "custom"]}, "defaultScale": {"type": "number"}}, ("name",)), self._propose_upsert_character, True),
            AgentTool("propose_update_asset", "提出更新已有素材的名称、打包策略或音频归属；不能创建或读取本地文件。", "edit", object_schema({"assetId": {"type": "string"}, "name": {"type": "string"}, "forceBundle": {"type": "boolean"}, "audioCategory": {"type": "string", "enum": ["bgm", "sfx", "voice"]}, "voiceCharacterId": {"type": "string"}}, ("assetId",)), self._propose_update_asset, True),
            AgentTool("propose_upsert_variable", "提出新增或更新项目变量及类型、显示名、说明和持久化设置。", "edit", object_schema({"name": {"type": "string"}, "defaultValue": {"oneOf": [{"type": "string"}, {"type": "number"}, {"type": "boolean"}]}, "displayName": {"type": "string"}, "description": {"type": "string"}, "valueType": {"type": "string", "enum": ["boolean", "number", "string"]}, "persistence": {"type": "string", "enum": ["slot", "shared"]}}, ("name", "defaultValue")), self._propose_upsert_variable, True),
            AgentTool("propose_update_branch", "提出修改已有分支 Block 的标题和选项，每个目标必须是有效 Fragment。", "edit", object_schema({"fragmentId": {"type": "string"}, "blockId": {"type": "string"}, "title": {"type": "string"}, "options": {"type": "array", "items": {"type": "object", "properties": {"text": {"type": "string"}, "target": {"type": "string"}}, "required": ["text", "target"], "additionalProperties": False}}}, ("fragmentId", "blockId", "options")), self._propose_update_branch, True),
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

    def _propose_upsert_character(self, args: dict[str, Any]) -> dict[str, Any]:
        character_id = str(args.get("characterId") or "").strip()
        if character_id and not any(item.get("id") == character_id for item in self.project.get("characters", [])):
            raise ValueError(f"角色不存在：{character_id}")
        name = str(args.get("name") or "").strip()
        if not name:
            raise ValueError("角色名称不能为空")
        if not character_id:
            character_id = str(next((item.get("id") for item in self.project.get("characters", []) if item.get("name") == name), ""))
        portraits = args.get("portraits") or {}
        if not isinstance(portraits, dict):
            raise ValueError("portraits 必须是表情名到素材 ID 的对象")
        expressions = args.get("expressions")
        if expressions is not None and (not isinstance(expressions, list) or any(not isinstance(item, str) or not item.strip() for item in expressions)):
            raise ValueError("expressions 必须是非空表情名称数组")
        if any(not isinstance(expression, str) or not expression.strip() or not isinstance(asset_id, str) for expression, asset_id in portraits.items()):
            raise ValueError("角色立绘引用格式无效")
        asset_ids = {item.get("id") for item in self.project.get("assets", [])}
        missing = [asset_id for asset_id in portraits.values() if asset_id not in asset_ids]
        if missing:
            raise ValueError(f"角色立绘素材不存在：{missing[0]}")
        operation = {"type": "upsert_character", "name": name}
        if character_id:
            operation["characterId"] = character_id
        for key in ("color", "description", "expressions", "portraits", "defaultPosition", "defaultScale"):
            if key in args:
                operation[key] = args[key]
        self.proposed_operations.append(operation)
        return {"proposalIndex": len(self.proposed_operations) - 1, "requiresConfirmation": True, "assetReferenceCount": len(portraits)}

    def _propose_update_asset(self, args: dict[str, Any]) -> dict[str, Any]:
        asset_id = str(args.get("assetId") or "").strip()
        asset = next((item for item in self.project.get("assets", []) if item.get("id") == asset_id), None)
        if not asset:
            raise ValueError(f"素材不存在：{asset_id}")
        character_id = str(args.get("voiceCharacterId") or "").strip()
        if character_id and not any(item.get("id") == character_id for item in self.project.get("characters", [])):
            raise ValueError(f"语音角色不存在：{character_id}")
        operation = {"type": "update_asset", "assetId": asset_id}
        for key in ("name", "forceBundle", "audioCategory", "voiceCharacterId"):
            if key in args:
                operation[key] = args[key]
        if len(operation) == 2:
            raise ValueError("至少提供一项素材修改")
        if "name" in operation and not str(operation["name"]).strip():
            raise ValueError("素材名称不能为空")
        self.proposed_operations.append(operation)
        return {"proposalIndex": len(self.proposed_operations) - 1, "requiresConfirmation": True}

    def _propose_upsert_variable(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("name") or "").strip()
        if not name or not name.replace("_", "a").isalnum() or name[0].isdigit():
            raise ValueError("变量名只能包含字母、数字、下划线且不能以数字开头")
        value = args.get("defaultValue")
        inferred = "boolean" if isinstance(value, bool) else "number" if isinstance(value, (int, float)) else "string"
        value_type = str(args.get("valueType") or inferred)
        if value_type != inferred:
            raise ValueError("变量默认值与 valueType 不一致")
        operation = {"type": "upsert_variable", "name": name, "defaultValue": value, "valueType": value_type, "persistence": args.get("persistence", "slot")}
        for key in ("displayName", "description"):
            if key in args:
                operation[key] = str(args[key]).strip()
        self.proposed_operations.append(operation)
        return {"proposalIndex": len(self.proposed_operations) - 1, "requiresConfirmation": True}

    def _propose_update_branch(self, args: dict[str, Any]) -> dict[str, Any]:
        fragment_id = str(args.get("fragmentId") or "")
        block_id = str(args.get("blockId") or "")
        block = next((item for item in self.project.get("scripts", {}).get(fragment_id, []) if item.get("id") == block_id), None)
        if not block or block.get("type") != "branch":
            raise ValueError("指定 Block 不是有效的分支")
        fragments = {item.get("id") for chapter in self.project.get("chapters", []) for item in chapter.get("fragments", [])}
        options = args.get("options")
        if not isinstance(options, list) or not options:
            raise ValueError("分支至少需要一个选项")
        clean_options = []
        for option in options:
            text = str(option.get("text") or "").strip() if isinstance(option, dict) else ""
            target = str(option.get("target") or "") if isinstance(option, dict) else ""
            if not text or target not in fragments:
                raise ValueError(f"分支选项无效或目标不存在：{target}")
            clean_options.append({"text": text, "target": target})
        operation = {"type": "update_branch", "fragmentId": fragment_id, "blockId": block_id, "title": str(args.get("title") or block.get("title") or "").strip(), "options": clean_options}
        self.proposed_operations.append(operation)
        return {"proposalIndex": len(self.proposed_operations) - 1, "optionCount": len(clean_options), "requiresConfirmation": True}

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
