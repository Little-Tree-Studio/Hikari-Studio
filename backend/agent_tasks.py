from __future__ import annotations

import hashlib
import inspect
import json
import os
import queue
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .ai_service import AiService
from .ai_provider import ProviderRequestCancelled, RequestCancellation
from .dpapi import protect as dpapi_protect, unprotect as dpapi_unprotect


ACTIVE_STATUSES = {"queued", "running", "pausing", "paused", "cancelling"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


class AgentTaskCancelled(RuntimeError):
    pass


class AgentTaskInterrupted(RuntimeError):
    pass


class AgentTaskPaused(RuntimeError):
    pass


class TaskControl:
    def __init__(self) -> None:
        self.cancel = threading.Event()
        self.pause = threading.Event()
        self.cancellation = RequestCancellation()


class AgentTaskManager:
    def __init__(self, ai_service: AiService) -> None:
        self.ai_service = ai_service
        self._lock = threading.RLock()
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._tasks: dict[str, dict[str, Any]] = {}
        self._projects: dict[str, dict[str, Any]] = {}
        self._roots: dict[str, Path] = {}
        self._controls: dict[str, TaskControl] = {}
        self._worker: threading.Thread | None = None
        self._stop = threading.Event()
        self._active_task_id: str | None = None

    def start_task(self, instruction: str, project: dict[str, Any], project_root: Path, context: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._enqueue_new_task(instruction, project, project_root, context=context)

    def _enqueue_new_task(self, instruction: str, project: dict[str, Any], project_root: Path, parent_task_id: str | None = None, remaining_operation_indexes: list[int] | None = None, display_instruction: str | None = None, initial_event: tuple[str, str] | None = None, context: dict[str, Any] | None = None) -> dict[str, Any]:
        instruction = instruction.strip()
        if not instruction:
            raise ValueError("请先描述希望 Agent 完成的任务")
        task_id = uuid.uuid4().hex
        now = self._now()
        project_version = self._project_version(project)
        clean_context = deepcopy(context) if isinstance(context, dict) else {}
        clean_context["projectFingerprint"] = project_version["fingerprint"]
        task = {
            "id": task_id,
            "instruction": display_instruction or instruction,
            "displayInstruction": display_instruction or instruction,
            "executionInstruction": instruction if display_instruction else None,
            "status": "queued",
            "projectId": str(project.get("meta", {}).get("id", "")),
            "projectName": str(project.get("meta", {}).get("name", "")),
            "createdAt": now,
            "updatedAt": now,
            "startedAt": None,
            "completedAt": None,
            "attempt": 1,
            "checkpointStep": 0,
            "checkpointModel": None,
            "currentCheckpointId": None,
            "checkpoints": [],
            "executionCheckpoint": None,
            "parentTaskId": parent_task_id,
            "sourceCheckpointId": None,
            "remainingOperationIndexes": remaining_operation_indexes or [],
            "appliedOperationIndexes": [],
            "projectVersion": project_version,
            "context": clean_context,
            "patchPreconditions": [],
            "events": [],
            "lastEventSeq": 0,
            "plan": None,
            "error": None,
        }
        with self._lock:
            self._tasks[task_id] = task
            self._projects[task_id] = deepcopy(project)
            self._roots[task_id] = project_root.resolve()
            self._controls[task_id] = TaskControl()
            if initial_event:
                event_type, message = initial_event
                self._append_event_locked(task_id, event_type, message, {"sourceTaskId": parent_task_id, "operationIndexes": remaining_operation_indexes or []})
            elif parent_task_id:
                self._append_event_locked(task_id, "remaining_retry", "正在重新规划未接受的修改", {"sourceTaskId": parent_task_id, "operationIndexes": remaining_operation_indexes or []})
            self._append_event_locked(task_id, "queued", "任务已加入队列", {})
            self._ensure_worker_locked()
            self._queue.put(task_id)
            return self._public_task(task)

    def retry_remaining_operations(self, task_id: str, operation_indexes: list[int], project: dict[str, Any], project_root: Path) -> dict[str, Any]:
        root = project_root.resolve()
        with self._lock:
            source = deepcopy(self._find_task_locked(task_id, root))
        plan = source.get("plan") or {}
        operations = plan.get("operations") or []
        if not isinstance(operation_indexes, list) or not operation_indexes:
            raise ValueError("请选择需要重新执行的 Agent 操作")
        if any(not isinstance(index, int) or isinstance(index, bool) for index in operation_indexes):
            raise ValueError("未接受操作索引无效")
        indexes = sorted(set(operation_indexes))
        if any(index < 0 or index >= len(operations) for index in indexes):
            raise ValueError("未接受操作索引无效")
        remaining = [operations[index] for index in indexes]
        payload = json.dumps(remaining, ensure_ascii=False, separators=(",", ":"))
        instruction = (
            f"继续完成原任务：{source.get('instruction', '')}\n"
            "用户已应用其它修改。请基于当前项目重新检查并仅重新规划以下未接受操作；不要重复已经接受的内容。\n"
            f"未接受操作：{payload[:20000]}"
        )
        display = f"重新执行 {len(indexes)} 项未接受修改 · {source.get('displayInstruction') or source.get('instruction', '')}"
        return self._enqueue_new_task(
            instruction,
            project,
            root,
            source["id"],
            indexes,
            display,
            context=source.get("context"),
        )

    def check_patch_preconditions(self, task_id: str, operation_indexes: list[int], project: dict[str, Any], project_root: Path) -> dict[str, Any]:
        root = project_root.resolve()
        with self._lock:
            task = deepcopy(self._find_task_locked(task_id, root))
        plan = task.get("plan") or {}
        operations = plan.get("operations") or []
        indexes = self._validated_operation_indexes(operation_indexes, len(operations))
        baseline = task.get("projectVersion") or {}
        current = self._project_version(project)
        preconditions = {int(item.get("operationIndex", -1)): item for item in task.get("patchPreconditions") or []}
        conflicts: list[dict[str, Any]] = []
        for index in indexes:
            operation = operations[index]
            item = preconditions.get(index)
            if not item:
                conflicts.append({"operationIndex": index, "operationType": operation.get("type", "unknown"), "scope": "project", "message": "该历史 Patch 没有版本前置条件，需要基于当前项目重新生成"})
                continue
            for scope in item.get("scopes") or []:
                expected = str(item.get("expected", {}).get(scope, "missing"))
                actual = str(current["scopes"].get(scope, "missing"))
                if expected != actual:
                    conflicts.append({"operationIndex": index, "operationType": operation.get("type", "unknown"), "scope": scope, "expectedHash": expected, "currentHash": actual, "message": self._conflict_message(operation, scope)})
        return {"taskId": task_id, "stale": baseline.get("fingerprint") != current["fingerprint"], "canApply": not conflicts, "baseFingerprint": baseline.get("fingerprint"), "currentFingerprint": current["fingerprint"], "conflicts": conflicts}

    def apply_patch_to_project(self, task_id: str, operation_indexes: list[int], project: dict[str, Any], project_root: Path) -> dict[str, Any]:
        root = project_root.resolve()
        with self._lock:
            task = deepcopy(self._find_task_locked(task_id, root))
        operations = (task.get("plan") or {}).get("operations") or []
        indexes = self._validated_operation_indexes(operation_indexes, len(operations))
        already_applied = set(task.get("appliedOperationIndexes") or [])
        duplicates = [index for index in indexes if index in already_applied]
        if duplicates:
            conflicts = [{"operationIndex": index, "operationType": operations[index].get("type", "unknown"), "scope": "agent-task", "message": "该 Patch 操作已经应用，不能重复写入"} for index in duplicates]
            current = self._project_version(project)
            return {"taskId": task_id, "stale": True, "canApply": False, "ok": False, "baseFingerprint": (task.get("projectVersion") or {}).get("fingerprint"), "currentFingerprint": current["fingerprint"], "conflicts": conflicts, "appliedOperationIndexes": []}
        precondition = self.check_patch_preconditions(task_id, indexes, project, root)
        if not precondition["canApply"]:
            return {**precondition, "ok": False, "appliedOperationIndexes": []}
        selected = [operations[index] for index in indexes]
        updated = self._apply_operations(project, selected)
        return {
            **precondition,
            "ok": True,
            "project": updated,
            "appliedOperationIndexes": indexes,
            "summary": str((task.get("plan") or {}).get("summary") or "Agent 修改"),
        }

    def mark_patch_applied(self, task_id: str, operation_indexes: list[int], project_root: Path) -> None:
        root = project_root.resolve()
        with self._lock:
            task = self._find_task_locked(task_id, root)
            applied = sorted(set(task.get("appliedOperationIndexes") or []) | set(operation_indexes))
            task["appliedOperationIndexes"] = applied
            self._append_event_locked(task_id, "patch_applied", f"已原子应用并保存 {len(operation_indexes)} 项修改", {"operationIndexes": operation_indexes})

    def rebase_patch(self, task_id: str, operation_indexes: list[int], project: dict[str, Any], project_root: Path) -> dict[str, Any]:
        root = project_root.resolve()
        with self._lock:
            source = deepcopy(self._find_task_locked(task_id, root))
        operations = (source.get("plan") or {}).get("operations") or []
        indexes = self._validated_operation_indexes(operation_indexes, len(operations))
        payload = json.dumps([operations[index] for index in indexes], ensure_ascii=False, separators=(",", ":"))
        instruction = f"基于当前项目重新生成过期的 Agent Patch。保留原任务目标，但只重新规划以下冲突操作，不要重复其它内容：\n{payload[:20000]}"
        display = f"重新生成 {len(indexes)} 项过期 Patch · {source.get('displayInstruction') or source.get('instruction', '')}"
        return self._enqueue_new_task(
            instruction,
            project,
            root,
            source["id"],
            indexes,
            display,
            ("patch_rebase", "正在基于最新项目重新生成 Patch"),
            source.get("context"),
        )

    def restart_from_checkpoint(self, task_id: str, checkpoint_id: str, project: dict[str, Any], project_root: Path) -> dict[str, Any]:
        root = project_root.resolve()
        with self._lock:
            source = self._find_task_locked(task_id, root)
            checkpoints = source.get("checkpoints") or []
            selected_index = next((index for index, item in enumerate(checkpoints) if item.get("id") == checkpoint_id), -1)
            if selected_index < 0:
                raise ValueError("Agent 检查点不存在")
            selected = checkpoints[selected_index]
            state = selected.get("state")
            if not isinstance(state, dict):
                raise ValueError("Agent 检查点数据已损坏")
            new_id = uuid.uuid4().hex
            now = self._now()
            inherited = deepcopy(checkpoints[: selected_index + 1])
            for item in inherited:
                item["inherited"] = True
            task = {
                "id": new_id,
                "instruction": source["instruction"],
                "displayInstruction": source.get("displayInstruction") or source["instruction"],
                "executionInstruction": source.get("executionInstruction"),
                "status": "queued",
                "projectId": str(project.get("meta", {}).get("id", "")),
                "projectName": str(project.get("meta", {}).get("name", "")),
                "createdAt": now,
                "updatedAt": now,
                "startedAt": None,
                "completedAt": None,
                "attempt": int(source.get("attempt") or 1) + 1,
                "checkpointStep": int(selected.get("step") or 0),
                "checkpointModel": selected.get("model"),
                "currentCheckpointId": checkpoint_id,
                "checkpoints": inherited,
                "executionCheckpoint": deepcopy(state),
                "parentTaskId": source["id"],
                "sourceCheckpointId": checkpoint_id,
                "remainingOperationIndexes": [],
                "appliedOperationIndexes": [],
                "projectVersion": self._project_version(project),
                "context": deepcopy(source.get("context") or {}),
                "patchPreconditions": [],
                "events": [],
                "lastEventSeq": 0,
                "plan": None,
                "error": None,
            }
            task["context"]["projectFingerprint"] = task["projectVersion"]["fingerprint"]
            self._tasks[new_id] = task
            self._projects[new_id] = deepcopy(project)
            self._roots[new_id] = root
            self._controls[new_id] = TaskControl()
            self._append_event_locked(new_id, "checkpoint_selected", f"已选择历史检查点 {task['checkpointStep']}", {"sourceTaskId": source["id"], "checkpointId": checkpoint_id, "checkpointStep": task["checkpointStep"]})
            self._append_event_locked(new_id, "queued", "派生任务已加入队列", {})
            self._ensure_worker_locked()
            self._queue.put(new_id)
            return self._public_task(task)

    def list_tasks(self, project_root: Path) -> list[dict[str, Any]]:
        root = project_root.resolve()
        sessions = self._sessions_dir(root)
        loaded: dict[str, dict[str, Any]] = {}
        if sessions.exists():
            for path in sessions.glob("*.json"):
                task = self._read_task(path)
                if task:
                    loaded[task["id"]] = self._normalize_task(task)
        with self._lock:
            for task_id, task in self._tasks.items():
                if self._roots.get(task_id) == root:
                    loaded[task_id] = deepcopy(task)
            for task_id, task in loaded.items():
                if task_id not in self._tasks and task.get("status") in ACTIVE_STATUSES:
                    task["status"] = "interrupted"
                    task["updatedAt"] = self._now()
                    task["error"] = "应用上次关闭时任务尚未完成，可使用当前项目状态恢复"
                    self._write_task(root, task)
        return [self._public_task(task, include_events=False) for task in sorted(loaded.values(), key=lambda item: item.get("createdAt", ""), reverse=True)[:100]]

    def compare_results(self, left: dict[str, Any], right: dict[str, Any], project_root: Path) -> dict[str, Any]:
        """Compare public structured outcomes without exposing model messages."""
        root = project_root.resolve()
        with self._lock:
            left_snapshot = self._comparison_snapshot_locked(left, root)
            right_snapshot = self._comparison_snapshot_locked(right, root)
        return {"left": left_snapshot["ref"], "right": right_snapshot["ref"], "categories": self._diff_snapshots(left_snapshot, right_snapshot)}

    def get_task(self, task_id: str, project_root: Path, after_seq: int = 0) -> dict[str, Any]:
        task = self._find_task(task_id, project_root)
        result = self._public_task(task)
        result["events"] = [event for event in result.get("events", []) if int(event.get("seq", 0)) > max(0, int(after_seq))]
        return result

    def pause_task(self, task_id: str, project_root: Path) -> dict[str, Any]:
        with self._lock:
            task = self._find_task_locked(task_id, project_root)
            if task["status"] not in {"queued", "running", "pausing"}:
                raise ValueError("当前任务不能暂停")
            control = self._controls.setdefault(task_id, TaskControl())
            control.pause.set()
            control.cancellation.cancel()
            task["status"] = "paused" if task["status"] == "queued" else "pausing"
            self._append_event_locked(task_id, "pause_requested", "正在中止当前请求并保存执行位置", {"checkpointStep": task.get("checkpointStep", 0)})
            return self._public_task(task)

    def resume_task(self, task_id: str, project: dict[str, Any], project_root: Path) -> dict[str, Any]:
        root = project_root.resolve()
        with self._lock:
            task = self._find_task_locked(task_id, root)
            if task["status"] not in {"paused", "interrupted"}:
                raise ValueError("当前任务不能恢复")
            control = self._controls.setdefault(task_id, TaskControl())
            control.pause.clear()
            control.cancel.clear()
            if control.cancellation.cancelled:
                control.cancellation = RequestCancellation()
            self._projects[task_id] = deepcopy(project)
            self._roots[task_id] = root
            task["status"] = "queued"
            task["attempt"] = int(task.get("attempt") or 1) + 1
            task["plan"] = None
            task["error"] = None
            task["completedAt"] = None
            self._tasks[task_id] = task
            message = "任务已从最近检查点重新加入队列" if task.get("executionCheckpoint") else "任务没有可用检查点，将从当前步骤重新开始"
            self._append_event_locked(task_id, "resumed", message, {"attempt": task["attempt"], "checkpointStep": task.get("checkpointStep", 0)})
            self._ensure_worker_locked()
            self._queue.put(task_id)
            return self._public_task(task)

    def cancel_task(self, task_id: str, project_root: Path) -> dict[str, Any]:
        with self._lock:
            task = self._find_task_locked(task_id, project_root)
            if task["status"] in TERMINAL_STATUSES or task["status"] == "interrupted":
                raise ValueError("当前任务不能取消")
            control = self._controls.setdefault(task_id, TaskControl())
            control.cancel.set()
            control.pause.clear()
            control.cancellation.cancel()
            if self._active_task_id == task_id:
                task["status"] = "cancelling"
                self._append_event_locked(task_id, "cancel_requested", "正在中止当前网络请求", {})
            else:
                task["status"] = "cancelled"
                task["completedAt"] = self._now()
                self._append_event_locked(task_id, "cancelled", "任务已取消", {})
            return self._public_task(task)

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            for task_id, task in self._tasks.items():
                if task.get("status") in ACTIVE_STATUSES:
                    task["status"] = "interrupted"
                    task["error"] = "应用关闭，任务已中断"
                    self._append_event_locked(task_id, "interrupted", "应用关闭，任务已中断", {})
                    self._controls.setdefault(task_id, TaskControl()).cancel.set()
                    self._controls[task_id].cancellation.cancel()
        self._queue.put(None)
        worker = self._worker
        if worker and worker.is_alive():
            worker.join(timeout=2)
        self._worker = None

    def _ensure_worker_locked(self) -> None:
        if self._worker and self._worker.is_alive():
            return
        self._stop.clear()
        self._worker = threading.Thread(target=self._worker_loop, name="slide-agent-queue", daemon=True)
        self._worker.start()

    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            task_id = self._queue.get()
            if task_id is None:
                return
            with self._lock:
                task = self._tasks.get(task_id)
                if not task or task.get("status") != "queued":
                    continue
                self._active_task_id = task_id
                task["status"] = "running"
                task["startedAt"] = task.get("startedAt") or self._now()
                self._append_event_locked(task_id, "started", "任务开始执行", {"attempt": task.get("attempt", 1)})
                project = deepcopy(self._projects[task_id])
            try:
                run_kwargs = {
                    "checkpoint": lambda: self._checkpoint(task_id),
                    "progress": lambda kind, message, data=None: self._progress(task_id, kind, message, data or {}),
                    "cancellation": self._controls[task_id].cancellation,
                    "execution_checkpoint": deepcopy(task.get("executionCheckpoint")),
                    "save_execution_checkpoint": lambda value: self._save_execution_checkpoint(task_id, value),
                }
                if "context" in inspect.signature(self.ai_service.run).parameters:
                    run_kwargs["context"] = deepcopy(task.get("context") or {})
                plan = self.ai_service.run(task.get("executionInstruction") or task["instruction"], project, **run_kwargs)
                with self._lock:
                    task = self._tasks[task_id]
                    task["status"] = "completed"
                    task["plan"] = plan
                    task["patchPreconditions"] = self._patch_preconditions(plan, task.get("projectVersion") or {})
                    task["executionCheckpoint"] = None
                    task["completedAt"] = self._now()
                    self._append_event_locked(task_id, "completed", "任务已完成，等待确认修改", {"operationCount": len(plan.get("operations", []))})
            except AgentTaskPaused:
                with self._lock:
                    task = self._tasks[task_id]
                    task["status"] = "paused"
                    self._append_event_locked(task_id, "paused", "任务已暂停，可从最近检查点继续", {"checkpointStep": task.get("checkpointStep", 0)})
            except (AgentTaskCancelled, ProviderRequestCancelled):
                with self._lock:
                    task = self._tasks[task_id]
                    control = self._controls[task_id]
                    if task.get("status") == "interrupted":
                        pass
                    elif control.pause.is_set() or task.get("status") == "pausing":
                        task["status"] = "paused"
                        self._append_event_locked(task_id, "paused", "任务已暂停，可从最近检查点继续", {"checkpointStep": task.get("checkpointStep", 0)})
                    else:
                        task["status"] = "cancelled"
                        task["completedAt"] = self._now()
                        self._append_event_locked(task_id, "cancelled", "任务已取消", {})
            except AgentTaskInterrupted:
                pass
            except Exception as error:
                with self._lock:
                    task = self._tasks[task_id]
                    task["status"] = "failed"
                    task["error"] = str(error)[:500]
                    task["completedAt"] = self._now()
                    self._append_event_locked(task_id, "failed", "任务执行失败", {"message": task["error"]})
            finally:
                with self._lock:
                    if self._active_task_id == task_id:
                        self._active_task_id = None
                    if self._tasks.get(task_id, {}).get("status") not in {"paused", "interrupted", "queued"}:
                        self._projects.pop(task_id, None)

    def _checkpoint(self, task_id: str) -> None:
        if self._stop.is_set():
            raise AgentTaskInterrupted()
        with self._lock:
            control = self._controls[task_id]
            if control.cancel.is_set():
                raise AgentTaskCancelled()
            if control.pause.is_set():
                raise AgentTaskPaused()

    def _save_execution_checkpoint(self, task_id: str, checkpoint: dict[str, Any]) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            checkpoint_id = uuid.uuid4().hex
            task["executionCheckpoint"] = deepcopy(checkpoint)
            task["checkpointStep"] = len(checkpoint.get("registry", {}).get("trace", []))
            task["checkpointModel"] = checkpoint.get("model")
            task["currentCheckpointId"] = checkpoint_id
            task.setdefault("checkpoints", []).append({
                "id": checkpoint_id,
                "createdAt": self._now(),
                "attempt": task.get("attempt", 1),
                "step": task["checkpointStep"],
                "round": int(checkpoint.get("nextRound", 0)),
                "model": task["checkpointModel"],
                "toolNames": [str(item.get("name", "")) for item in checkpoint.get("registry", {}).get("trace", []) if item.get("name")],
                "snapshot": self._checkpoint_snapshot(checkpoint),
                "state": deepcopy(checkpoint),
                "inherited": False,
            })
            self._append_event_locked(task_id, "checkpoint_saved", f"已保存工具步骤 {task['checkpointStep']}", {"checkpointId": checkpoint_id, "checkpointStep": task["checkpointStep"], "round": checkpoint.get("nextRound", 0), "model": task["checkpointModel"]})

    def _progress(self, task_id: str, kind: str, message: str, data: dict[str, Any]) -> None:
        with self._lock:
            if task_id in self._tasks:
                data.setdefault("attempt", self._tasks[task_id].get("attempt", 1))
                self._append_event_locked(task_id, kind, message, data)

    def _append_event_locked(self, task_id: str, kind: str, message: str, data: dict[str, Any]) -> None:
        task = self._tasks[task_id]
        seq = int(task.get("lastEventSeq") or 0) + 1
        task["lastEventSeq"] = seq
        task["updatedAt"] = self._now()
        task.setdefault("events", []).append({"seq": seq, "timestamp": task["updatedAt"], "type": kind, "message": message, "data": data})
        self._write_task(self._roots[task_id], task)

    def _find_task(self, task_id: str, project_root: Path) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._find_task_locked(task_id, project_root))

    def _find_task_locked(self, task_id: str, project_root: Path) -> dict[str, Any]:
        if not task_id or any(character not in "0123456789abcdef" for character in task_id.lower()):
            raise ValueError("无效的 Agent 任务 ID")
        root = project_root.resolve()
        if task_id in self._tasks and self._roots.get(task_id) == root:
            return self._normalize_task(self._tasks[task_id])
        task = self._read_task(self._sessions_dir(root) / f"{task_id}.json")
        if not task:
            raise ValueError("Agent 任务不存在")
        self._tasks[task_id] = task
        self._roots[task_id] = root
        return self._normalize_task(task)

    def _comparison_snapshot_locked(self, reference: dict[str, Any], root: Path) -> dict[str, Any]:
        task_id = str(reference.get("taskId", ""))
        checkpoint_id = reference.get("checkpointId")
        task = self._find_task_locked(task_id, root)
        if checkpoint_id:
            checkpoint = next((item for item in task.get("checkpoints", []) if item.get("id") == checkpoint_id), None)
            if not checkpoint:
                raise ValueError("Agent 比较检查点不存在")
            snapshot = checkpoint.get("snapshot") or self._checkpoint_snapshot(checkpoint.get("state") or {})
            label = f"检查点 {checkpoint.get('step', 0)}"
        else:
            plan = task.get("plan") or {}
            snapshot = {"operations": deepcopy(plan.get("operations") or []), "builds": deepcopy(plan.get("requestedBuilds") or []), "diagnostics": self._diagnostic_trace(plan.get("toolCalls") or [])}
            label = "最终结果" if task.get("plan") else "当前任务"
        return {**snapshot, "ref": {"taskId": task_id, "checkpointId": checkpoint_id, "label": label, "instruction": task.get("displayInstruction") or task.get("instruction", "")}}

    @staticmethod
    def _hash_value(value: Any) -> str:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    @classmethod
    def _project_version(cls, project: dict[str, Any]) -> dict[str, Any]:
        clean = deepcopy(project)
        clean.get("meta", {}).pop("updatedAt", None)
        clean.pop("activeFragmentId", None)
        settings = clean.get("settings")
        if isinstance(settings, dict):
            settings.pop("editorSession", None)
        scopes: dict[str, str] = {
            "meta": cls._hash_value(clean.get("meta", {})), "chapters": cls._hash_value(clean.get("chapters", [])),
            "characters": cls._hash_value(clean.get("characters", [])), "assets": cls._hash_value(clean.get("assets", [])),
            "variables": cls._hash_value({"values": clean.get("variables", {}), "definitions": clean.get("variableDefinitions", {})}),
            "settings": cls._hash_value(clean.get("settings", {})), "scenes": cls._hash_value(clean.get("scenes", [])),
            "production-memory": cls._hash_value(clean.get("productionMemory", {})),
        }
        for fragment_id, blocks in clean.get("scripts", {}).items(): scopes[f"script:{fragment_id}"] = cls._hash_value(blocks)
        for character in clean.get("characters", []): scopes[f"character:{character.get('id')}"] = cls._hash_value(character)
        for asset in clean.get("assets", []): scopes[f"asset:{asset.get('id')}"] = cls._hash_value(asset)
        variables = clean.get("variables", {})
        definitions = clean.get("variableDefinitions", {})
        for name in set(variables) | set(definitions):
            scopes[f"variable:{name}"] = cls._hash_value({"value": variables.get(name), "definition": definitions.get(name)})
        return {"fingerprint": cls._hash_value(clean), "capturedAt": cls._now(), "scopes": scopes}

    @staticmethod
    def _operation_scopes(operation: dict[str, Any]) -> list[str]:
        kind = operation.get("type")
        if kind == "update_project": return ["meta"]
        if kind in {"add_blocks", "insert_blocks", "update_blocks", "move_blocks", "update_branch"}: return [f"script:{operation.get('fragmentId')}"]
        if kind == "create_fragment": return ["chapters"]
        if kind == "create_chapter": return ["chapters"]
        if kind == "upsert_character": return [f"character:{operation['characterId']}"] if operation.get("characterId") else ["characters"]
        if kind == "upsert_scene": return [f"scene:{operation['sceneId']}"] if operation.get("sceneId") else ["scenes"]
        if kind == "update_asset": return [f"asset:{operation.get('assetId')}"]
        if kind == "upsert_variable": return [f"variable:{operation.get('name')}"]
        if kind == "update_narrative_map": return ["meta"]
        if kind == "update_production_memory": return ["production-memory"]
        return ["meta"]

    @classmethod
    def _patch_preconditions(cls, plan: dict[str, Any], version: dict[str, Any]) -> list[dict[str, Any]]:
        scopes = version.get("scopes") or {}
        return [{"operationIndex": index, "scopes": targets, "expected": {target: scopes.get(target, "missing") for target in targets}} for index, operation in enumerate(plan.get("operations") or []) for targets in [cls._operation_scopes(operation)]]

    @staticmethod
    def _conflict_message(operation: dict[str, Any], scope: str) -> str:
        labels = {"add_blocks": "目标 Fragment 的剧本", "insert_blocks": "目标 Fragment 的剧本", "update_blocks": "目标 Fragment 的剧本", "move_blocks": "目标 Fragment 的剧本", "update_branch": "目标分支所在剧本", "create_fragment": "章节结构", "create_chapter": "章节结构", "upsert_character": "目标角色配置", "upsert_scene": "目标场景配置", "update_asset": "目标素材配置", "upsert_variable": "目标变量", "update_narrative_map": "叙事地图布局", "update_project": "项目基本信息", "update_production_memory": "制作记忆"}
        return f"{labels.get(str(operation.get('type')), scope)}在 Patch 生成后已被修改"

    @staticmethod
    def _validated_operation_indexes(operation_indexes: list[int], operation_count: int) -> list[int]:
        if not isinstance(operation_indexes, list) or not operation_indexes or any(not isinstance(index, int) or isinstance(index, bool) for index in operation_indexes):
            raise ValueError("Patch 操作索引无效")
        indexes = sorted(set(operation_indexes))
        if any(index < 0 or index >= operation_count for index in indexes):
            raise ValueError("Patch 操作索引无效")
        return indexes

    @staticmethod
    def _apply_operations(project: dict[str, Any], operations: list[dict[str, Any]]) -> dict[str, Any]:
        next_project = deepcopy(project)
        chapters = next_project.setdefault("chapters", [])
        scripts = next_project.setdefault("scripts", {})
        characters = next_project.setdefault("characters", [])
        assets = next_project.setdefault("assets", [])
        chapter_ids = {str(chapter.get("id")) for chapter in chapters}
        fragment_ids = {str(fragment.get("id")) for chapter in chapters for fragment in chapter.get("fragments", [])}
        character_ids = {str(character.get("id")) for character in characters}
        asset_ids = {str(asset.get("id")) for asset in assets}
        scene_ids = {str(scene.get("id")) for scene in next_project.get("scenes", [])}

        def validate_block_references(block: dict[str, Any]) -> None:
            if not isinstance(block, dict):
                raise ValueError("Agent Patch 包含无效的 Block")
            referenced_assets = [block.get("assetId")]
            referenced_assets.extend(layer.get("assetId") for layer in block.get("layers", []) if isinstance(layer, dict))
            if any(str(asset_id) not in asset_ids for asset_id in filter(None, referenced_assets)):
                raise ValueError("Agent Patch 的 Block 素材引用无效")
            if block.get("sceneId") and str(block["sceneId"]) not in scene_ids:
                raise ValueError("Agent Patch 的 Block 场景引用无效")
            if block.get("characterId") and str(block["characterId"]) not in character_ids:
                raise ValueError("Agent Patch 的 Block 角色引用无效")
            targets: list[Any] = []
            if block.get("type") == "branch":
                targets = [option.get("target") for option in block.get("options", []) if isinstance(option, dict)]
            elif block.get("type") == "condition":
                targets = [block.get("trueTarget"), block.get("falseTarget")]
            elif block.get("type") in {"jump", "call"}:
                targets = [block.get("target")]
            if any(str(target) not in fragment_ids for target in filter(None, targets)):
                raise ValueError("Agent Patch 的 Block Fragment 引用无效")

        for operation in operations:
            kind = operation.get("type")
            if kind == "add_blocks":
                fragment_id = str(operation.get("fragmentId") or "")
                if fragment_id not in fragment_ids or not isinstance(operation.get("blocks"), list):
                    raise ValueError("Agent Patch 引用了无效的目标 Fragment")
                for block in operation["blocks"]:
                    validate_block_references(block)
            elif kind == "insert_blocks":
                fragment_id = str(operation.get("fragmentId") or "")
                blocks = scripts.get(fragment_id)
                position = operation.get("position")
                anchor = operation.get("anchorBlockId")
                if not isinstance(blocks, list) or not isinstance(operation.get("blocks"), list) or position not in {"before", "after", "start", "end"}:
                    raise ValueError("Agent Patch 的插入 Block 操作无效")
                if position in {"before", "after"} and not any(block.get("id") == anchor for block in blocks):
                    raise ValueError("Agent Patch 的插入锚点不存在")
                for block in operation["blocks"]:
                    validate_block_references(block)
            elif kind == "update_blocks":
                fragment_id = str(operation.get("fragmentId") or "")
                blocks = scripts.get(fragment_id)
                ids = {str(block.get("id")) for block in blocks or []}
                updates = operation.get("updates")
                if not isinstance(blocks, list) or not isinstance(updates, list) or not updates or any(str(update.get("blockId")) not in ids or not isinstance(update.get("patch"), dict) or any(key in update["patch"] for key in ("id", "type")) for update in updates):
                    raise ValueError("Agent Patch 的 Block 更新无效")
                originals = {str(block.get("id")): block for block in blocks}
                for update in updates:
                    validate_block_references({**originals[str(update["blockId"])], **update["patch"]})
            elif kind == "move_blocks":
                fragment_id = str(operation.get("fragmentId") or "")
                blocks = scripts.get(fragment_id)
                ids = {str(block.get("id")) for block in blocks or []}
                moving = [str(value) for value in operation.get("blockIds") or []]
                position = operation.get("position")
                anchor = str(operation.get("anchorBlockId") or "")
                if not isinstance(blocks, list) or not moving or len(set(moving)) != len(moving) or any(value not in ids for value in moving) or position not in {"before", "after", "start", "end"}:
                    raise ValueError("Agent Patch 的 Block 移动无效")
                if position in {"before", "after"} and (anchor not in ids or anchor in moving):
                    raise ValueError("Agent Patch 的移动锚点无效")
            elif kind == "create_fragment":
                if str(operation.get("chapterId") or "") not in chapter_ids or not isinstance(operation.get("blocks"), list):
                    raise ValueError("Agent Patch 引用了无效的目标章节")
                for block in operation["blocks"]:
                    validate_block_references(block)
            elif kind == "upsert_character":
                character_id = operation.get("characterId")
                if character_id and str(character_id) not in character_ids:
                    raise ValueError("Agent Patch 引用了不存在的角色")
                portraits = operation.get("portraits") or {}
                if not isinstance(portraits, dict) or any(str(asset_id) not in asset_ids for asset_id in portraits.values()):
                    raise ValueError("Agent Patch 的角色立绘引用无效")
            elif kind == "update_asset":
                if str(operation.get("assetId") or "") not in asset_ids:
                    raise ValueError("Agent Patch 引用了不存在的素材")
                voice_character_id = operation.get("voiceCharacterId")
                if voice_character_id and str(voice_character_id) not in character_ids:
                    raise ValueError("Agent Patch 的语音角色引用无效")
            elif kind == "upsert_variable":
                value = operation.get("defaultValue")
                value_type = operation.get("valueType")
                valid = (value_type == "boolean" and isinstance(value, bool)) or (value_type == "number" and isinstance(value, (int, float)) and not isinstance(value, bool)) or (value_type == "string" and isinstance(value, str))
                if not valid:
                    raise ValueError("Agent Patch 的变量默认值类型无效")
            elif kind == "update_branch":
                fragment_id = str(operation.get("fragmentId") or "")
                block_id = str(operation.get("blockId") or "")
                block = next((item for item in scripts.get(fragment_id, []) if str(item.get("id")) == block_id and item.get("type") == "branch"), None)
                options = operation.get("options")
                if block is None or not isinstance(options, list) or any(str(option.get("target") or "") not in fragment_ids for option in options):
                    raise ValueError("Agent Patch 的分支引用无效")
            elif kind == "create_chapter":
                if not isinstance(operation.get("name"), str) or not operation["name"].strip():
                    raise ValueError("Agent Patch 的章节名称无效")
                if any(str(chapter.get("name")) == operation["name"] for chapter in chapters):
                    raise ValueError("Agent Patch 的章节名称重复")
                if "blocks" in operation and not isinstance(operation.get("blocks"), list):
                    raise ValueError("Agent Patch 的章节 Block 无效")
                for block in operation.get("blocks") or []:
                    validate_block_references(block)
            elif kind == "upsert_scene":
                scene_id = operation.get("sceneId")
                if scene_id and str(scene_id) not in scene_ids:
                    raise ValueError("Agent Patch 引用了不存在的场景")
                layers = operation.get("layers")
                if layers is not None:
                    if not isinstance(layers, list) or any(not isinstance(layer, dict) or (layer.get("assetId") and str(layer["assetId"]) not in asset_ids) for layer in layers):
                        raise ValueError("Agent Patch 的场景图层引用无效")
            elif kind == "update_narrative_map":
                positions = operation.get("positions")
                if positions is not None and (not isinstance(positions, dict) or any(not isinstance(point, dict) or not isinstance(point.get("x"), (int, float)) or not isinstance(point.get("y"), (int, float)) for point in positions.values())):
                    raise ValueError("Agent Patch 的叙事地图坐标无效")
                if operation.get("viewMode") is not None and operation.get("viewMode") not in {"graph", "flow"}:
                    raise ValueError("Agent Patch 的叙事地图视图模式无效")
                connections = operation.get("connections")
                if connections is not None and (not isinstance(connections, list) or any(str(item.get("from") or "") not in fragment_ids or str(item.get("to") or "") not in fragment_ids or item.get("kind") not in {"jump", "call"} for item in connections)):
                    raise ValueError("Agent Patch 的叙事地图连线无效")
            elif kind == "update_production_memory":
                memory = operation.get("memory")
                if not isinstance(memory, dict) or int(memory.get("version", 0)) != 1:
                    raise ValueError("Agent Patch 的制作记忆格式无效")
                if any(not isinstance(memory.get(section), list) for section in ("characterRules", "styleRules", "facts", "restrictions")):
                    raise ValueError("Agent Patch 的制作记忆分类无效")
            elif kind != "update_project":
                raise ValueError(f"Agent Patch 包含不支持的操作: {kind}")

        for operation in operations:
            kind = operation["type"]
            if kind == "update_project":
                if operation.get("name"):
                    next_project["meta"]["name"] = operation["name"]
                if operation.get("author"):
                    next_project["meta"]["author"] = operation["author"]
            elif kind == "add_blocks":
                fragment_id = operation["fragmentId"]
                scripts[fragment_id] = [*scripts.get(fragment_id, []), *[{**block, "id": f"block-{uuid.uuid4().hex[:10]}"} for block in operation["blocks"]]]
            elif kind == "insert_blocks":
                fragment_id = operation["fragmentId"]
                current = scripts[fragment_id]
                position = operation["position"]
                anchor_index = next((index for index, block in enumerate(current) if block.get("id") == operation.get("anchorBlockId")), 0)
                insert_at = 0 if position == "start" else len(current) if position == "end" else anchor_index + (1 if position == "after" else 0)
                inserted = [{**block, "id": f"block-{uuid.uuid4().hex[:10]}"} for block in operation["blocks"]]
                scripts[fragment_id] = [*current[:insert_at], *inserted, *current[insert_at:]]
            elif kind == "update_blocks":
                fragment_id = operation["fragmentId"]
                updates = {update["blockId"]: update["patch"] for update in operation["updates"]}
                scripts[fragment_id] = [{**block, **deepcopy(updates[str(block.get("id"))])} if str(block.get("id")) in updates else block for block in scripts[fragment_id]]
            elif kind == "move_blocks":
                fragment_id = operation["fragmentId"]
                moving_ids = set(operation["blockIds"])
                moving = [block for block in scripts[fragment_id] if str(block.get("id")) in moving_ids]
                remaining = [block for block in scripts[fragment_id] if str(block.get("id")) not in moving_ids]
                position = operation["position"]
                anchor_index = next((index for index, block in enumerate(remaining) if block.get("id") == operation.get("anchorBlockId")), 0)
                insert_at = 0 if position == "start" else len(remaining) if position == "end" else anchor_index + (1 if position == "after" else 0)
                scripts[fragment_id] = [*remaining[:insert_at], *moving, *remaining[insert_at:]]
            elif kind == "create_fragment":
                fragment_id = f"fragment-{uuid.uuid4().hex[:10]}"
                chapter = next(item for item in chapters if item.get("id") == operation["chapterId"])
                chapter.setdefault("fragments", []).append({"id": fragment_id, "name": operation["name"]})
                scripts[fragment_id] = [{**block, "id": f"block-{uuid.uuid4().hex[:10]}"} for block in operation["blocks"]]
                fragment_ids.add(fragment_id)
            elif kind == "upsert_character":
                existing = next((item for item in characters if item.get("id") == operation.get("characterId")), None) if operation.get("characterId") else next((item for item in characters if item.get("name") == operation.get("name")), None)
                character = deepcopy(existing) if existing else {"id": f"character-{uuid.uuid4().hex[:10]}", "color": "#2f8b78", "expressions": ["默认"]}
                character["name"] = operation["name"]
                for key in ("color", "description", "expressions", "portraits", "defaultPosition", "defaultScale"):
                    if key in operation:
                        character[key] = deepcopy(operation[key])
                if existing:
                    characters[characters.index(existing)] = character
                else:
                    characters.append(character)
                    character_ids.add(str(character["id"]))
            elif kind == "update_asset":
                asset = next(item for item in assets if item.get("id") == operation["assetId"])
                for key in ("name", "forceBundle", "audioCategory", "voiceCharacterId"):
                    if key in operation:
                        asset[key] = operation[key]
            elif kind == "upsert_variable":
                name = operation["name"]
                next_project.setdefault("variables", {})[name] = operation["defaultValue"]
                definition = {"type": operation["valueType"], "scope": "project", "persistence": operation["persistence"]}
                for key in ("displayName", "description"):
                    if key in operation:
                        definition[key] = operation[key]
                next_project.setdefault("variableDefinitions", {})[name] = definition
            elif kind == "update_branch":
                fragment_id = operation["fragmentId"]
                scripts[fragment_id] = [{**block, "title": operation["title"], "options": deepcopy(operation["options"])} if block.get("id") == operation["blockId"] and block.get("type") == "branch" else block for block in scripts[fragment_id]]
            elif kind == "create_chapter":
                chapter_id = f"chapter-{uuid.uuid4().hex[:10]}"
                chapter = {"id": chapter_id, "name": operation["name"], "entry": bool(operation.get("entry")), "fragments": []}
                if operation.get("fragmentName"):
                    fragment_id = f"fragment-{uuid.uuid4().hex[:10]}"
                    chapter["fragments"].append({"id": fragment_id, "name": operation["fragmentName"]})
                    scripts[fragment_id] = [{**block, "id": f"block-{uuid.uuid4().hex[:10]}"} for block in operation.get("blocks") or []]
                    fragment_ids.add(fragment_id)
                chapters.append(chapter)
                chapter_ids.add(chapter_id)
            elif kind == "upsert_scene":
                scenes = next_project.setdefault("scenes", [])
                existing = next((item for item in scenes if item.get("id") == operation.get("sceneId")), None) if operation.get("sceneId") else next((item for item in scenes if item.get("name") == operation.get("name")), None)
                scene = deepcopy(existing) if existing else {"id": f"scene-{uuid.uuid4().hex[:10]}", "name": operation.get("name"), "layers": []}
                if operation.get("name"):
                    scene["name"] = operation["name"]
                if operation.get("groupId"):
                    scene["groupId"] = operation["groupId"]
                if "layers" in operation:
                    scene["layers"] = [{**layer, "id": f"layer-{uuid.uuid4().hex[:10]}"} for layer in operation["layers"]]
                if existing:
                    scenes[scenes.index(existing)] = scene
                else:
                    scenes.append(scene)
                    scene_ids.add(str(scene["id"]))
            elif kind == "update_narrative_map":
                settings = next_project.setdefault("settings", {})
                narrative_map = settings.setdefault("narrativeMap", {})
                if operation.get("positions"):
                    narrative_map.setdefault("positions", {}).update(deepcopy(operation["positions"]))
                if operation.get("viewMode"):
                    narrative_map["viewMode"] = operation["viewMode"]
                for connection in operation.get("connections") or []:
                    source = connection["from"]
                    block = {"id": f"block-{uuid.uuid4().hex[:10]}", "type": connection["kind"], "version": 1, "target": connection["to"]}
                    scripts.setdefault(source, []).append(block)
            elif kind == "update_production_memory":
                next_project["productionMemory"] = deepcopy(operation["memory"])
        return next_project

    @staticmethod
    def _checkpoint_snapshot(checkpoint: dict[str, Any]) -> dict[str, Any]:
        registry = checkpoint.get("registry") or {}
        return {"operations": deepcopy(registry.get("proposedOperations") or []), "builds": deepcopy(registry.get("requestedBuilds") or []), "diagnostics": AgentTaskManager._diagnostic_trace(registry.get("trace") or [])}

    @staticmethod
    def _diagnostic_trace(trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [deepcopy(item) for item in trace if item.get("permission") == "validate" or item.get("name") in {"get_diagnostics", "validate_patch"}]

    @staticmethod
    def _diff_snapshots(left: dict[str, Any], right: dict[str, Any]) -> list[dict[str, Any]]:
        def identity(field: str, value: dict[str, Any], index: int) -> str:
            if field == "operations":
                kind = value.get("type")
                target = value.get("fragmentId") or value.get("chapterId") or value.get("characterId") or value.get("assetId") or value.get("name") or "project"
                return f"{kind}:{target}:{value.get('name', '')}"
            if field == "builds":
                return str(value.get("target", index))
            return str(value.get("name", index))

        def describe(operation: dict[str, Any]) -> tuple[str, str, dict[str, Any] | None]:
            kind = operation.get("type")
            if kind == "add_blocks":
                blocks = operation.get("blocks") or []
                return "剧本 Block", f"向 {operation.get('fragmentId', '未知片段')} 添加 {len(blocks)} 个 Block", {"kind": "fragment", "id": operation.get("fragmentId")}
            if kind == "insert_blocks":
                return "剧本 Block", f"在 {operation.get('fragmentId', '未知片段')} 的 {operation.get('position', '锚点')} 插入 {len(operation.get('blocks') or [])} 个 Block", {"kind": "fragment", "id": operation.get("fragmentId")}
            if kind == "update_blocks":
                return "剧本 Block", f"更新 {operation.get('fragmentId', '未知片段')} 的 {len(operation.get('updates') or [])} 个 Block", {"kind": "fragment", "id": operation.get("fragmentId")}
            if kind == "move_blocks":
                return "剧本 Block", f"移动 {operation.get('fragmentId', '未知片段')} 的 {len(operation.get('blockIds') or [])} 个 Block", {"kind": "fragment", "id": operation.get("fragmentId")}
            if kind == "create_fragment":
                blocks = operation.get("blocks") or []
                return "章节与 Fragment", f"在章节 {operation.get('chapterId', '未知章节')} 创建 {operation.get('name', '未命名片段')}（{len(blocks)} Blocks）", {"kind": "chapter", "id": operation.get("chapterId")}
            if kind == "update_project":
                fields = "、".join(item for item in ("名称" if operation.get("name") else "", "作者" if operation.get("author") else "") if item)
                return "项目配置", f"更新{fields or '项目信息'}", {"kind": "project", "id": None}
            if kind == "upsert_character":
                portraits = operation.get("portraits") or {}
                return "角色配置", f"配置角色 {operation.get('name', '未命名')}（{len(portraits)} 个立绘引用）", {"kind": "character", "id": operation.get("characterId")}
            if kind == "update_asset":
                return "素材引用", f"更新素材 {operation.get('assetId', '未知素材')} 的元数据与打包策略", {"kind": "asset", "id": operation.get("assetId")}
            if kind == "upsert_variable":
                return "变量与分支", f"配置变量 {operation.get('name', '未命名')}（{operation.get('valueType', '未知类型')}）", {"kind": "variable", "id": operation.get("name")}
            if kind == "update_branch":
                options = operation.get("options") or []
                return "变量与分支", f"修改分支 {operation.get('blockId', '未知 Block')}（{len(options)} 个选项）", {"kind": "fragment", "id": operation.get("fragmentId")}
            if kind == "create_chapter":
                blocks = operation.get("blocks") or []
                return "章节与 Fragment", f"创建章节 {operation.get('name', '未命名')}{'（含初始 Fragment）' if operation.get('fragmentName') else ''}（{len(blocks)} Blocks）", {"kind": "chapter", "id": None}
            if kind == "upsert_scene":
                layers = operation.get("layers") or []
                return "场景配置", f"配置场景 {operation.get('name', operation.get('sceneId', '未命名'))}（{len(layers)} 个图层）", {"kind": "scene", "id": operation.get("sceneId")}
            if kind == "update_narrative_map":
                connections = operation.get("connections") or []
                positions = operation.get("positions") or {}
                parts = []
                if positions: parts.append(f"{len(positions)} 个节点位置")
                if connections: parts.append(f"{len(connections)} 条连线")
                if operation.get("viewMode"): parts.append("视图模式")
                return "叙事地图", f"更新{'、'.join(parts) or '叙事地图'}", {"kind": "chapter", "id": None}
            if kind == "update_production_memory":
                memory = operation.get("memory") or {}
                count = sum(len(memory.get(section) or []) for section in ("characterRules", "styleRules", "facts", "restrictions"))
                return "制作记忆", f"更新世界观与 {count} 条制作规则", {"kind": "memory", "id": None}
            return "其他", str(kind or "未知操作"), None

        categories: dict[str, list[dict[str, Any]]] = {}
        for field, fixed_category in (("operations", None), ("builds", "构建请求"), ("diagnostics", "诊断结果")):
            left_values = {identity(field, item, index): item for index, item in enumerate(left.get(field, []))}
            right_values = {identity(field, item, index): item for index, item in enumerate(right.get(field, []))}
            changes = [("removed", item_id) for item_id in left_values.keys() - right_values.keys()]
            changes += [("added", item_id) for item_id in right_values.keys() - left_values.keys()]
            changes += [("modified", item_id) for item_id in left_values.keys() & right_values.keys() if left_values[item_id] != right_values[item_id]]
            for status, item_id in changes:
                source = left_values if status == "removed" else right_values
                item = source[item_id]
                if field == "operations":
                    category, summary, target = describe(item)
                elif field == "builds":
                    category, summary, target = fixed_category, f"{item.get('target', '未知')} 构建请求", None
                else:
                    category, summary, target = fixed_category, f"{item.get('name', '诊断')}：{item.get('summary') or ('通过' if item.get('ok') else '失败')}", None
                categories.setdefault(str(category), []).append({"status": status, "summary": summary, "target": target, "value": item})
        order = ["剧本 Block", "章节与 Fragment", "角色配置", "素材引用", "变量与分支", "项目配置", "诊断结果", "构建请求", "其他"]
        return [{"name": name, "items": categories[name]} for name in order if categories.get(name)]

    def _write_task(self, project_root: Path, task: dict[str, Any]) -> None:
        sessions = self._sessions_dir(project_root)
        sessions.mkdir(parents=True, exist_ok=True)
        path = sessions / f"{task['id']}.json"
        temporary = path.with_suffix(".json.tmp")
        encoded = json.dumps(task, ensure_ascii=False, indent=2).encode("utf-8")
        # 检查点包含模型对话与项目上下文，落盘前用 DPAPI 加密（非 Windows 平台回退为明文）。
        temporary.write_bytes(dpapi_protect(encoded))
        os.replace(temporary, path)

    @staticmethod
    def _read_task(path: Path) -> dict[str, Any] | None:
        try:
            value = json.loads(dpapi_unprotect(path.read_bytes()).decode("utf-8"))
            return value if isinstance(value, dict) and value.get("id") == path.stem else None
        except (OSError, json.JSONDecodeError, ValueError):
            return None

    @staticmethod
    def _sessions_dir(project_root: Path) -> Path:
        return project_root / ".slide" / "agent" / "sessions"

    @staticmethod
    def _public_task(task: dict[str, Any], include_events: bool = True) -> dict[str, Any]:
        result = deepcopy(task)
        result["hasPlan"] = bool(result.get("plan"))
        result.pop("executionCheckpoint", None)
        result.pop("executionInstruction", None)
        version = result.get("projectVersion")
        if isinstance(version, dict):
            result["projectVersion"] = {key: version.get(key) for key in ("fingerprint", "capturedAt")}
        result.pop("patchPreconditions", None)
        result["checkpoints"] = [{key: item.get(key) for key in ("id", "createdAt", "attempt", "step", "round", "model", "toolNames", "inherited")} for item in result.get("checkpoints", [])]
        if not include_events:
            result.pop("events", None)
            result.pop("plan", None)
        return result

    @staticmethod
    def _normalize_task(task: dict[str, Any]) -> dict[str, Any]:
        task.setdefault("checkpoints", [])
        task.setdefault("currentCheckpointId", None)
        task.setdefault("parentTaskId", None)
        task.setdefault("sourceCheckpointId", None)
        task.setdefault("remainingOperationIndexes", [])
        task.setdefault("appliedOperationIndexes", [])
        task.setdefault("displayInstruction", task.get("instruction", ""))
        task.setdefault("executionInstruction", None)
        task.setdefault("projectVersion", None)
        task.setdefault("patchPreconditions", [])
        task.setdefault("context", {})
        if not task["checkpoints"] and isinstance(task.get("executionCheckpoint"), dict):
            checkpoint = task["executionCheckpoint"]
            checkpoint_id = uuid.uuid5(uuid.NAMESPACE_URL, f"slide:{task.get('id')}:{checkpoint.get('nextRound', 0)}").hex
            task["checkpoints"].append({
                "id": checkpoint_id,
                "createdAt": task.get("updatedAt") or AgentTaskManager._now(),
                "attempt": task.get("attempt", 1),
                "step": task.get("checkpointStep", 0),
                "round": int(checkpoint.get("nextRound", 0)),
                "model": task.get("checkpointModel"),
                "toolNames": [str(item.get("name", "")) for item in checkpoint.get("registry", {}).get("trace", []) if item.get("name")],
                "snapshot": AgentTaskManager._checkpoint_snapshot(checkpoint),
                "state": deepcopy(checkpoint),
                "inherited": False,
            })
            task["currentCheckpointId"] = checkpoint_id
        return task

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
