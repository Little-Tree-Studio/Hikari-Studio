import json
import base64
import gzip
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api import DesktopApi
from backend.project_store import ProjectStore, blank_project


class DesktopApiTests(unittest.TestCase):
    def test_clipboard_script_preview_is_read_and_parsed_by_python(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            characters = [{"id": "su", "name": "苏", "expressions": ["默认", "微笑"]}]
            with patch("backend.api.read_system_clipboard_text", return_value="苏[微笑]：早上好。"):
                preview = api.preview_clipboard_script(characters=characters, rules={"expressionSyntax": "brackets"})
            self.assertEqual(preview["format"], "TXT")
            self.assertEqual(preview["blocks"][0]["type"], "dialogue")
            self.assertEqual(preview["blocks"][0]["speaker"], "苏")
            self.assertEqual(preview["blocks"][0]["expression"], "微笑")
            self.assertEqual(preview["matches"][0]["characterId"], "su")
            self.assertEqual(preview["rules"]["expressionSyntax"], "brackets")

    def test_clipboard_preview_uses_editor_fallback_when_windows_is_busy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            with patch("backend.api.read_system_clipboard_text", side_effect=OSError("busy")):
                preview = api.preview_clipboard_script("旁白文本")
            self.assertEqual(preview["blocks"][0]["text"], "旁白文本")

    def test_startup_project_request_is_exposed_to_the_frontend(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            self.assertFalse(api.get_app_info()["startupProjectRequested"])
            api.mark_startup_project_requested()
            info = api.get_app_info()
            self.assertTrue(info["startupProjectRequested"])
            self.assertEqual(info["version"], "0.4.0-beta.1")

    def test_command_history_bridge_persists_serializable_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = api.load_project()
            history = {
                "version": 1,
                "projectId": project["meta"]["id"],
                "undo": [{"id": "command-1", "label": "AI Agent：测试", "timestamp": 1, "before": project, "after": project}],
                "redo": [],
            }
            result = api.save_command_history(history)
            self.assertTrue(result["ok"])
            self.assertIn(str(Path(".slide") / "history" / "commands.json"), result["path"])
            self.assertEqual(json.loads(json.dumps(api.load_command_history(), ensure_ascii=False)), history)
            stats = api.load_command_history_stats()
            self.assertEqual(stats["version"], 1)
            self.assertEqual(stats["commandCount"], 1)
            self.assertEqual(stats["ordinaryCount"], 1)
            self.assertEqual(stats["pinnedCount"], 0)
            json.loads(json.dumps(stats, ensure_ascii=False))

    def test_recovery_snapshot_bridge_returns_validated_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = api.load_project()
            snapshot = api.load_recovery_snapshot()
            self.assertEqual(snapshot["project"]["meta"]["id"], project["meta"]["id"])
            self.assertFalse(snapshot["recoveredDuringLoad"])
            json.loads(json.dumps(snapshot, ensure_ascii=False))

    def test_recovery_snapshot_status_does_not_load_project_body(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            api.load_project()
            with patch.object(api._store, "_load_recovery", side_effect=AssertionError("snapshot body was parsed")):
                status = api.get_recovery_snapshot_status()
            self.assertTrue(status["exists"])
            self.assertGreater(status["bytes"], 0)
            self.assertTrue(status["updatedAt"])

    def test_project_json_bridge_returns_serializable_v3_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = json.loads(api.load_project_json())
            self.assertEqual(project["version"], 3)
            self.assertGreater(len(project["chapters"]), 0)

    def test_profiled_project_session_separates_backend_bridge_and_frontend_timings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            envelope = api.load_project_session_profiled("reload-test-1")
            self.assertEqual(envelope["encoding"], "gzip-base64")
            project = json.loads(gzip.decompress(base64.b64decode(envelope["projectPayload"])))
            backend = envelope["backend"]

            self.assertEqual(project["version"], 3)
            self.assertEqual(backend["reloadId"], "reload-test-1")
            self.assertGreater(backend["payloadBytes"], 100)
            self.assertGreater(backend["transportBytes"], 0)
            self.assertLess(backend["transportBytes"], backend["payloadBytes"])
            self.assertGreaterEqual(backend["pythonCompressionMs"], 0)
            self.assertGreaterEqual(backend["projectLoadMs"], 0)
            self.assertGreaterEqual(backend["pythonSerializationMs"], 0)
            self.assertEqual(backend["counts"]["blocks"], sum(len(blocks) for blocks in project["scripts"].values()))
            self.assertFalse(api.get_project_reload_performance()["complete"])

            completed = api.report_project_reload_performance("reload-test-1", "editor", {
                "bridgeRoundTripMs": 18.25,
                "webViewTransferEstimateMs": 7.5,
                "jsonParseMs": 2.75,
                "totalReloadMs": 45.5,
                "projectText": "must-not-enter-logs",
                "componentRenders": {
                    "block-list": {
                        "commits": 2, "mounts": 1, "updates": 1,
                        "actualDurationMs": 12.25, "mountDurationMs": 8.5, "updateDurationMs": 3.75,
                        "baseDurationMs": 18.5, "lastCommitTimeMs": 32.0,
                        "firstMeasurementDurationMs": 1.25, "observerMeasurementDurationMs": 0.5,
                        "firstMeasurements": 17, "remeasurements": 34, "observerCallbacks": 2,
                        "revisionFlushes": 1, "peakObservedRows": 18,
                        "viewportMeasurements": 2, "viewportUpdates": 1, "viewportRangeFlushes": 1,
                        "storyCardTypes": {
                            "dialogue": {"commits": 3, "mounts": 2, "updates": 1, "actualDurationMs": 2.5, "mountDurationMs": 2.0, "updateDurationMs": 0.5, "baseDurationMs": 3.0, "lastCommitTimeMs": 31.0, "text": "secret"},
                            "unknown": {"mountDurationMs": 999},
                        },
                        "dialogueRegions": {
                            "speaker": {"commits": 1, "mounts": 1, "updates": 0, "actualDurationMs": 0.9, "mountDurationMs": 0.9, "updateDurationMs": 0, "baseDurationMs": 1.2, "lastCommitTimeMs": 31.0, "speaker": "secret"},
                            "unknown": {"mountDurationMs": 999},
                        },
                        "blockText": "secret",
                    },
                    "unknown-surface": {"actualDurationMs": 999},
                },
            })
            self.assertTrue(completed["complete"])
            self.assertEqual(completed["frontend"]["bridgeRoundTripMs"], 18.25)
            self.assertEqual(completed["frontend"]["totalReloadMs"], 45.5)
            self.assertNotIn("projectText", completed["frontend"])
            self.assertEqual(completed["frontend"]["componentRenders"]["block-list"]["actualDurationMs"], 12.25)
            self.assertEqual(completed["frontend"]["componentRenders"]["block-list"]["mountDurationMs"], 8.5)
            self.assertEqual(completed["frontend"]["componentRenders"]["block-list"]["firstMeasurements"], 17)
            self.assertEqual(completed["frontend"]["componentRenders"]["block-list"]["peakObservedRows"], 18)
            self.assertEqual(completed["frontend"]["componentRenders"]["block-list"]["storyCardTypes"]["dialogue"]["mountDurationMs"], 2.0)
            self.assertNotIn("text", completed["frontend"]["componentRenders"]["block-list"]["storyCardTypes"]["dialogue"])
            self.assertNotIn("unknown", completed["frontend"]["componentRenders"]["block-list"]["storyCardTypes"])
            self.assertEqual(completed["frontend"]["componentRenders"]["block-list"]["dialogueRegions"]["speaker"]["mountDurationMs"], 0.9)
            self.assertNotIn("speaker", completed["frontend"]["componentRenders"]["block-list"]["dialogueRegions"]["speaker"])
            self.assertNotIn("unknown", completed["frontend"]["componentRenders"]["block-list"]["dialogueRegions"])
            self.assertNotIn("blockText", completed["frontend"]["componentRenders"]["block-list"])
            self.assertNotIn("unknown-surface", completed["frontend"]["componentRenders"])
            self.assertEqual(api.get_project_reload_performance(), completed)

            with self.assertRaises(ValueError):
                api.report_project_reload_performance("another-reload", "editor", {})

    def test_preview_seek_performance_bridge_is_bounded_and_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            reported = api.report_preview_seek_performance({
                "version": 1,
                "sampleCount": 900,
                "sampledDurations": 700,
                "inputCount": 1200,
                "coalescedInputs": 300,
                "restoreDurationMs": {"total": 18.5, "average": 0.02, "p95": 0.04, "max": 0.2, "dialogue": "secret"},
                "heap": {"startBytes": 1000, "peakBytes": 1800, "stableBytes": 1400, "peakDeltaBytes": 800, "stableDeltaBytes": 400, "projectPath": "secret"},
                "engineSeekCache": {"exactHits": 400, "checkpointHits": 20, "misses": 80, "invalidations": 1, "evictions": 10, "cachedFragments": 5, "cachedResults": 64, "cachedCheckpoints": 70, "evictionRate": 0.02, "text": "secret"},
                "traceRestoreCache": {"exactHits": 600, "misses": 300, "invalidations": 2, "evictions": 72, "cachedResults": 128, "evictionRate": 0.08, "assetPath": "secret"},
                "projectText": "must-not-enter-logs",
            })
            self.assertEqual(reported["sampleCount"], 900)
            self.assertEqual(reported["sampledDurations"], 512)
            self.assertEqual(reported["inputCount"], 1200)
            self.assertEqual(reported["coalescedInputs"], 300)
            self.assertEqual(reported["heap"]["stableDeltaBytes"], 400)
            self.assertEqual(reported["traceRestoreCache"]["cachedResults"], 128)
            self.assertNotIn("projectText", reported)
            self.assertNotIn("dialogue", reported["restoreDurationMs"])
            self.assertNotIn("projectPath", reported["heap"])
            self.assertNotIn("text", reported["engineSeekCache"])
            self.assertNotIn("assetPath", reported["traceRestoreCache"])
            self.assertEqual(api.get_preview_seek_performance(), reported)

    def test_profiled_project_session_has_plain_json_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            envelope = api.load_project_session_profiled("reload-plain", False)
            self.assertEqual(envelope["encoding"], "plain-json")
            self.assertEqual(json.loads(envelope["projectPayload"])["version"], 3)

    def test_project_session_rejects_stale_path_and_token_for_same_project_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            original_session = api.load_project_session()
            original_path = Path(original_session["projectPath"])
            copy_root = root / "copied-project"
            shutil.copytree(original_path.parent, copy_root)

            copied_session = api.open_project_path_session(str(copy_root / "project.slide.json"))
            self.assertEqual(copied_session["project"]["meta"]["id"], original_session["project"]["meta"]["id"])
            with self.assertRaisesRegex(ValueError, "Project session changed"):
                api.save_project(
                    original_session["project"],
                    original_session["project"]["meta"]["id"],
                    original_session["projectPath"],
                    original_session["sessionToken"],
                )

            changed = copied_session["project"]
            changed["meta"]["name"] = "只修改副本"
            api.save_project(
                changed,
                changed["meta"]["id"],
                copied_session["projectPath"],
                copied_session["sessionToken"],
            )
            self.assertEqual(api.load_project()["meta"]["name"], "只修改副本")
            self.assertNotEqual(json.loads(original_path.read_text(encoding="utf-8"))["meta"]["name"], "只修改副本")

    def test_runtime_storage_bridge_persists_across_api_instances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = DesktopApi(ProjectStore(root / "data"), root)
            self.assertTrue(first.write_runtime_value("slide-save:test:quick", '{"op":4}'))
            second = DesktopApi(ProjectStore(root / "data"), root)
            self.assertEqual(second.read_runtime_value("slide-save:test:quick"), '{"op":4}')
            self.assertTrue(second.delete_runtime_value("slide-save:test:quick"))
            self.assertIsNone(first.read_runtime_value("slide-save:test:quick"))

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

    def test_configured_project_creation_supports_blank_template_and_custom_location(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            target = root / "projects" / "night-voyage"
            session = api.create_project_session({
                "template": "blank",
                "name": "夜航",
                "projectDirectory": str(target),
                "resolution": [1920, 1080],
                "author": "Slide Team",
                "description": "一段夜间航行的故事",
                "windowTitle": "夜航 - Demo",
                "backgroundColor": "#112233",
            })
            project = session["project"]
            self.assertEqual(Path(session["projectPath"]).resolve(), (target / "project.slide.json").resolve())
            self.assertTrue((target / "project.slide.json").is_file())
            self.assertEqual(project["meta"]["resolution"], [1920, 1080])
            self.assertEqual(project["meta"]["windowTitle"], "夜航 - Demo")
            self.assertEqual(project["ui"]["title"]["backgroundColor"], "#112233")
            self.assertEqual(project["characters"], [])
            self.assertEqual(project["chapters"][0]["name"], "开始")
            self.assertEqual(project["scripts"], {"opening": []})

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
                session = api._store.project_root / ".slide" / "agent" / "sessions" / f"{started['id']}.json"
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

    def test_agent_patch_apply_is_atomic_persisted_and_not_repeatable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = api.load_project()
            fragment_id = project["activeFragmentId"]
            before_count = len(project["scripts"][fragment_id])
            plan = {"summary": "追加旁白", "assumptions": [], "operations": [{"type": "add_blocks", "fragmentId": fragment_id, "blocks": [{"type": "narration", "text": "原子写入"}]}], "toolCalls": [], "requestedBuilds": [], "usage": {}}
            with patch.object(api._agent_tasks.ai_service, "run", return_value=plan):
                started = api.start_ai_task("追加旁白", project)
                deadline = time.time() + 2
                task = started
                while task["status"] != "completed" and time.time() < deadline:
                    time.sleep(0.01)
                    task = api.get_ai_task(started["id"])
                applied = api.apply_ai_patch(started["id"], [0], project)
                self.assertTrue(applied["ok"])
                self.assertEqual(applied["appliedOperationIndexes"], [0])
                self.assertEqual(len(api.load_project()["scripts"][fragment_id]), before_count + 1)
                self.assertEqual(api.get_ai_task(started["id"])["appliedOperationIndexes"], [0])

                duplicate = api.apply_ai_patch(started["id"], [0], applied["project"])
                self.assertFalse(duplicate["ok"])
                self.assertEqual(len(api.load_project()["scripts"][fragment_id]), before_count + 1)
            api.stop_background_services()

    def test_agent_patch_conflict_does_not_write_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            project = api.load_project()
            fragment_id = project["activeFragmentId"]
            plan = {"summary": "追加旁白", "assumptions": [], "operations": [{"type": "add_blocks", "fragmentId": fragment_id, "blocks": [{"type": "narration", "text": "不应写入"}]}], "toolCalls": [], "requestedBuilds": [], "usage": {}}
            with patch.object(api._agent_tasks.ai_service, "run", return_value=plan):
                started = api.start_ai_task("追加旁白", project)
                deadline = time.time() + 2
                task = started
                while task["status"] != "completed" and time.time() < deadline:
                    time.sleep(0.01)
                    task = api.get_ai_task(started["id"])
                changed = json.loads(json.dumps(project))
                changed["scripts"][fragment_id][0]["text"] = "用户修改"
                before_disk = api.load_project()
                rejected = api.apply_ai_patch(started["id"], [0], changed)
                self.assertFalse(rejected["ok"])
                self.assertEqual(rejected["conflicts"][0]["scope"], f"script:{fragment_id}")
                self.assertEqual(api.load_project(), before_disk)
            api.stop_background_services()

    def test_transcription_rejects_non_audio_and_missing_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = DesktopApi(ProjectStore(root / "data"), root)
            result = api.transcribe_audio([{"id": "bad", "kind": "scene", "path": "../outside.wav"}])
            self.assertFalse(result["ok"])
            self.assertEqual(result["error"]["code"], "ASR_NO_AUDIO")

    def test_builds_use_a_safe_subdirectory_inside_the_selected_export_folder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "data")
            api = DesktopApi(store, root)
            project = blank_project("Custom Output")
            selected = root / "selected builds"

            renpy = api.export_renpy(project, str(selected))
            self.assertEqual(Path(renpy["path"]).resolve(), (selected / "Custom-Output" / "renpy" / "script.rpy").resolve())

            web_entry = selected / "Custom-Output" / "web" / "index.html"
            web_entry.parent.mkdir(parents=True)
            web_entry.write_text("<html></html>", encoding="utf-8")
            with patch("backend.api.build_web_game", return_value=web_entry) as build_web:
                web_result = api.build_web(project, None, str(selected))
            self.assertTrue(web_result["ok"])
            self.assertEqual(build_web.call_args.args[1].resolve(), (selected / "Custom-Output" / "web").resolve())

            windows_entry = selected / "Custom-Output" / "windows" / "Custom-Output.exe"
            windows_entry.parent.mkdir(parents=True)
            windows_entry.write_bytes(b"executable")
            with patch("backend.api.build_windows_game", return_value=windows_entry) as build_windows:
                windows_result = api.build_windows(project, None, str(selected), "system")
            self.assertTrue(windows_result["ok"])
            self.assertEqual(build_windows.call_args.args[1].resolve(), (selected / "Custom-Output" / "windows").resolve())
            self.assertEqual(build_windows.call_args.kwargs["browser_mode"], "system")

            with patch("backend.api.os.startfile") as startfile:
                opened = api.open_build_output(web_result["path"])
                launched = api.launch_build_output(web_result["path"])
            self.assertEqual(Path(opened["path"]).resolve(), web_entry.parent.resolve())
            self.assertEqual(Path(launched["path"]).resolve(), web_entry.resolve())
            self.assertEqual([Path(call.args[0]).resolve() for call in startfile.call_args_list], [web_entry.parent.resolve(), web_entry.resolve()])

            with patch("backend.api.subprocess.Popen") as popen:
                launched = api.launch_build_output(windows_result["path"])
            self.assertEqual(Path(launched["path"]).resolve(), windows_entry.resolve())
            popen.assert_called_once_with([str(windows_entry)], cwd=str(windows_entry.parent), close_fds=True)

            with self.assertRaisesRegex(ValueError, "Ren'Py"):
                api.launch_build_output(renpy["path"])
            with self.assertRaisesRegex(ValueError, "本次会话"):
                api.open_build_output(str(root / "untrusted.exe"))

            with self.assertRaisesRegex(ValueError, "绝对路径"):
                api.export_renpy(project, "relative-folder")
            file_path = root / "not-a-folder"
            file_path.write_text("file", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "文件夹"):
                api.export_renpy(project, str(file_path))
            api.stop_background_services()

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
