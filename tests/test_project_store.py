import os
import tempfile
import unittest
import hashlib
from pathlib import Path

from backend.project_store import ProjectStore, default_project


class ProjectStoreTests(unittest.TestCase):
    def test_round_trip_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = default_project()
            project["meta"]["name"] = "测试项目"
            result = store.save(project)
            self.assertTrue(result["ok"])
            self.assertEqual(store.load()["meta"]["name"], "测试项目")

    def test_v3_round_trip_preserves_variable_definitions_and_locale(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root)
            project = store.load()
            project["variables"] = {"affection": 12, "player_name": "小光"}
            project["variableDefinitions"] = {
                "affection": {"displayName": "好感度", "description": "主线好感", "type": "number", "scope": "project", "persistence": "slot"},
                "player_name": {"displayName": "玩家名", "description": "跨存档称呼", "type": "string", "scope": "project", "persistence": "shared"},
            }
            project["locale"] = {"default": "zh-CN", "languages": ["zh-CN", "ja-JP", "en-US"]}
            store.save(project)

            reopened = ProjectStore(root).load()
            self.assertEqual(reopened["variableDefinitions"], project["variableDefinitions"])
            self.assertEqual(reopened["locale"], project["locale"])

    def test_v3_round_trip_preserves_runtime_ui_theme(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            runtime_theme = {
                "preset": "classic",
                "fontFamily": "KaiTi, serif",
                "dialogueFontSize": 24,
                "dialogueTextColor": "#fff4dd",
                "dialogueGradientColor": "#120f18",
                "dialogueBottomOpacity": 0.92,
                "dialogueTopOpacity": 0.12,
                "dialogueHeight": 22,
                "speakerColor": "#f3c66d",
                "speakerFontSize": 18,
                "speakerWeight": 700,
                "speakerStyle": "plate",
                "accentColor": "#e2b85f",
                "buttonTextColor": "#ffffff",
                "systemPanelColor": "#17131b",
                "systemPanelOpacity": 0.96,
                "savePanelColor": "#1c1821",
                "saveSlotColor": "#28212d",
                "cornerRadius": 2,
            }
            project["ui"]["runtimeTheme"] = runtime_theme
            store.save(project)

            reopened = ProjectStore(Path(directory)).load()
            self.assertEqual(reopened["ui"]["runtimeTheme"], runtime_theme)
            self.assertEqual(reopened["ui"]["runtimeTheme"]["dialogueHeight"], 22)

    def test_migration_repairs_invalid_variable_and_locale_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            project["variableDefinitions"] = None
            project["locale"] = {"default": "ja-JP", "languages": "ja-JP"}
            store.save(project)
            loaded = store.load()
            self.assertEqual(loaded["variableDefinitions"]["好感度"]["type"], "number")
            self.assertEqual(loaded["locale"], {"default": "ja-JP", "languages": ["ja-JP"]})

    def test_runtime_storage_survives_store_recreation_and_hashes_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unsafe_key = "../../outside/save:slot-1"
            store = ProjectStore(root)
            self.assertTrue(store.write_runtime_value(unsafe_key, "存档内容"))
            files = list(store.runtime_storage_dir.glob("*.value"))
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0].parent, store.runtime_storage_dir)
            self.assertNotIn("outside", files[0].name)
            self.assertEqual(ProjectStore(root).read_runtime_value(unsafe_key), "存档内容")
            self.assertTrue(ProjectStore(root).delete_runtime_value(unsafe_key))
            self.assertIsNone(store.read_runtime_value(unsafe_key))

    def test_invalid_project_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            with self.assertRaises(ValueError):
                store.save({"meta": {"name": ""}, "blocks": [], "chapters": []})

    def test_v1_project_is_migrated_to_fragment_scripts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            legacy = default_project()
            legacy["version"] = 1
            legacy["blocks"] = legacy["scripts"].pop("lake-meeting")
            legacy.pop("scripts")
            store.save(legacy)
            loaded = store.load()
            self.assertEqual(loaded["version"], 3)
            self.assertGreater(len(loaded["scripts"]["lake-meeting"]), 0)

    def test_legacy_sound_blocks_receive_channel_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            sound = next(block for block in project["scripts"]["lake-meeting"] if block["type"] == "sound")
            sound.pop("channel", None)
            sound.pop("action", None)
            sound.pop("version", None)
            store.save(project)
            migrated = next(block for block in store.load()["scripts"]["lake-meeting"] if block["type"] == "sound")
            self.assertEqual(migrated["channel"], "bgm")
            self.assertEqual(migrated["action"], "play")
            self.assertEqual(migrated["version"], 1)

    def test_v3_project_is_split_into_git_friendly_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            root = store.project_path.parent
            self.assertEqual(store.project_path.name, "project.hikari.json")
            self.assertTrue((root / "chapters" / "start.json").exists())
            self.assertTrue((root / "scripts" / "lake-meeting.json").exists())
            self.assertTrue((root / "characters" / "lin-cheng.json").exists())
            self.assertTrue((root / "scenes" / "scene-lake.json").exists())
            self.assertTrue((root / "assets" / "index.json").exists())
            self.assertTrue((root / "locales" / "zh-CN.json").exists())
            self.assertEqual(project["version"], 3)

    def test_opening_legacy_project_creates_backup_and_v3_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy_path = root / "legacy.hikari.json"
            import json
            legacy = default_project()
            legacy["version"] = 2
            legacy_path.write_text(json.dumps(legacy, ensure_ascii=False), encoding="utf-8")
            store = ProjectStore(root / "other")
            loaded = store.open(legacy_path)
            self.assertEqual(loaded["version"], 3)
            self.assertTrue(os.path.samefile(store.project_path, root / "legacy" / "project.hikari.json"))
            self.assertEqual(len(list(root.glob("legacy.hikari.json.v2-backup-*"))), 1)

    def test_corrupt_manifest_recovers_from_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            project["meta"]["name"] = "恢复成功"
            store.save(project)
            store.project_path.write_text("{broken", encoding="utf-8")
            self.assertEqual(store.load()["meta"]["name"], "恢复成功")

    def test_component_ids_cannot_escape_project_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = default_project()
            project["chapters"][0]["id"] = "../outside"
            with self.assertRaises(ValueError):
                store.save(project)

    def test_saving_to_unloaded_legacy_path_still_creates_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy_path = root / "star-sea-echo.hikari.json"
            import json
            legacy_path.write_text(json.dumps(default_project(), ensure_ascii=False), encoding="utf-8")
            store = ProjectStore(root)
            store.save(default_project("新的内容"))
            self.assertEqual(len(list(root.glob("star-sea-echo.hikari.json.v2-backup-*"))), 1)
            self.assertTrue(os.path.samefile(store.project_path, root / "star-sea-echo" / "project.hikari.json"))

    def test_import_asset_copies_into_project_asset_folder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            source = root / "background.png"
            source.write_bytes(b"fake-png")
            imported = store.import_assets([str(source)])
            self.assertEqual(imported[0]["kind"], "image")
            self.assertEqual(imported[0]["contentHash"], hashlib.sha256(b"fake-png").hexdigest())
            self.assertTrue((store.asset_dir / "background.png").exists())

    def test_missing_asset_match_prefers_hash_over_exact_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            search = root / "search"
            search.mkdir()
            (search / "portrait.png").write_bytes(b"wrong-content")
            (search / "renamed.png").write_bytes(b"correct-content")
            preview = store.match_missing_assets(str(search), [{
                "assetId": "portrait-id", "name": "portrait", "path": "portrait.png",
                "contentHash": hashlib.sha256(b"correct-content").hexdigest(),
            }])
            self.assertEqual(preview["matches"][0]["fileName"], "renamed.png")
            self.assertEqual(preview["matches"][0]["score"], 400)
            self.assertEqual(preview["matches"][0]["reason"], "SHA-256 哈希完全一致")

    def test_missing_asset_match_uses_filename_and_reports_unmatched(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            search = root / "search"
            search.mkdir()
            (search / "voice-001.ogg").write_bytes(b"voice")
            preview = store.match_missing_assets(str(search), [
                {"assetId": "voice", "name": "voice-001", "path": "audio/voice-001.ogg"},
                {"assetId": "missing", "name": "not-here", "path": "not-here.wav"},
            ])
            self.assertEqual(preview["matches"][0]["fileName"], "voice-001.ogg")
            self.assertEqual(preview["matches"][0]["score"], 300)
            self.assertEqual(preview["unmatched"][0]["assetId"], "missing")

    def test_missing_asset_match_reports_equal_candidates_as_ambiguous(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            search = root / "search"
            (search / "a").mkdir(parents=True)
            (search / "b").mkdir()
            (search / "a" / "same.webp").write_bytes(b"first")
            (search / "b" / "same.webp").write_bytes(b"second")
            preview = store.match_missing_assets(str(search), [{"assetId": "same-id", "name": "same", "path": "same.webp"}])
            self.assertFalse(preview["matches"])
            self.assertEqual(len(preview["ambiguous"]), 1)
            self.assertEqual(len(preview["ambiguous"][0]["candidates"]), 2)

    def test_apply_asset_folder_repair_keeps_stable_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            source = root / "restored.jpg"
            source.write_bytes(b"restored")
            repaired = store.apply_asset_folder_repair([{"assetId": "stable-scene", "sourcePath": str(source)}])
            self.assertEqual(repaired[0]["id"], "stable-scene")
            self.assertEqual(repaired[0]["contentHash"], hashlib.sha256(b"restored").hexdigest())
            self.assertTrue((store.asset_dir / "restored.jpg").is_file())

    def test_import_audio_records_category_and_pending_voice_status(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            source = root / "cv-001.wav"
            source.write_bytes(b"fake-wave")
            imported = store.import_assets([str(source)], "voice")
            self.assertEqual(imported[0]["kind"], "audio")
            self.assertEqual(imported[0]["audioCategory"], "voice")
            self.assertEqual(imported[0]["asrStatus"], "pending")

    def test_import_font_and_replace_asset_keep_stable_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            font = root / "dialogue.woff2"
            font.write_bytes(b"font")
            self.assertEqual(store.import_assets([str(font)])[0]["kind"], "font")
            replacement = root / "new-background.png"
            replacement.write_bytes(b"replacement")
            asset = store.replace_asset_file("stable-id", str(replacement))
            self.assertIsNotNone(asset)
            self.assertEqual(asset["id"], "stable-id")
            self.assertIn("?v=", asset["uri"])
            self.assertTrue((store.asset_dir / "new-background.png").exists())

    def test_save_as_copies_project_and_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "source")
            (store.asset_dir / "portrait.png").write_bytes(b"portrait")
            target = root / "copy"
            result = store.save_as(store.load(), target)
            self.assertTrue(result["ok"])
            self.assertTrue(os.path.samefile(store.project_path, target / "project.hikari.json"))
            self.assertTrue((target / "assets" / "files" / "portrait.png").exists())

    def test_entry_chapter_cannot_be_migrated_as_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            project["chapters"][0]["disabled"] = True
            store.save(project)
            self.assertFalse(store.load()["chapters"][0]["disabled"])


if __name__ == "__main__":
    unittest.main()
