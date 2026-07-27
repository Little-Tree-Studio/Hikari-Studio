import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_ai_model_discovery_bridge_is_serializable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            discovery = {"models": [{"id": "gpt-5-mini", "category": "fast", "source": "upstream"}], "source": "upstream", "recommendedModelId": "gpt-5-mini"}
            with patch.object(api._ai, "discover_models", return_value=discovery):
                result = api.discover_ai_models({"url": "https://example.com/v1"})
            self.assertEqual(json.loads(json.dumps(result))["recommendedModelId"], "gpt-5-mini")

    def test_agent_task_bridge_persists_serializable_project_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = api.load_project()
            plan = {"summary": "完成", "assumptions": [], "operations": [{"type": "update_project", "name": "新名称"}], "toolCalls": [], "requestedBuilds": [], "usage": {}}
            with patch.object(api._agent_tasks.ai_service, "run", return_value=plan):
                started = api.start_ai_task("检查当前项目", project)
                deadline = time.time() + 2
                task = started
                while task["status"] not in {"completed", "failed"} and time.time() < deadline:
                    time.sleep(0.01)
                    task = api.get_ai_task(started["id"])
                self.assertEqual(task["status"], "completed")
                payload = json.loads(json.dumps(task, ensure_ascii=False))
                self.assertEqual(payload["plan"]["summary"], "完成")
                self.assertNotIn("patchPreconditions", payload)
                self.assertNotIn("scopes", payload["projectVersion"])
                self.assertEqual(api.list_ai_tasks()[0]["id"], started["id"])
                check = api.check_ai_patch_preconditions(started["id"], [0], project)
                self.assertTrue(check["canApply"])
                self.assertFalse(check["stale"])
                json.loads(json.dumps(check, ensure_ascii=False))
                changed = json.loads(json.dumps(project))
                changed["meta"]["name"] = "用户修改后的名称"
                conflict = api.check_ai_patch_preconditions(started["id"], [0], changed)
                self.assertFalse(conflict["canApply"])
                rebased = api.rebase_ai_patch(started["id"], [0], changed)
                self.assertEqual(rebased["parentTaskId"], started["id"])
                self.assertNotIn("executionInstruction", rebased)
                self.assertNotIn("patchPreconditions", rebased)
                self.assertNotIn("scopes", rebased["projectVersion"])
                retry = api.retry_ai_task_operations(started["id"], [0], project)
                self.assertEqual(retry["parentTaskId"], started["id"])
                self.assertEqual(retry["remainingOperationIndexes"], [0])
                session = api._store.project_root / ".hikari" / "agent" / "sessions" / f"{started['id']}.json"
                self.assertTrue(session.exists())
            api.stop_background_services()

    def test_agent_checkpoint_restart_bridge_hides_internal_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = api.load_project()
            plan = {"summary": "完成", "assumptions": [], "operations": [], "toolCalls": [], "requestedBuilds": [], "usage": {}}
            checkpoint = {"version": 1, "model": "test", "nextRound": 1, "messages": [{"role": "tool", "content": "private context"}], "usage": {}, "registry": {"proposedOperations": [], "requestedBuilds": [], "trace": [{"name": "get_project_overview", "permission": "read", "ok": True}]}}

            def run(instruction, project, checkpoint=None, progress=None, cancellation=None, execution_checkpoint=None, save_execution_checkpoint=None):
                if execution_checkpoint is None:
                    save_execution_checkpoint(checkpoint_state)
                return plan

            checkpoint_state = checkpoint
            with patch.object(api._agent_tasks.ai_service, "run", side_effect=run):
                source = api.start_ai_task("生成检查点", project)
                deadline = time.time() + 2
                while source["status"] != "completed" and time.time() < deadline:
                    time.sleep(0.01)
                    source = api.get_ai_task(source["id"])
                summary = source["checkpoints"][0]
                self.assertNotIn("state", summary)
                comparison = api.compare_ai_task_results({"taskId": source["id"], "checkpointId": summary["id"]}, {"taskId": source["id"]})
                self.assertEqual(comparison["left"]["label"], "检查点 1")
                self.assertEqual(comparison["right"]["label"], "最终结果")
                self.assertNotIn("state", json.loads(json.dumps(comparison)))
                branch = api.restart_ai_task_from_checkpoint(source["id"], summary["id"], project)
                self.assertEqual(branch["parentTaskId"], source["id"])
                self.assertNotIn("state", json.loads(json.dumps(branch))["checkpoints"][0])
            api.stop_background_services()

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
