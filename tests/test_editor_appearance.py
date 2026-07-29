from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.editor_appearance import DEFAULT_EDITOR_APPEARANCE, EditorAppearanceStore, normalize_editor_appearance


class EditorAppearanceTests(unittest.TestCase):
    def test_normalizes_known_values_and_rejects_invalid_accent(self) -> None:
        self.assertEqual(normalize_editor_appearance({"mode": "fixed", "themeId": "graphite", "motion": "reduced", "accentColor": "#12ABef"}), {
            "version": 1, "mode": "fixed", "themeId": "graphite", "motion": "reduced", "accentColor": "#12abef",
        })
        self.assertNotIn("accentColor", normalize_editor_appearance({"accentColor": "red"}))

    def test_missing_or_corrupt_configuration_uses_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = EditorAppearanceStore(Path(directory))
            self.assertEqual(store.load(), DEFAULT_EDITOR_APPEARANCE)
            store.path.write_text("not json", encoding="utf-8")
            self.assertEqual(store.load(), DEFAULT_EDITOR_APPEARANCE)

    def test_save_is_normalized_and_persistent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = EditorAppearanceStore(Path(directory))
            saved = store.save({"mode": "fixed", "themeId": "sakura-studio", "motion": "full", "unknown": True})
            self.assertEqual(store.load(), saved)
            self.assertEqual(json.loads(store.path.read_text(encoding="utf-8")), saved)


if __name__ == "__main__":
    unittest.main()
