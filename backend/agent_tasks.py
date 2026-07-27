from __future__ import annotations

import hashlib
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

    def start_task(self, instruction: str, project: dict[str, Any], project_root: Path) -> dict[str, Any]:
        return self._enqueue_new_task(instruction, project, project_root)

    def _enqueue_new_task(self, instruction: str, project: dict[str, Any], project_root: Path, parent_task_id: str | None = None, remaining_operation_indexes: list[int] | None = None, display_instruction: str | None = None, initial_event: tuple[str, str] | None = None) -> dict[str, Any]:
        instruction = instruction.strip()
        if not instruction:
            raise ValueError("请先描述希望 Agent 完成的任务")
        task_id = uuid.uuid4().hex
        now = self._now()
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
            "projectVersion": self._project_version(project),
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
        return self._enqueue_new_task(instruction, project, root, source["id"], indexes, display)

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
                "projectVersion": self._project_version(project),
                "patchPreconditions": [],
                "events": [],
                "lastEventSeq": 0,
                "plan": None,
                "error": None,
            }
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
        self._worker = threading.Thread(target=self._worker_loop, name="hikari-agent-queue", daemon=True)
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
                plan = self.ai_service.run(
                    task.get("executionInstruction") or task["instruction"],
                    project,
                    checkpoint=lambda: self._checkpoint(task_id),
                    progress=lambda kind, message, data=None: self._progress(task_id, kind, message, data or {}),
                    cancellation=self._controls[task_id].cancellation,
                    execution_checkpoint=deepcopy(task.get("executionCheckpoint")),
                    save_execution_checkpoint=lambda value: self._save_execution_checkpoint(task_id, value),
                )
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
        if kind in {"add_blocks", "update_branch"}: return [f"script:{operation.get('fragmentId')}"]
        if kind == "create_fragment": return ["chapters"]
        if kind == "upsert_character": return [f"character:{operation['characterId']}"] if operation.get("characterId") else ["characters"]
        if kind == "update_asset": return [f"asset:{operation.get('assetId')}"]
        if kind == "upsert_variable": return [f"variable:{operation.get('name')}"]
        return ["meta"]

    @classmethod
    def _patch_preconditions(cls, plan: dict[str, Any], version: dict[str, Any]) -> list[dict[str, Any]]:
        scopes = version.get("scopes") or {}
        return [{"operationIndex": index, "scopes": targets, "expected": {target: scopes.get(target, "missing") for target in targets}} for index, operation in enumerate(plan.get("operations") or []) for targets in [cls._operation_scopes(operation)]]

    @staticmethod
    def _conflict_message(operation: dict[str, Any], scope: str) -> str:
        labels = {"add_blocks": "目标 Fragment 的剧本", "update_branch": "目标分支所在剧本", "create_fragment": "章节结构", "upsert_character": "目标角色配置", "update_asset": "目标素材配置", "upsert_variable": "目标变量", "update_project": "项目基本信息"}
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
        temporary.write_text(json.dumps(task, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)

    @staticmethod
    def _read_task(path: Path) -> dict[str, Any] | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) and value.get("id") == path.stem else None
        except (OSError, json.JSONDecodeError):
            return None

    @staticmethod
    def _sessions_dir(project_root: Path) -> Path:
        return project_root / ".hikari" / "agent" / "sessions"

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
        task.setdefault("displayInstruction", task.get("instruction", ""))
        task.setdefault("executionInstruction", None)
        task.setdefault("projectVersion", None)
        task.setdefault("patchPreconditions", [])
        if not task["checkpoints"] and isinstance(task.get("executionCheckpoint"), dict):
            checkpoint = task["executionCheckpoint"]
            checkpoint_id = uuid.uuid5(uuid.NAMESPACE_URL, f"hikari:{task.get('id')}:{checkpoint.get('nextRound', 0)}").hex
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
