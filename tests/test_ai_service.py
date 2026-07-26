from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.ai_service import AiService


class MemorySecretStore:
    def __init__(self) -> None:
        self.value: str | None = None

    def read(self) -> str | None:
        return self.value

    def write(self, value: str) -> None:
        self.value = value


class AiServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.secret_store = MemorySecretStore()
        self.service = AiService(Path(self.temporary.name), self.secret_store)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_api_key_is_not_written_to_settings_file(self) -> None:
        result = self.service.save_settings({
            "url": "https://example.com/v1/",
            "model": "test-model",
            "temperature": 0.7,
            "apiKey": "secret-value",
        })
        saved = self.service.settings_path.read_text(encoding="utf-8")
        self.assertNotIn("secret-value", saved)
        self.assertEqual(self.secret_store.value, "secret-value")
        self.assertTrue(result["hasKey"])
        self.assertEqual(result["url"], "https://example.com/v1")

    def test_openai_compatible_endpoint_is_normalized(self) -> None:
        self.assertEqual(AiService._endpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions")
        self.assertEqual(AiService._endpoint("https://host.example"), "https://host.example/v1/chat/completions")
        self.assertEqual(AiService._endpoint("https://host.example/chat/completions"), "https://host.example/chat/completions")

    def test_plan_schema_rejects_unsupported_operations(self) -> None:
        content = json.dumps({"summary": "bad", "operations": [{"type": "delete_project"}]})
        with self.assertRaisesRegex(ValueError, "不受支持"):
            AiService._parse_plan(content)

    def test_plan_schema_accepts_structured_block_changes(self) -> None:
        content = json.dumps({
            "summary": "补写剧情",
            "assumptions": ["沿用当前角色"],
            "operations": [{"type": "add_blocks", "fragmentId": "opening", "blocks": [{"type": "narration", "text": "夜幕降临。"}]}],
        }, ensure_ascii=False)
        plan = AiService._parse_plan(content)
        self.assertEqual(plan["summary"], "补写剧情")
        self.assertEqual(plan["operations"][0]["blocks"][0]["type"], "narration")


if __name__ == "__main__":
    unittest.main()
