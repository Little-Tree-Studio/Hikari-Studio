from __future__ import annotations

import copy
import unittest

from backend.agent_tools import AgentToolRegistry


def sample_project() -> dict:
    return {
        "meta": {"name": "测试项目", "author": "作者"},
        "activeFragmentId": "opening",
        "chapters": [{"id": "start", "name": "开始", "entry": True, "fragments": [{"id": "opening", "name": "片头"}]}],
        "scripts": {"opening": [{"id": "b1", "type": "narration", "text": "夜幕降临。"}]},
        "characters": [{"id": "hero", "name": "林澄"}],
        "assets": [{"id": "lake", "kind": "scene", "name": "湖畔", "path": "lake.png"}],
        "variables": {"affection": 0},
        "variableDefinitions": {"affection": {"type": "number", "scope": "project", "persistence": "slot"}},
    }


class AgentToolRegistryTests(unittest.TestCase):
    def test_read_and_search_tools_return_project_context(self) -> None:
        registry = AgentToolRegistry(sample_project())
        overview = registry.invoke("get_project_overview", {})
        search = registry.invoke("search_project", {"query": "夜幕"})
        self.assertTrue(overview["ok"])
        self.assertEqual(overview["blockCount"], 1)
        self.assertEqual(search["total"], 1)
        self.assertEqual(registry.trace[0]["permission"], "read")

    def test_edit_tools_create_reversible_proposals_without_mutating_project(self) -> None:
        project = sample_project()
        original = copy.deepcopy(project)
        registry = AgentToolRegistry(project)
        result = registry.invoke("propose_add_blocks", {"fragmentId": "opening", "blocks": [{"id": "unsafe-id", "type": "dialogue", "speaker": "林澄", "text": "你来了。"}]})
        self.assertTrue(result["requiresConfirmation"])
        self.assertEqual(project, original)
        self.assertNotIn("id", registry.proposed_operations[0]["blocks"][0])

    def test_invalid_edit_is_rejected_and_build_requires_confirmation(self) -> None:
        registry = AgentToolRegistry(sample_project())
        invalid = registry.invoke("propose_add_blocks", {"fragmentId": "missing", "blocks": []})
        build = registry.invoke("request_build", {"target": "web"})
        self.assertFalse(invalid["ok"])
        self.assertTrue(build["requiresConfirmation"])
        self.assertEqual(registry.requested_builds[0]["target"], "web")

    def test_character_asset_variable_and_branch_tools_create_valid_proposals(self) -> None:
        project = sample_project()
        project["scripts"]["opening"].append({"id": "choice", "type": "branch", "title": "选择", "options": [{"text": "继续", "target": "opening"}]})
        original = copy.deepcopy(project)
        registry = AgentToolRegistry(project)
        character = registry.invoke("propose_upsert_character", {"characterId": "hero", "name": "林澄", "expressions": ["默认"], "portraits": {"默认": "lake"}})
        asset = registry.invoke("propose_update_asset", {"assetId": "lake", "name": "湖畔背景", "forceBundle": True})
        variable = registry.invoke("propose_upsert_variable", {"name": "route_unlocked", "defaultValue": False, "valueType": "boolean", "displayName": "路线解锁", "persistence": "shared"})
        branch = registry.invoke("propose_update_branch", {"fragmentId": "opening", "blockId": "choice", "title": "新的选择", "options": [{"text": "留下", "target": "opening"}]})
        self.assertTrue(all(result["ok"] and result["requiresConfirmation"] for result in (character, asset, variable, branch)))
        self.assertEqual([operation["type"] for operation in registry.proposed_operations], ["upsert_character", "update_asset", "upsert_variable", "update_branch"])
        self.assertEqual(project, original)

    def test_extended_edit_tools_reject_missing_references_and_type_mismatch(self) -> None:
        registry = AgentToolRegistry(sample_project())
        self.assertFalse(registry.invoke("propose_upsert_character", {"name": "新角色", "portraits": {"默认": "missing"}})["ok"])
        self.assertFalse(registry.invoke("propose_update_asset", {"assetId": "missing", "forceBundle": True})["ok"])
        self.assertFalse(registry.invoke("propose_upsert_variable", {"name": "score", "defaultValue": "zero", "valueType": "number"})["ok"])
        self.assertFalse(registry.invoke("propose_update_branch", {"fragmentId": "opening", "blockId": "b1", "options": [{"text": "继续", "target": "opening"}]})["ok"])


if __name__ == "__main__":
    unittest.main()
