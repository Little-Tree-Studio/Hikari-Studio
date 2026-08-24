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
        "scenes": [{"id": "lake-scene", "name": "湖畔", "layers": []}],
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
        self.assertEqual(overview["scenes"][0]["id"], "lake-scene")
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
        self.assertFalse(registry.invoke("propose_insert_blocks", {"fragmentId": "opening", "position": "end", "blocks": [{"type": "characterShow", "characterId": "missing"}]})["ok"])
        self.assertFalse(registry.invoke("propose_insert_blocks", {"fragmentId": "opening", "position": "end", "blocks": [{"type": "scene", "sceneId": "missing"}]})["ok"])
        self.assertFalse(registry.invoke("propose_insert_blocks", {"fragmentId": "opening", "position": "end", "blocks": [{"type": "sound", "assetId": "missing"}]})["ok"])

    def test_module_and_narrative_map_tools_create_valid_proposals(self) -> None:
        project = sample_project()
        project["chapters"][0]["fragments"].append({"id": "second", "name": "第二段"})
        project["scripts"]["second"] = []
        original = copy.deepcopy(project)
        registry = AgentToolRegistry(project)

        narrative = registry.invoke("get_narrative_map", {})
        self.assertTrue(narrative["ok"])
        self.assertEqual(len(narrative["fragments"]), 2)
        self.assertEqual(narrative["viewMode"], "graph")

        chapter = registry.invoke("propose_create_chapter", {"name": "第二章", "fragmentName": "序章", "blocks": [{"type": "narration", "text": "新的开始。"}]})
        scene = registry.invoke("propose_upsert_scene", {"name": "雨夜", "layers": [{"name": "背景", "assetId": "lake", "opacity": 0.8}]})
        layout = registry.invoke("propose_update_narrative_map", {"positions": {"fragment:opening": {"x": 100, "y": 200}}, "viewMode": "flow", "connections": [{"from": "opening", "to": "second", "kind": "jump"}]})
        self.assertTrue(all(result["ok"] and result["requiresConfirmation"] for result in (chapter, scene, layout)))
        self.assertEqual([operation["type"] for operation in registry.proposed_operations], ["create_chapter", "upsert_scene", "update_narrative_map"])
        self.assertEqual(project, original)

    def test_module_and_narrative_map_tools_reject_invalid_input(self) -> None:
        project = sample_project()
        project["chapters"][0]["fragments"].append({"id": "second", "name": "第二段"})
        project["scripts"]["second"] = []
        registry = AgentToolRegistry(project)
        self.assertFalse(registry.invoke("propose_create_chapter", {"name": "开始"})["ok"])  # 重名章节
        self.assertFalse(registry.invoke("propose_upsert_scene", {"sceneId": "missing", "name": "新场景"})["ok"])
        self.assertFalse(registry.invoke("propose_upsert_scene", {"name": "雨夜", "layers": [{"assetId": "missing"}]})["ok"])
        self.assertFalse(registry.invoke("propose_update_narrative_map", {"connections": [{"from": "opening", "to": "missing", "kind": "jump"}]})["ok"])
        self.assertFalse(registry.invoke("propose_update_narrative_map", {"connections": [{"from": "opening", "to": "opening", "kind": "jump"}]})["ok"])
        self.assertFalse(registry.invoke("propose_update_narrative_map", {})["ok"])  # 至少提供一项

    def test_simulation_memory_and_director_tools_use_structured_proposals(self) -> None:
        project = sample_project()
        project["productionMemory"] = {"version": 1, "world": "近未来湖城", "characterRules": [], "styleRules": [], "facts": [], "restrictions": [], "updatedAt": ""}
        context = {"projectFingerprint": "fp", "branchSimulation": {"pathCount": 2, "summary": {"completed": 2}}}
        registry = AgentToolRegistry(project, context)
        simulation = registry.invoke("get_branch_simulation", {})
        memory = registry.invoke("get_production_memory", {})
        inserted = registry.invoke("propose_insert_blocks", {"fragmentId": "opening", "anchorBlockId": "b1", "position": "before", "blocks": [{"type": "camera", "zoom": 1.2}]})
        updated = registry.invoke("propose_update_blocks", {"fragmentId": "opening", "updates": [{"blockId": "b1", "patch": {"text": "雾落下来。"}}]})
        moved = registry.invoke("propose_move_blocks", {"fragmentId": "opening", "blockIds": ["b1"], "position": "end"})
        memory_patch = registry.invoke("propose_memory_update", {"world": "近未来湖城，记忆可以被保存。", "facts": [{"title": "湖", "content": "湖会记录声音", "pinned": True}]})
        self.assertTrue(all(result["ok"] for result in (simulation, memory, inserted, updated, moved, memory_patch)))
        self.assertEqual(simulation["projectFingerprint"], "fp")
        self.assertEqual(memory["world"], "近未来湖城")
        self.assertEqual([item["type"] for item in registry.proposed_operations], ["insert_blocks", "update_blocks", "move_blocks", "update_production_memory"])
        self.assertEqual(project["scripts"]["opening"][0]["text"], "夜幕降临。")


if __name__ == "__main__":
    unittest.main()
