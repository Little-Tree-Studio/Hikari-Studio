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


if __name__ == "__main__":
    unittest.main()
