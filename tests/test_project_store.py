import os
import tempfile
import unittest
import hashlib
import json
from pathlib import Path

from backend.project_store import ProjectStore, default_project


class ProjectStoreTests(unittest.TestCase):
    def test_stage_timeline_persists_per_fragment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            fragment_id = project["activeFragmentId"]
            project["timelines"] = {
                fragment_id: {
                    "version": 1,
                    "fragmentId": fragment_id,
                    "duration": 12,
                    "fps": 30,
                    "tracks": [{"id": "track-camera", "name": "镜头", "kind": "camera", "clips": []}],
                }
            }
            store.save(project)

            timeline_path = store.project_root / "timelines" / f"{fragment_id}.json"
            self.assertTrue(timeline_path.is_file())
            reopened = ProjectStore(Path(directory)).load()
            self.assertEqual(reopened["timelines"][fragment_id]["duration"], 12)
            self.assertEqual(reopened["scripts"][fragment_id], project["scripts"][fragment_id])

    def test_production_memory_persists_outside_build_project_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            project["productionMemory"] = {"version": 1, "world": "测试世界", "characterRules": [], "styleRules": [], "facts": [{"id": "fact", "title": "事实", "content": "不会遗忘", "pinned": True, "references": [], "updatedAt": "now"}], "restrictions": [], "updatedAt": "now"}
            store.save(project)
            memory_path = store.project_root / ".hikari" / "agent" / "memory.json"
            self.assertTrue(memory_path.exists())
            self.assertEqual(ProjectStore(Path(directory)).load()["productionMemory"]["world"], "测试世界")

    @staticmethod
    def _command_history(project: dict) -> dict:
        return {
            "version": 1,
            "projectId": project["meta"]["id"],
            "undo": [{
                "id": "command-1",
                "label": "AI Agent：测试",
                "timestamp": 1,
                "before": project,
                "after": project,
                "options": {
                    "categories": [{"id": "characters", "label": "角色配置", "count": 1, "items": ["林澄"]}],
                    "persistence": {"strategy": "agent-patch", "payload": {"categories": [], "operations": []}},
                },
                "undoneCategoryIds": [],
            }],
            "redo": [],
        }

    @staticmethod
    def _compressed_command_history(project: dict) -> dict:
        return {
            "version": 2,
            "projectId": project["meta"]["id"],
            "snapshots": [
                {"id": "snapshot-1", "value": project},
                {"id": "snapshot-2", "baseId": "snapshot-1", "delta": {"type": "object", "changed": {"meta": {"type": "object", "changed": {"name": {"type": "replace", "value": "新名称"}}}}}},
            ],
            "storage": {"uncompressedBytes": 100000},
            "undo": [{
                "id": "command-2", "label": "重命名项目", "name": "发布前检查点", "pinned": True, "timestamp": 2,
                "beforeRef": "snapshot-1", "afterRef": "snapshot-2", "undoneCategoryIds": [],
            }],
            "redo": [],
            "archive": [{
                "id": "command-archived", "label": "已归档快照", "name": "固定归档", "pinned": True, "timestamp": 1,
                "beforeRef": "snapshot-1", "afterRef": "snapshot-2", "undoneCategoryIds": [],
            }],
        }

    def test_command_history_survives_store_recreation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root)
            project = store.load()
            history = self._command_history(project)
            result = store.save_command_history(history)

            self.assertTrue(result["ok"])
            self.assertEqual(result["commandCount"], 1)
            self.assertTrue((store.project_root / ".hikari" / "history" / "commands.json").exists())
            reopened = ProjectStore(root).load_command_history()
            self.assertEqual(reopened, history)
            json.loads(json.dumps(reopened, ensure_ascii=False))

    def test_compressed_command_history_preserves_names_pins_and_references(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root)
            history = self._compressed_command_history(store.load())
            result = store.save_command_history(history)
            reopened = ProjectStore(root).load_command_history()
            self.assertEqual(result["commandCount"], 2)
            self.assertEqual(reopened, history)
            self.assertEqual(reopened["undo"][0]["name"], "发布前检查点")
            self.assertTrue(reopened["undo"][0]["pinned"])
            self.assertEqual(reopened["archive"][0]["name"], "固定归档")
            stats = ProjectStore(root).load_command_history_stats()
            self.assertEqual(stats["bytes"], Path(result["path"]).stat().st_size)
            self.assertEqual(stats["uncompressedBytes"], 100000)
            self.assertGreater(stats["compressionRate"], 0)
            self.assertEqual(stats["commandCount"], 2)
            self.assertEqual(stats["ordinaryCount"], 0)
            self.assertEqual(stats["pinnedCount"], 2)
            self.assertEqual(stats["snapshotCount"], 2)

    def test_command_history_rejects_wrong_project_and_invalid_stacks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = store.load()
            wrong_project = self._command_history(project)
            wrong_project["projectId"] = "another-project"
            with self.assertRaises(ValueError):
                store.save_command_history(wrong_project)

            invalid_version = self._command_history(project)
            invalid_version["version"] = 3
            with self.assertRaises(ValueError):
                store.save_command_history(invalid_version)

            oversized = self._command_history(project)
            oversized["undo"] = oversized["undo"] * 51
            with self.assertRaises(ValueError):
                store.save_command_history(oversized)

            invalid_reference = self._compressed_command_history(project)
            invalid_reference["undo"][0]["afterRef"] = "snapshot-missing"
            with self.assertRaises(ValueError):
                store.save_command_history(invalid_reference)

            invalid_base = self._compressed_command_history(project)
            invalid_base["snapshots"][1]["baseId"] = "snapshot-later"
            with self.assertRaises(ValueError):
                store.save_command_history(invalid_base)

            invalid_name = self._compressed_command_history(project)
            invalid_name["undo"][0]["name"] = "x" * 121
            with self.assertRaises(ValueError):
                store.save_command_history(invalid_name)

    def test_command_history_from_copied_project_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = ProjectStore(root / "source")
            source_project = source.load()
            source.save_command_history(self._command_history(source_project))

            target = ProjectStore(root / "target")
            target.load()
            target.command_history_path.parent.mkdir(parents=True, exist_ok=True)
            target.command_history_path.write_bytes(source.command_history_path.read_bytes())
            self.assertIsNone(target.load_command_history())

    def test_recovery_snapshot_is_validated_and_reports_automatic_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root)
            project = store.load()
            snapshot = store.load_recovery_snapshot()
            self.assertIsNotNone(snapshot)
            self.assertEqual(snapshot["project"]["meta"]["id"], project["meta"]["id"])
            self.assertFalse(snapshot["recoveredDuringLoad"])
            self.assertTrue(snapshot["updatedAt"])

            store.project_path.write_text("{broken", encoding="utf-8")
            recovered = store.load()
            self.assertEqual(recovered["meta"]["id"], project["meta"]["id"])
            self.assertTrue(store.load_recovery_snapshot()["recoveredDuringLoad"])

    def test_recovery_snapshot_from_another_project_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = ProjectStore(root / "source")
            source.load()
            target = ProjectStore(root / "target")
            target.load()
            target.recovery_path.parent.mkdir(parents=True, exist_ok=True)
            target.recovery_path.write_bytes(source.recovery_path.read_bytes())
            self.assertIsNone(target.load_recovery_snapshot())

    def test_round_trip_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ProjectStore(Path(directory))
            project = default_project()
            project["meta"]["name"] = "测试项目"
            result = store.save(project)
            self.assertTrue(result["ok"])
            self.assertEqual(store.load()["meta"]["name"], "测试项目")

    def test_save_rejects_project_from_another_open_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = ProjectStore(root / "source")
            source_project = source.load()
            target = ProjectStore(root / "target")
            target_project = target.load()
            original_target_id = target_project["meta"]["id"]

            with self.assertRaisesRegex(ValueError, "refusing to overwrite another project"):
                target.save(source_project, expected_project_id=source_project["meta"]["id"])

            self.assertEqual(target.load()["meta"]["id"], original_target_id)

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

    def test_opening_associated_hikari_file_migrates_to_v3_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            associated_path = root / "visual-novel.hikari"
            import json
            legacy = default_project("文件关联项目")
            legacy["version"] = 2
            associated_path.write_text(json.dumps(legacy, ensure_ascii=False), encoding="utf-8")
            store = ProjectStore(root / "other")
            loaded = store.open(associated_path)
            self.assertEqual(loaded["meta"]["name"], "文件关联项目")
            self.assertTrue(os.path.samefile(store.project_path, root / "visual-novel" / "project.hikari.json"))
            self.assertEqual(len(list(root.glob("visual-novel.hikari.v2-backup-*"))), 1)

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
