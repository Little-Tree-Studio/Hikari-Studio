import json
import tempfile
import unittest
from pathlib import Path

from backend.script_importer import preview_script_import, preview_script_text


class ScriptImporterTests(unittest.TestCase):
    def test_markdown_is_parsed_into_dialogue_scene_and_narration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "story.md"
            path.write_text("# 第一幕\n[场景：湖边]\n林澄：你来了。\n> 风吹过湖面。", encoding="utf-8")
            preview = preview_script_import(path)
            self.assertEqual(preview["format"], "Markdown")
            self.assertEqual([block["type"] for block in preview["blocks"]], ["narration", "scene", "dialogue", "narration"])

    def test_slide_project_json_uses_active_fragment(self) -> None:
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

    def test_clipboard_text_is_parsed_into_dialogue_and_narration(self) -> None:
        preview = preview_script_text("林澄：你来了。\n风吹过湖面。")
        self.assertEqual(preview["sourceName"], "系统剪贴板")
        self.assertEqual(preview["format"], "TXT")
        self.assertEqual([block["type"] for block in preview["blocks"]], ["dialogue", "narration"])
        self.assertEqual(preview["blocks"][0]["speaker"], "林澄")

    def test_clipboard_slide_blocks_are_validated_and_receive_new_ids(self) -> None:
        preview = preview_script_text('SLIDE_BLOCKS_V1\n[{"id":"old","type":"narration","text":"测试"}]')
        self.assertEqual(preview["format"], "Slide JSON")
        self.assertEqual(preview["blocks"][0]["text"], "测试")
        self.assertNotEqual(preview["blocks"][0]["id"], "old")

    def test_empty_clipboard_returns_a_non_destructive_warning(self) -> None:
        preview = preview_script_text(" \r\n")
        self.assertEqual(preview["blocks"], [])
        self.assertEqual(preview["warnings"], ["剪贴板中没有文本"])

    def test_character_alias_and_bracket_expression_are_bound_to_project_configuration(self) -> None:
        characters = [{
            "id": "lin",
            "name": "林澄",
            "expressions": ["默认", "微笑"],
            "displayNameSchemes": [{"id": "alias", "name": "店长称呼", "kind": "fixed", "value": "店长"}],
        }]
        preview = preview_script_text("店长[微笑]：欢迎光临。", characters=characters)
        block = preview["blocks"][0]
        match = preview["matches"][0]
        self.assertEqual((block["speaker"], block["expression"]), ("林澄", "微笑"))
        self.assertEqual(match["characterStatus"], "alias")
        self.assertEqual(match["expressionStatus"], "exact")
        self.assertEqual(match["expressionSyntax"], "brackets")

    def test_smart_matching_normalizes_character_and_expression_names(self) -> None:
        characters = [{"id": "alice", "name": "Alice Smith", "expressions": ["默认", "Happy Face"]}]
        preview = preview_script_text("alice-smith|happy_face: Hello", characters=characters)
        self.assertEqual(preview["blocks"][0]["speaker"], "Alice Smith")
        self.assertEqual(preview["blocks"][0]["expression"], "Happy Face")
        self.assertEqual(preview["matches"][0]["characterStatus"], "smart")
        self.assertEqual(preview["matches"][0]["expressionStatus"], "smart")

    def test_missing_expression_falls_back_and_is_reported(self) -> None:
        characters = [{"id": "lin", "name": "林澄", "expressions": ["默认", "微笑"]}]
        preview = preview_script_text("林澄（愤怒）：别过来。", characters=characters)
        self.assertEqual(preview["blocks"][0]["expression"], "默认")
        self.assertEqual(preview["matches"][0]["expressionStatus"], "fallback")
        self.assertIn("表情“愤怒”不存在", preview["warnings"][0])

    def test_unknown_character_can_become_narration_and_narration_can_merge(self) -> None:
        preview = preview_script_text(
            "陌生人：你好。\n第一行旁白。\n第二行旁白。",
            characters=[],
            rules={"unknownCharacter": "narration", "mergeNarrationLines": True},
        )
        self.assertEqual(len(preview["blocks"]), 1)
        self.assertEqual(preview["blocks"][0]["type"], "narration")
        self.assertEqual(preview["blocks"][0]["text"], "陌生人：你好。\n第一行旁白。\n第二行旁白。")
        self.assertEqual(preview["matches"], [])

    def test_expression_syntax_rule_does_not_recognize_disabled_marker_styles(self) -> None:
        characters = [{"id": "lin", "name": "林澄", "expressions": ["默认", "微笑"]}]
        preview = preview_script_text("林澄[微笑]：你好。", characters=characters, rules={"expressionSyntax": "parentheses"})
        self.assertEqual(preview["blocks"][0]["speaker"], "林澄[微笑]")
        self.assertEqual(preview["matches"][0]["characterStatus"], "unmatched")


if __name__ == "__main__":
    unittest.main()
