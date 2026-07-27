from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from backend.agent_tasks import AgentTaskManager
from tests.test_agent_tools import sample_project


def wait_status(manager: AgentTaskManager, root: Path, task_id: str, statuses: set[str], timeout: float = 3) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = manager.get_task(task_id, root)
        if task["status"] in statuses:
            return task
        time.sleep(0.01)
    raise AssertionError(f"task {task_id} did not reach {statuses}")


class FastAi:
    def run(self, instruction, project, checkpoint=None, progress=None, cancellation=None, execution_checkpoint=None, save_execution_checkpoint=None):
        checkpoint()
        progress("thinking", "正在处理", {"instructionLength": len(instruction)})
        checkpoint()
        return {"summary": instruction, "assumptions": [], "operations": [], "toolCalls": [], "requestedBuilds": [], "usage": {}}


class PartialRetryAi:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def run(self, instruction, project, checkpoint=None, progress=None, cancellation=None, execution_checkpoint=None, save_execution_checkpoint=None):
        self.calls.append((instruction, project))
        operations = [{"type": "upsert_character", "name": "林澄"}, {"type": "update_branch", "fragmentId": "opening", "blockId": "choice", "title": "选择", "options": [{"text": "留下", "target": "opening"}]}] if len(self.calls) == 1 else []
        return {"summary": "partial retry", "assumptions": [], "operations": operations, "toolCalls": [], "requestedBuilds": [], "usage": {}}


class ControlledAi:
    def __init__(self, steps: int = 80) -> None:
        self.steps = steps
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def run(self, instruction, project, checkpoint=None, progress=None, cancellation=None, execution_checkpoint=None, save_execution_checkpoint=None):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            for index in range(self.steps):
                checkpoint()
                if index % 10 == 0:
                    progress("thinking", f"step {index}", {"step": index})
                time.sleep(0.005)
            return {"summary": instruction, "assumptions": [], "operations": [], "toolCalls": [], "requestedBuilds": [], "usage": {}}
        finally:
            with self.lock:
                self.active -= 1


class BlockingNetworkAi:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.aborted = threading.Event()

    def run(self, instruction, project, checkpoint=None, progress=None, cancellation=None, execution_checkpoint=None, save_execution_checkpoint=None):
        cancellation.register(self.aborted.set)
        self.started.set()
        self.aborted.wait(2)
        cancellation.raise_if_cancelled()
        raise AssertionError("network request should have been cancelled")


class CheckpointAi:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.aborted = threading.Event()
        self.restored: dict | None = None

    def run(self, instruction, project, checkpoint=None, progress=None, cancellation=None, execution_checkpoint=None, save_execution_checkpoint=None):
        if execution_checkpoint:
            self.restored = execution_checkpoint
            return {"summary": "resumed", "assumptions": [], "operations": [], "toolCalls": execution_checkpoint["registry"]["trace"], "requestedBuilds": [], "usage": {}}
        save_execution_checkpoint({"version": 1, "model": "test", "nextRound": 1, "messages": [], "usage": {}, "registry": {"proposedOperations": [], "requestedBuilds": [], "trace": [{"name": "get_project_overview", "permission": "read", "ok": True}]}})
        cancellation.register(self.aborted.set)
        self.started.set()
        self.aborted.wait(2)
        cancellation.raise_if_cancelled()
        raise AssertionError("pause should abort the provider request")


class HistoricalCheckpointAi:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.aborted = threading.Event()
        self.restored_steps: list[int] = []

    @staticmethod
    def checkpoint_state(step: int) -> dict:
        trace = [{"name": f"tool_{index}", "permission": "read", "ok": True} for index in range(1, step + 1)]
        return {"version": 1, "model": "test", "nextRound": step, "messages": [], "usage": {}, "registry": {"proposedOperations": [], "requestedBuilds": [], "trace": trace}}

    def run(self, instruction, project, checkpoint=None, progress=None, cancellation=None, execution_checkpoint=None, save_execution_checkpoint=None):
        if execution_checkpoint:
            step = len(execution_checkpoint["registry"]["trace"])
            self.restored_steps.append(step)
            return {"summary": f"resumed from {step}", "assumptions": [], "operations": [], "toolCalls": execution_checkpoint["registry"]["trace"], "requestedBuilds": [], "usage": {}}
        save_execution_checkpoint(self.checkpoint_state(1))
        save_execution_checkpoint(self.checkpoint_state(2))
        cancellation.register(self.aborted.set)
        self.started.set()
        self.aborted.wait(2)
        cancellation.raise_if_cancelled()
        raise AssertionError("pause should abort the provider request")


class AgentTaskManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "project"
        self.root.mkdir()
        self.managers: list[AgentTaskManager] = []

    def tearDown(self) -> None:
        for manager in self.managers:
            manager.stop()
        self.temporary.cleanup()

    def manager(self, ai) -> AgentTaskManager:
        manager = AgentTaskManager(ai)
        self.managers.append(manager)
        return manager

    def test_completed_task_streams_events_and_persists_without_project_snapshot(self) -> None:
        manager = self.manager(FastAi())
        started = manager.start_task("检查剧情", sample_project(), self.root)
        completed = wait_status(manager, self.root, started["id"], {"completed"})
        self.assertEqual(completed["plan"]["summary"], "检查剧情")
        incremental = manager.get_task(started["id"], self.root, after_seq=1)
        self.assertTrue(all(event["seq"] > 1 for event in incremental["events"]))
        session = self.root / ".hikari" / "agent" / "sessions" / f"{started['id']}.json"
        saved = session.read_text(encoding="utf-8")
        self.assertNotIn('"scripts"', saved)
        self.assertNotIn("apiKey", saved)
        self.assertEqual(json.loads(saved)["status"], "completed")

    def test_queue_executes_only_one_task_at_a_time(self) -> None:
        ai = ControlledAi(steps=25)
        manager = self.manager(ai)
        first = manager.start_task("first", sample_project(), self.root)
        second = manager.start_task("second", sample_project(), self.root)
        wait_status(manager, self.root, first["id"], {"completed"})
        wait_status(manager, self.root, second["id"], {"completed"})
        self.assertEqual(ai.max_active, 1)

    def test_running_task_can_pause_resume_and_cancel(self) -> None:
        manager = self.manager(ControlledAi())
        started = manager.start_task("long", sample_project(), self.root)
        wait_status(manager, self.root, started["id"], {"running"})
        manager.pause_task(started["id"], self.root)
        wait_status(manager, self.root, started["id"], {"paused"})
        manager.resume_task(started["id"], sample_project(), self.root)
        wait_status(manager, self.root, started["id"], {"running"})
        manager.cancel_task(started["id"], self.root)
        cancelled = wait_status(manager, self.root, started["id"], {"cancelled"})
        self.assertIsNone(cancelled["plan"])

    def test_cancel_aborts_active_provider_request(self) -> None:
        ai = BlockingNetworkAi()
        manager = self.manager(ai)
        started = manager.start_task("cancel network", sample_project(), self.root)
        self.assertTrue(ai.started.wait(1))
        manager.cancel_task(started["id"], self.root)
        cancelled = wait_status(manager, self.root, started["id"], {"cancelled"})
        self.assertTrue(ai.aborted.is_set())
        self.assertTrue(any(event["type"] == "cancel_requested" for event in cancelled["events"]))

    def test_pause_aborts_request_and_resume_uses_saved_checkpoint(self) -> None:
        ai = CheckpointAi()
        manager = self.manager(ai)
        started = manager.start_task("pause and resume", sample_project(), self.root)
        self.assertTrue(ai.started.wait(1))
        manager.pause_task(started["id"], self.root)
        paused = wait_status(manager, self.root, started["id"], {"paused"})
        self.assertTrue(ai.aborted.is_set())
        self.assertEqual(paused["checkpointStep"], 1)
        self.assertNotIn("executionCheckpoint", paused)
        manager.resume_task(started["id"], sample_project(), self.root)
        completed = wait_status(manager, self.root, started["id"], {"completed"})
        self.assertIsNotNone(ai.restored)
        self.assertEqual(completed["plan"]["toolCalls"][0]["name"], "get_project_overview")

    def test_interrupted_task_can_resume_after_manager_restart(self) -> None:
        first_manager = self.manager(ControlledAi(steps=200))
        started = first_manager.start_task("resume me", sample_project(), self.root)
        wait_status(first_manager, self.root, started["id"], {"running"})
        first_manager.stop()
        second_manager = self.manager(FastAi())
        listed = second_manager.list_tasks(self.root)
        self.assertEqual(next(task for task in listed if task["id"] == started["id"])["status"], "interrupted")
        second_manager.resume_task(started["id"], sample_project(), self.root)
        completed = wait_status(second_manager, self.root, started["id"], {"completed"})
        self.assertEqual(completed["attempt"], 2)

    def test_persisted_checkpoint_survives_manager_restart(self) -> None:
        first_ai = CheckpointAi()
        first_manager = self.manager(first_ai)
        started = first_manager.start_task("restart checkpoint", sample_project(), self.root)
        self.assertTrue(first_ai.started.wait(1))
        first_manager.stop()
        second_ai = CheckpointAi()
        second_manager = self.manager(second_ai)
        interrupted = next(task for task in second_manager.list_tasks(self.root) if task["id"] == started["id"])
        self.assertEqual(interrupted["status"], "interrupted")
        self.assertEqual(interrupted["checkpointStep"], 1)
        second_manager.resume_task(started["id"], sample_project(), self.root)
        completed = wait_status(second_manager, self.root, started["id"], {"completed"})
        self.assertIsNotNone(second_ai.restored)
        self.assertEqual(completed["plan"]["summary"], "resumed")

    def test_historical_checkpoint_creates_branch_without_mutating_source_task(self) -> None:
        ai = HistoricalCheckpointAi()
        manager = self.manager(ai)
        source = manager.start_task("branch history", sample_project(), self.root)
        self.assertTrue(ai.started.wait(1))
        manager.pause_task(source["id"], self.root)
        paused = wait_status(manager, self.root, source["id"], {"paused"})
        self.assertEqual([item["step"] for item in paused["checkpoints"]], [1, 2])
        self.assertTrue(all("state" not in item for item in paused["checkpoints"]))

        first_checkpoint = paused["checkpoints"][0]
        branch = manager.restart_from_checkpoint(source["id"], first_checkpoint["id"], sample_project(), self.root)
        self.assertNotEqual(branch["id"], source["id"])
        self.assertEqual(branch["parentTaskId"], source["id"])
        self.assertEqual(branch["sourceCheckpointId"], first_checkpoint["id"])
        completed = wait_status(manager, self.root, branch["id"], {"completed"})
        self.assertEqual(completed["plan"]["summary"], "resumed from 1")
        self.assertEqual(ai.restored_steps, [1])
        original = manager.get_task(source["id"], self.root)
        self.assertEqual(original["status"], "paused")
        self.assertEqual(len(original["checkpoints"]), 2)

    def test_structured_result_diff_classifies_modified_added_and_diagnostics(self) -> None:
        left = {
            "operations": [{"type": "add_blocks", "fragmentId": "opening", "blocks": [{"type": "narration", "text": "旧文本"}]}],
            "builds": [],
            "diagnostics": [{"name": "get_diagnostics", "permission": "validate", "ok": True, "summary": "1 warning"}],
        }
        right = {
            "operations": [
                {"type": "add_blocks", "fragmentId": "opening", "blocks": [{"type": "narration", "text": "新文本"}]},
                {"type": "create_fragment", "chapterId": "start", "name": "分支", "blocks": []},
                {"type": "upsert_character", "characterId": "hero", "name": "林澄", "portraits": {"默认": "portrait"}},
                {"type": "update_asset", "assetId": "portrait", "forceBundle": True},
                {"type": "upsert_variable", "name": "affection", "defaultValue": 1, "valueType": "number", "persistence": "slot"},
                {"type": "update_branch", "fragmentId": "opening", "blockId": "choice", "title": "选择", "options": [{"text": "继续", "target": "opening"}]},
            ],
            "builds": [{"target": "web", "blocked": False, "requiresConfirmation": True}],
            "diagnostics": [{"name": "get_diagnostics", "permission": "validate", "ok": True, "summary": "clean"}],
        }
        categories = AgentTaskManager._diff_snapshots(left, right)
        by_name = {category["name"]: category["items"] for category in categories}
        self.assertEqual(by_name["剧本 Block"][0]["status"], "modified")
        self.assertEqual(by_name["剧本 Block"][0]["target"], {"kind": "fragment", "id": "opening"})
        self.assertEqual(by_name["章节与 Fragment"][0]["status"], "added")
        self.assertEqual(by_name["角色配置"][0]["target"], {"kind": "character", "id": "hero"})
        self.assertEqual(by_name["素材引用"][0]["target"], {"kind": "asset", "id": "portrait"})
        self.assertEqual({item["target"]["kind"] for item in by_name["变量与分支"]}, {"variable", "fragment"})
        self.assertEqual(by_name["诊断结果"][0]["status"], "modified")
        self.assertEqual(by_name["构建请求"][0]["status"], "added")

    def test_rejected_operations_create_child_task_with_current_project(self) -> None:
        ai = PartialRetryAi()
        manager = self.manager(ai)
        source = manager.start_task("配置角色和分支", sample_project(), self.root)
        source = wait_status(manager, self.root, source["id"], {"completed"})
        current_project = sample_project()
        current_project["meta"]["name"] = "已应用角色修改"
        child = manager.retry_remaining_operations(source["id"], [1], current_project, self.root)
        self.assertEqual(child["parentTaskId"], source["id"])
        self.assertEqual(child["remainingOperationIndexes"], [1])
        self.assertNotIn("executionInstruction", child)
        self.assertTrue(child["instruction"].startswith("重新执行 1 项未接受修改"))
        completed = wait_status(manager, self.root, child["id"], {"completed"})
        self.assertEqual(completed["status"], "completed")
        self.assertIn('"type":"update_branch"', ai.calls[1][0])
        self.assertNotIn('"type":"upsert_character"', ai.calls[1][0])
        self.assertEqual(ai.calls[1][1]["meta"]["name"], "已应用角色修改")

    def test_rejected_operation_retry_rejects_invalid_indexes(self) -> None:
        manager = self.manager(PartialRetryAi())
        source = manager.start_task("配置角色和分支", sample_project(), self.root)
        source = wait_status(manager, self.root, source["id"], {"completed"})
        with self.assertRaisesRegex(ValueError, "索引无效"):
            manager.retry_remaining_operations(source["id"], [8], sample_project(), self.root)


if __name__ == "__main__":
    unittest.main()
