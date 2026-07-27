from __future__ import annotations

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
        instruction = instruction.strip()
        if not instruction:
            raise ValueError("请先描述希望 Agent 完成的任务")
        task_id = uuid.uuid4().hex
        now = self._now()
        task = {
            "id": task_id,
            "instruction": instruction,
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
            "parentTaskId": None,
            "sourceCheckpointId": None,
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
            self._append_event_locked(task_id, "queued", "任务已加入队列", {})
            self._ensure_worker_locked()
            self._queue.put(task_id)
            return self._public_task(task)

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
                    task["instruction"],
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
        result.pop("executionCheckpoint", None)
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
                "state": deepcopy(checkpoint),
                "inherited": False,
            })
            task["currentCheckpointId"] = checkpoint_id
        return task

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
