import json
import tempfile
import unittest
from pathlib import Path

from backend.api import DesktopApi
from backend.project_store import ProjectStore


class DesktopApiTests(unittest.TestCase):
    def test_project_json_bridge_returns_serializable_v3_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = json.loads(api.load_project_json())
            self.assertEqual(project["version"], 3)
            self.assertGreater(len(project["chapters"]), 0)

    def test_runtime_storage_bridge_persists_across_api_instances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = DesktopApi(ProjectStore(root / "data"), root)
            self.assertTrue(first.write_runtime_value("hikari-save:test:quick", '{"op":4}'))
            second = DesktopApi(ProjectStore(root / "data"), root)
            self.assertEqual(second.read_runtime_value("hikari-save:test:quick"), '{"op":4}')
            self.assertTrue(second.delete_runtime_value("hikari-save:test:quick"))
            self.assertIsNone(first.read_runtime_value("hikari-save:test:quick"))

    def test_recent_projects_can_be_opened_and_pinned(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            created = api.new_project("最近项目")
            recent = api.list_recent_projects()
            entry = next(item for item in recent if item["name"] == "最近项目")
            self.assertTrue(entry["exists"])
            pinned = api.set_project_pinned(entry["path"], True)
            self.assertTrue(next(item for item in pinned if item["path"] == entry["path"])["pinned"])
            opened = api.open_recent_project(entry["path"])
            self.assertEqual(opened["meta"]["id"], created["meta"]["id"])

    def test_asr_status_is_serializable_without_optional_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            status = api.get_asr_status()
            self.assertIn("available", status)
            self.assertIn("loaded", status)
            self.assertTrue(status["message"])

    def test_transcription_rejects_non_audio_and_missing_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            result = api.transcribe_audio([{"id": "bad", "kind": "scene", "path": "../outside.wav"}])
            self.assertFalse(result["ok"])
            self.assertEqual(result["error"]["code"], "ASR_NO_AUDIO")

    def test_asset_inspection_reports_existing_and_missing_project_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            api = DesktopApi(store, root)
            (store.asset_dir / "exists.png").write_bytes(b"image")
            statuses = api.inspect_assets([
                {"id": "exists", "path": "exists.png"},
                {"id": "missing", "path": "missing.png"},
            ])
            self.assertTrue(statuses[0]["exists"])
            self.assertEqual(statuses[0]["size"], 5)
            self.assertFalse(statuses[1]["exists"])

    def test_asset_folder_repair_preview_and_apply_are_serializable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            api = DesktopApi(store, root)
            search = root / "restored"
            search.mkdir()
            source = search / "missing.png"
            source.write_bytes(b"image-data")
            preview = api.preview_asset_folder_repair(
                [{"assetId": "stable-image", "name": "missing", "path": "missing.png"}],
                str(search),
            )
            self.assertIsNotNone(preview)
            json.dumps(preview, ensure_ascii=False)
            self.assertEqual(preview["matches"][0]["assetId"], "stable-image")
            repaired = api.apply_asset_folder_repair(preview["matches"])
            self.assertEqual(repaired[0]["id"], "stable-image")
            self.assertTrue(repaired[0]["contentHash"])


if __name__ == "__main__":
    unittest.main()
