import json
import tempfile
import unittest
from pathlib import Path

from backend.script_importer import preview_script_import


class ScriptImporterTests(unittest.TestCase):
    def test_markdown_is_parsed_into_dialogue_scene_and_narration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "story.md"
            path.write_text("# 第一幕\n[场景：湖边]\n林澄：你来了。\n> 风吹过湖面。", encoding="utf-8")
            preview = preview_script_import(path)
            self.assertEqual(preview["format"], "Markdown")
            self.assertEqual([block["type"] for block in preview["blocks"]], ["narration", "scene", "dialogue", "narration"])

    def test_hikari_project_json_uses_active_fragment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.json"
            path.write_text(json.dumps({"activeFragmentId": "start", "scripts": {"start": [{"id": "old", "type": "narration", "text": "开始"}]}}), encoding="utf-8")
            preview = preview_script_import(path)
            self.assertEqual(len(preview["blocks"]), 1)
            self.assertNotEqual(preview["blocks"][0]["id"], "old")

    def test_invalid_json_shape_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "story.json"
            path.write_text('{"unexpected": true}', encoding="utf-8")
            with self.assertRaises(ValueError):
                preview_script_import(path)


if __name__ == "__main__":
    unittest.main()
