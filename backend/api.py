from __future__ import annotations

import json
import platform
import logging
import secrets
import threading
from pathlib import Path
from typing import Any

from .exporters import build_web_game, export_renpy, safe_slug
from .ai_service import AiService
from .agent_tasks import AgentTaskManager
from .asr_service import AsrService
from .editor_appearance import EditorAppearanceStore
from .project_store import ProjectStore
from .script_importer import preview_script_import
from .windows_builder import build_windows_game


LOGGER = logging.getLogger(__name__)


class DesktopApi:
    def __init__(self, store: ProjectStore, root: Path, state_dir: Path | None = None, output_root: Path | None = None) -> None:
        self._store = store
        self._root = root
        self._state_dir = (state_dir or store.data_dir).resolve()
        self._output_root = (output_root or root / "exports").resolve()
        self._window: Any = None
        self._window_state_store: Any = None
        self._window_placement: Any = None
        self._window_maximized = False
        self._project_creation_mode = False
        self._window_state_timer: threading.Timer | None = None
        self._save_lock = threading.RLock()
        self._project_session_token = secrets.token_urlsafe(32)
        self._ai = AiService(self._state_dir)
        self._agent_tasks = AgentTaskManager(self._ai)
        self._asr = AsrService()
        self._editor_appearance = EditorAppearanceStore(self._state_dir / "config")

    def _bind_window(self, window: Any, window_state_store: Any = None, placement: Any = None) -> None:
        self._window = window
        self._window_state_store = window_state_store
        self._window_placement = placement
        self._window_maximized = bool(getattr(placement, "maximized", False))

    def persist_window_state(self, maximized: bool | None = None) -> None:
        if self._project_creation_mode:
            return
        if maximized is not None:
            self._window_maximized = maximized
        if self._window is not None and self._window_state_store is not None:
            try:
                screens: list[Any] = []
                try:
                    import webview
                    screens = list(webview.screens or [])
                except Exception:
                    pass
                self._window_placement = self._window_state_store.capture(
                    self._window,
                    maximized=self._window_maximized,
                    previous=self._window_placement,
                    scale_factor=self._window_scale_factor(),
                    screens=screens,
                )
            except Exception:
                LOGGER.exception("Window state persistence failed")

    def schedule_window_state(self, maximized: bool | None = None) -> None:
        if self._project_creation_mode:
            return
        if maximized is not None:
            self._window_maximized = maximized
        if self._window_state_timer is not None:
            self._window_state_timer.cancel()
        timer = threading.Timer(0.3, self.persist_window_state)
        timer.daemon = True
        self._window_state_timer = timer
        timer.start()

    def start_background_services(self) -> None:
        self._ai.start_health_monitor()

    def stop_background_services(self) -> None:
        self._agent_tasks.stop()
        self._ai.stop_health_monitor()

    def get_app_info(self) -> dict[str, Any]:
        return {"name": "Hikari Studio", "version": "0.3.0", "platform": platform.system(), "projectPath": str(self._store.project_path), "dataPath": str(self._state_dir), "buildPath": str(self._output_root)}

    def get_editor_appearance(self) -> dict[str, Any]:
        return self._editor_appearance.load()

    def save_editor_appearance(self, appearance: dict[str, Any]) -> dict[str, Any]:
        return self._editor_appearance.save(appearance)

    def load_project(self) -> dict[str, Any]:
        LOGGER.info("Project load requested: %s", self._store.project_path)
        project = self._store.load()
        LOGGER.info("Project loaded: version=%s chapters=%s", project.get("version"), len(project.get("chapters", [])))
        return project

    def load_project_json(self) -> str:
        return json.dumps(self.load_project(), ensure_ascii=False)

    def _project_session(self, project: dict[str, Any]) -> dict[str, Any]:
        return {
            "project": project,
            "projectPath": str(self._store.project_path.resolve()),
            "sessionToken": self._project_session_token,
        }

    def _rotate_project_session(self) -> None:
        self._project_session_token = secrets.token_urlsafe(32)

    def load_project_session(self) -> dict[str, Any]:
        with self._save_lock:
            return self._project_session(self.load_project())

    def save_project(
        self,
        project: dict[str, Any],
        expected_project_id: str | None = None,
        expected_project_path: str | None = None,
        session_token: str | None = None,
    ) -> dict[str, Any]:
        with self._save_lock:
            if expected_project_path is not None or session_token is not None:
                if not expected_project_path or not session_token:
                    raise ValueError("Project session path and token are both required")
                current_path = str(self._store.project_path.resolve())
                requested_path = str(Path(expected_project_path).expanduser().resolve())
                if session_token != self._project_session_token or requested_path != current_path:
                    raise ValueError("Project session changed; reload before saving")
            result = self._store.save(project, expected_project_id=expected_project_id)
            LOGGER.info("Project saved: %s", result["path"])
            return result

    def load_command_history(self) -> dict[str, Any] | None:
        return self._store.load_command_history()

    def load_command_history_stats(self) -> dict[str, Any]:
        return self._store.load_command_history_stats()

    def load_recovery_snapshot(self) -> dict[str, Any] | None:
        return self._store.load_recovery_snapshot()

    def save_command_history(self, history: dict[str, Any]) -> dict[str, Any]:
        with self._save_lock:
            result = self._store.save_command_history(history)
            LOGGER.info("Command history saved: commands=%s", result["commandCount"])
            return result

    def read_runtime_value(self, key: str) -> str | None:
        return self._store.read_runtime_value(key)

    def write_runtime_value(self, key: str, value: str) -> bool:
        return self._store.write_runtime_value(key, value)

    def delete_runtime_value(self, key: str) -> bool:
        return self._store.delete_runtime_value(key)

    def save_project_as(self, project: dict[str, Any]) -> dict[str, Any] | None:
        if self._window is None:
            return None
        import webview
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        folder = result[0] if isinstance(result, (tuple, list)) else result
        with self._save_lock:
            saved = self._store.save_as(project, Path(folder))
            LOGGER.info("Project saved as: %s", saved["path"])
            return saved

    def save_project_as_session(self, project: dict[str, Any]) -> dict[str, Any] | None:
        with self._save_lock:
            saved = self.save_project_as(project)
            if saved is None:
                return None
            self._rotate_project_session()
            return {**saved, "projectPath": str(self._store.project_path.resolve()), "sessionToken": self._project_session_token}

    def new_project(self, name: str) -> dict[str, Any]:
        project = self._store.create(name)
        LOGGER.info("Project created: %s", self._store.project_path)
        return project

    def new_project_session(self, name: str) -> dict[str, Any]:
        with self._save_lock:
            project = self.new_project(name)
            self._rotate_project_session()
            return self._project_session(project)

    def create_project_session(self, options: dict[str, Any]) -> dict[str, Any]:
        with self._save_lock:
            project = self._store.create_configured(options)
            self._rotate_project_session()
            LOGGER.info("Configured project created: %s", self._store.project_path)
            return self._project_session(project)

    def select_project_location(self) -> str | None:
        if self._window is None:
            return None
        import webview
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        return str(result[0] if isinstance(result, (tuple, list)) else result)

    def open_project_dialog(self) -> dict[str, Any] | None:
        if self._window is None:
            return None
        import webview
        result = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=("Hikari 项目 (*.json;*.hikari)",))
        if not result:
            return None
        path = result[0] if isinstance(result, (tuple, list)) else result
        project = self._store.open(Path(path))
        LOGGER.info("Project opened: %s", self._store.project_path)
        return project

    def list_recent_projects(self) -> list[dict[str, Any]]:
        return self._store.list_recent_projects()

    def open_project_dialog_session(self) -> dict[str, Any] | None:
        with self._save_lock:
            project = self.open_project_dialog()
            if project is None:
                return None
            self._rotate_project_session()
            return self._project_session(project)

    def open_recent_project(self, path: str) -> dict[str, Any]:
        project = self._store.open(Path(path))
        LOGGER.info("Recent project opened: %s", self._store.project_path)
        return project

    def open_recent_project_session(self, path: str) -> dict[str, Any]:
        with self._save_lock:
            project = self.open_recent_project(path)
            self._rotate_project_session()
            return self._project_session(project)

    def open_project_path(self, path: str) -> dict[str, Any]:
        project = self._store.open(Path(path))
        LOGGER.info("Project opened from desktop request: %s", self._store.project_path)
        return project

    def open_project_path_session(self, path: str) -> dict[str, Any]:
        with self._save_lock:
            project = self.open_project_path(path)
            self._rotate_project_session()
            return self._project_session(project)

    def set_project_pinned(self, path: str, pinned: bool) -> list[dict[str, Any]]:
        return self._store.set_project_pinned(path, pinned)

    def import_assets(self, paths: list[str] | None = None, audio_category: str | None = None) -> list[dict[str, Any]]:
        selected = paths or []
        if not selected and self._window is not None:
            import webview
            result = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=("素材文件 (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.mp3;*.ogg;*.wav;*.flac;*.m4a;*.mp4;*.webm;*.mov;*.ttf;*.otf;*.woff;*.woff2)", "全部文件 (*.*)"))
            selected = list(result or [])
        return self._store.import_assets(selected, audio_category)

    def inspect_assets(self, assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        statuses: list[dict[str, Any]] = []
        builtin_root = (self._root / "assets").resolve()
        project_root = self._store.asset_dir.resolve()
        for asset in assets:
            path_value = str(asset.get("path", ""))
            is_builtin = path_value.startswith("builtin/")
            root = builtin_root if is_builtin else project_root
            path = (root / Path(path_value).name).resolve()
            exists = path.parent == root and path.is_file()
            statuses.append({
                "assetId": str(asset.get("id", "")),
                "exists": exists,
                "size": path.stat().st_size if exists else None,
                "location": "builtin" if is_builtin else "project",
            })
        return statuses

    def replace_asset_file(self, asset_id: str, path: str | None = None) -> dict[str, Any] | None:
        selected = path
        if not selected and self._window is not None:
            import webview
            result = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=("素材文件 (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.mp3;*.ogg;*.wav;*.flac;*.m4a;*.mp4;*.webm;*.mov;*.ttf;*.otf;*.woff;*.woff2)", "全部文件 (*.*)"))
            if result:
                selected = result[0] if isinstance(result, (tuple, list)) else result
        if not selected:
            return None
        return self._store.replace_asset_file(asset_id, selected)

    def preview_asset_folder_repair(self, issues: list[dict[str, Any]], folder: str | None = None) -> dict[str, Any] | None:
        selected = folder
        if not selected and self._window is not None:
            import webview
            result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
            if result:
                selected = result[0] if isinstance(result, (tuple, list)) else result
        if not selected:
            return None
        return self._store.match_missing_assets(selected, issues)

    def apply_asset_folder_repair(self, matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._store.apply_asset_folder_repair(matches)

    def get_asr_status(self) -> dict[str, Any]:
        return self._asr.status()

    def load_asr_model(self) -> dict[str, Any]:
        return self._asr.load()

    def transcribe_audio(self, assets: list[dict[str, Any]], concurrency: int = 1, force: bool = False) -> dict[str, Any]:
        del force  # Filtering pending/success assets is handled by the editor before this call.
        items: list[tuple[str, Path]] = []
        root = self._store.asset_dir.resolve()
        for asset in assets:
            if asset.get("kind") != "audio":
                continue
            path = (root / Path(str(asset.get("path", ""))).name).resolve()
            if path.parent == root and path.is_file():
                items.append((str(asset.get("id", "")), path))
        if not items:
            return {"ok": False, "error": {"code": "ASR_NO_AUDIO", "message": "没有可识别的本地语音文件"}}
        return self._asr.transcribe(items, concurrency)

    def preview_script_import(self, path: str | None = None) -> dict[str, Any] | None:
        selected = path
        if not selected and self._window is not None:
            import webview
            result = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=("剧本文件 (*.txt;*.md;*.markdown;*.json)",))
            if result:
                selected = result[0] if isinstance(result, (tuple, list)) else result
        if not selected:
            return None
        return preview_script_import(Path(selected))

    def export_renpy(self, project: dict[str, Any]) -> dict[str, Any]:
        with self._save_lock:
            self._store.save(project)
        output_dir = self._output_root / safe_slug(project["meta"]["name"]) / "renpy"
        output = export_renpy(project, output_dir)
        LOGGER.info("RenPy export built: %s", output)
        return {"ok": True, "path": str(output)}

    def build_web(self, project: dict[str, Any]) -> dict[str, Any]:
        with self._save_lock:
            self._store.save(project)
        output_dir = self._output_root / safe_slug(project["meta"]["name"]) / "web"
        output = build_web_game(project, output_dir, self._store.project_path, self._root / "assets", self._store.asset_dir, self._root / "frontend" / "runtime-dist")
        LOGGER.info("Web export built: %s", output)
        return {"ok": True, "path": str(output)}

    def build_windows(self, project: dict[str, Any]) -> dict[str, Any]:
        with self._save_lock:
            self._store.save(project)
        output_dir = self._output_root / safe_slug(project["meta"]["name"]) / "windows"
        executable = build_windows_game(
            project,
            output_dir,
            self._store.project_path,
            self._root / "assets",
            self._store.asset_dir,
            self._root / "frontend" / "runtime-dist",
            self._root,
            self._root / "launcher" / "Hikari.GameLauncher" / "Hikari.GameLauncher.csproj",
            self._root / "launcher" / "dist" / "win-x64",
        )
        LOGGER.info("Windows game built: %s", executable)
        return {"ok": True, "path": str(executable)}

    def get_ai_settings(self) -> dict[str, Any]:
        return self._ai.get_settings()

    def save_ai_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        return self._ai.save_settings(settings)

    def discover_ai_models(self, settings: dict[str, Any]) -> dict[str, Any]:
        return self._ai.discover_models(settings)

    def run_ai_agent(self, instruction: str, project: dict[str, Any]) -> dict[str, Any]:
        return self._ai.run(instruction, project)

    def start_ai_task(self, instruction: str, project: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._agent_tasks.start_task(instruction, project, self._store.project_root, context)

    def retry_ai_task_operations(self, task_id: str, operation_indexes: list[int], project: dict[str, Any]) -> dict[str, Any]:
        return self._agent_tasks.retry_remaining_operations(task_id, operation_indexes, project, self._store.project_root)

    def check_ai_patch_preconditions(self, task_id: str, operation_indexes: list[int], project: dict[str, Any]) -> dict[str, Any]:
        return self._agent_tasks.check_patch_preconditions(task_id, operation_indexes, project, self._store.project_root)

    def apply_ai_patch(self, task_id: str, operation_indexes: list[int], project: dict[str, Any]) -> dict[str, Any]:
        with self._save_lock:
            result = self._agent_tasks.apply_patch_to_project(task_id, operation_indexes, project, self._store.project_root)
            if not result["ok"]:
                return result
            save_result = self._store.save(result["project"])
            persisted = self._store.load(recover=False)
            self._agent_tasks.mark_patch_applied(task_id, result["appliedOperationIndexes"], self._store.project_root)
            LOGGER.info("Agent Patch applied atomically: task=%s operations=%s", task_id, operation_indexes)
            return {**result, "project": persisted, "save": save_result}

    def rebase_ai_patch(self, task_id: str, operation_indexes: list[int], project: dict[str, Any]) -> dict[str, Any]:
        return self._agent_tasks.rebase_patch(task_id, operation_indexes, project, self._store.project_root)

    def list_ai_tasks(self) -> list[dict[str, Any]]:
        return self._agent_tasks.list_tasks(self._store.project_root)

    def get_ai_task(self, task_id: str, after_seq: int = 0) -> dict[str, Any]:
        return self._agent_tasks.get_task(task_id, self._store.project_root, after_seq)

    def pause_ai_task(self, task_id: str) -> dict[str, Any]:
        return self._agent_tasks.pause_task(task_id, self._store.project_root)

    def resume_ai_task(self, task_id: str, project: dict[str, Any]) -> dict[str, Any]:
        return self._agent_tasks.resume_task(task_id, project, self._store.project_root)

    def restart_ai_task_from_checkpoint(self, task_id: str, checkpoint_id: str, project: dict[str, Any]) -> dict[str, Any]:
        return self._agent_tasks.restart_from_checkpoint(task_id, checkpoint_id, project, self._store.project_root)

    def compare_ai_task_results(self, left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
        return self._agent_tasks.compare_results(left, right, self._store.project_root)

    def cancel_ai_task(self, task_id: str) -> dict[str, Any]:
        return self._agent_tasks.cancel_task(task_id, self._store.project_root)

    def minimize_window(self) -> bool:
        if self._window is not None:
            self._window.minimize()
        return True

    def _window_scale_factor(self) -> float:
        try:
            value = float(getattr(getattr(self._window, "native", None), "scale_factor", 1) or 1)
            return value if 1 <= value <= 4 else 1
        except (TypeError, ValueError):
            return 1

    def _move_window_physical(self, x: int, y: int) -> None:
        if self._window is None:
            return
        scale_factor = self._window_scale_factor()
        self._window.move(round(x / scale_factor), round(y / scale_factor))

    def set_project_creation_mode(self, enabled: bool) -> bool:
        if self._window is None or enabled == self._project_creation_mode:
            return True

        if enabled:
            if self._window_state_timer is not None:
                self._window_state_timer.cancel()
                self._window_state_timer = None
            self.persist_window_state()
            self._project_creation_mode = True
            self._window.restore()

            screen = getattr(self._window, "screen", None)
            if screen is None:
                try:
                    import webview
                    screens = list(webview.screens or [])
                    center_x = int(getattr(self._window, "x", 0) or 0) + int(getattr(self._window, "width", 1080) or 1080) // 2
                    center_y = int(getattr(self._window, "y", 0) or 0) + int(getattr(self._window, "height", 680) or 680) // 2
                    screen = next(
                        (
                            item for item in screens
                            if item.x <= center_x < item.x + item.width and item.y <= center_y < item.y + item.height
                        ),
                        screens[0] if screens else None,
                    )
                except Exception:
                    LOGGER.exception("Failed to resolve the screen for the project creation window")
            # pywebview's WinForms resize API already uses Windows logical pixels.
            # Applying the WebView scale factor again makes the compact wizard too
            # large and leaves its layout viewport taller than the native client.
            compact_width = 1080
            compact_height = 680
            self._window.resize(compact_width, compact_height)
            if screen is not None:
                frame = getattr(screen, "frame", None)
                frame_x = int(getattr(frame, "X", screen.x))
                frame_y = int(getattr(frame, "Y", screen.y))
                frame_width = int(getattr(frame, "Width", screen.width))
                frame_height = int(getattr(frame, "Height", screen.height))
                self._window.move(
                    int(frame_x + max(0, frame_width - 1080) / 2),
                    int(frame_y + max(0, frame_height - 680) / 2),
                )
            self._window_maximized = False
            return True

        placement = self._window_placement
        if placement is not None:
            self._window.restore()
            scale_factor = self._window_scale_factor()
            self._window.resize(round(placement.width * scale_factor), round(placement.height * scale_factor))
            if placement.x is not None and placement.y is not None:
                self._window.move(placement.x, placement.y)
            if placement.maximized:
                self._window.maximize()
            self._window_maximized = bool(placement.maximized)
        self._project_creation_mode = False
        return True

    def toggle_maximize(self) -> bool:
        if self._project_creation_mode:
            return False
        if self._window is not None:
            if self._window_maximized:
                self._window.restore()
                self.persist_window_state(False)
            else:
                self.persist_window_state(False)
                self._window_maximized = True
                self._window.maximize()
                self.persist_window_state(True)
        return True

    def close_window(self) -> bool:
        if self._window is not None:
            if self._window_state_timer is not None:
                self._window_state_timer.cancel()
                self._window_state_timer = None
            self.persist_window_state()
            self._window.destroy()
        return True
