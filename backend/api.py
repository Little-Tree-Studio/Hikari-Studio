from __future__ import annotations

import base64
import gzip
import json
import os
import platform
import logging
import secrets
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .build_preflight import BuildPreflightError, collect_build_preflight
from .clipboard_service import read_clipboard_text as read_system_clipboard_text, write_clipboard_text as write_system_clipboard_text
from .exporters import build_web_game, export_renpy, safe_slug
from .ai_service import AiService
from .agent_tasks import AgentTaskManager
from .asr_service import AsrService
from .crash_reporting import CrashReporter
from .editor_appearance import EditorAppearanceStore
from .project_store import ProjectStore
from .script_importer import preview_script_import, preview_script_text
from .update_service import UpdateService
from .version import APP_NAME, APP_VERSION, UPDATE_CHANNEL
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
        self._startup_project_requested = False
        self._window_state_timer: threading.Timer | None = None
        self._save_lock = threading.RLock()
        self._project_session_token = secrets.token_urlsafe(32)
        self._ai = AiService(self._state_dir)
        self._agent_tasks = AgentTaskManager(self._ai)
        self._asr = AsrService()
        self._editor_appearance = EditorAppearanceStore(self._state_dir / "config")
        self._updates = UpdateService(self._state_dir)
        self._crash_reports = CrashReporter(self._state_dir)
        self._update_thread: threading.Thread | None = None
        self._latest_project_reload: dict[str, Any] | None = None
        self._latest_preview_seek: dict[str, Any] | None = None
        self._completed_build_outputs: dict[str, str] = {}

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
        if self._update_thread is None or not self._update_thread.is_alive():
            self._update_thread = threading.Thread(target=self._background_update_check, name="hikari-update-check", daemon=True)
            self._update_thread.start()

    def stop_background_services(self) -> None:
        self._agent_tasks.stop()
        self._ai.stop_health_monitor()

    def get_app_info(self) -> dict[str, Any]:
        return {"name": APP_NAME, "version": APP_VERSION, "channel": UPDATE_CHANNEL, "platform": platform.system(), "projectPath": str(self._store.project_path), "dataPath": str(self._state_dir), "buildPath": str(self._output_root), "startupProjectRequested": self._startup_project_requested}

    def mark_startup_project_requested(self) -> None:
        self._startup_project_requested = True

    def install_crash_handlers(self) -> None:
        self._crash_reports.install_global_handlers()

    def restore_crash_handlers(self) -> None:
        self._crash_reports.restore_global_handlers()

    def capture_python_crash(self, source: str, error: BaseException) -> dict[str, Any]:
        return self._crash_reports.queue_exception(source, type(error), error, error.__traceback__)

    def get_update_status(self) -> dict[str, Any]:
        return self._updates.status()

    def check_for_updates(self, force: bool = False, channel: str = UPDATE_CHANNEL) -> dict[str, Any]:
        return self._updates.check(force=force, channel=channel)

    def download_update(self) -> dict[str, Any]:
        return self._updates.download()

    def install_downloaded_update(self, confirmed: bool = False, version: str | None = None) -> dict[str, Any]:
        return self._updates.install_downloaded(confirmed=confirmed, version=version)

    def get_crash_reports(self) -> dict[str, Any]:
        return self._crash_reports.list_reports()

    def get_crash_report(self, report_id: str) -> dict[str, Any]:
        return self._crash_reports.get_report(report_id)

    def report_frontend_crash(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._crash_reports.queue_frontend(payload)

    def submit_crash_report(self, report_id: str, confirmed: bool = False) -> dict[str, Any]:
        return self._crash_reports.submit(report_id, confirmed=confirmed)

    def delete_crash_report(self, report_id: str) -> bool:
        return self._crash_reports.delete_report(report_id)

    def _background_update_check(self) -> None:
        try:
            self._updates.check(force=False, channel=UPDATE_CHANNEL)
        except Exception:
            LOGGER.exception("Background update check failed")

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

    def load_project_session_profiled(self, reload_id: str, supports_compression: bool = True) -> dict[str, Any]:
        if not isinstance(reload_id, str) or not reload_id or len(reload_id) > 96 or not all(character.isalnum() or character in "-_." for character in reload_id):
            raise ValueError("Project reload id is invalid")
        with self._save_lock:
            started = time.perf_counter()
            project = self.load_project()
            loaded = time.perf_counter()
            project_json = json.dumps(project, ensure_ascii=False, separators=(",", ":"))
            serialized = time.perf_counter()
            project_bytes = project_json.encode("utf-8")
            payload_bytes = len(project_bytes)
            compression_started = time.perf_counter()
            if supports_compression:
                project_payload = base64.b64encode(gzip.compress(project_bytes, compresslevel=1, mtime=0)).decode("ascii")
                encoding = "gzip-base64"
            else:
                project_payload = project_json
                encoding = "plain-json"
            compressed = time.perf_counter()
            transport_bytes = len(project_payload.encode("utf-8"))
            chapters = project.get("chapters", [])
            timelines = project.get("timelines", {})
            profile = {
                "version": 1,
                "reloadId": reload_id,
                "recordedAt": datetime.now(timezone.utc).isoformat(),
                "projectLoadMs": round((loaded - started) * 1_000, 3),
                "pythonSerializationMs": round((serialized - loaded) * 1_000, 3),
                "pythonCompressionMs": round((compressed - compression_started) * 1_000, 3),
                "pythonTotalMs": round((time.perf_counter() - started) * 1_000, 3),
                "payloadBytes": payload_bytes,
                "transportBytes": transport_bytes,
                "counts": {
                    "chapters": len(chapters),
                    "fragments": sum(len(chapter.get("fragments", [])) for chapter in chapters),
                    "blocks": sum(len(blocks) for blocks in project.get("scripts", {}).values()),
                    "assets": len(project.get("assets", [])),
                    "timelineClips": sum(len(track.get("clips", [])) for timeline in timelines.values() for track in timeline.get("tracks", [])),
                },
            }
            self._latest_project_reload = {"version": 1, "complete": False, "backend": profile, "frontend": None, "surface": None}
            LOGGER.info("Project reload backend performance", extra={"details": self._latest_project_reload})
            return {
                "encoding": encoding,
                "projectPayload": project_payload,
                "projectPath": str(self._store.project_path.resolve()),
                "sessionToken": self._project_session_token,
                "backend": profile,
            }

    @staticmethod
    def _reload_duration(value: Any) -> float:
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            return 0.0
        return round(min(float(value), 300_000.0), 3)

    def report_project_reload_performance(self, reload_id: str, surface: str, frontend: dict[str, Any]) -> dict[str, Any]:
        current = self._latest_project_reload
        if current is None or current.get("backend", {}).get("reloadId") != reload_id:
            raise ValueError("Project reload profile is no longer active")
        allowed = (
            "apiWaitMs", "bridgeRoundTripMs", "webViewTransferEstimateMs", "jsonParseMs", "frontendSessionLoadMs",
            "payloadDecodeMs",
            "commandHistoryLoadMs", "recoverySnapshotLoadMs", "historyStatsLoadMs", "historyRestoreMs", "stateDispatchMs",
            "reactCommitMs", "stablePaintMs", "totalReloadMs", "bootToStablePaintMs",
        )
        normalized_frontend = {key: self._reload_duration(frontend.get(key)) for key in allowed}
        component_renders: dict[str, dict[str, float | int]] = {}
        raw_component_renders = frontend.get("componentRenders")
        if isinstance(raw_component_renders, dict):
            for surface in ("app-shell", "chapter-tree", "script-page", "block-list", "preview", "inspector"):
                raw_measurement = raw_component_renders.get(surface)
                if not isinstance(raw_measurement, dict):
                    continue
                component_renders[surface] = {
                    "commits": min(10_000, max(0, int(raw_measurement.get("commits", 0)))) if isinstance(raw_measurement.get("commits"), (int, float)) else 0,
                    "mounts": min(10_000, max(0, int(raw_measurement.get("mounts", 0)))) if isinstance(raw_measurement.get("mounts"), (int, float)) else 0,
                    "updates": min(10_000, max(0, int(raw_measurement.get("updates", 0)))) if isinstance(raw_measurement.get("updates"), (int, float)) else 0,
                    "actualDurationMs": self._reload_duration(raw_measurement.get("actualDurationMs")),
                    "mountDurationMs": self._reload_duration(raw_measurement.get("mountDurationMs")),
                    "updateDurationMs": self._reload_duration(raw_measurement.get("updateDurationMs")),
                    "baseDurationMs": self._reload_duration(raw_measurement.get("baseDurationMs")),
                    "lastCommitTimeMs": self._reload_duration(raw_measurement.get("lastCommitTimeMs")),
                }
                if surface == "block-list":
                    for key in ("firstMeasurementDurationMs", "observerMeasurementDurationMs"):
                        component_renders[surface][key] = self._reload_duration(raw_measurement.get(key))
                    for key in (
                        "firstMeasurements", "remeasurements", "observerCallbacks", "revisionFlushes",
                        "peakObservedRows", "viewportMeasurements", "viewportUpdates", "viewportRangeFlushes",
                    ):
                        value = raw_measurement.get(key)
                        component_renders[surface][key] = min(100_000, max(0, int(value))) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
                    raw_story_card_types = raw_measurement.get("storyCardTypes")
                    if isinstance(raw_story_card_types, dict):
                        normalized_story_card_types: dict[str, dict[str, float | int]] = {}
                        for block_type in (
                            "scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue",
                            "branch", "setVariable", "condition", "jump", "call", "return",
                        ):
                            raw_card = raw_story_card_types.get(block_type)
                            if not isinstance(raw_card, dict):
                                continue
                            normalized_story_card_types[block_type] = {
                                "commits": min(10_000, max(0, int(raw_card.get("commits", 0)))) if isinstance(raw_card.get("commits"), (int, float)) and not isinstance(raw_card.get("commits"), bool) else 0,
                                "mounts": min(10_000, max(0, int(raw_card.get("mounts", 0)))) if isinstance(raw_card.get("mounts"), (int, float)) and not isinstance(raw_card.get("mounts"), bool) else 0,
                                "updates": min(10_000, max(0, int(raw_card.get("updates", 0)))) if isinstance(raw_card.get("updates"), (int, float)) and not isinstance(raw_card.get("updates"), bool) else 0,
                                "actualDurationMs": self._reload_duration(raw_card.get("actualDurationMs")),
                                "mountDurationMs": self._reload_duration(raw_card.get("mountDurationMs")),
                                "updateDurationMs": self._reload_duration(raw_card.get("updateDurationMs")),
                                "baseDurationMs": self._reload_duration(raw_card.get("baseDurationMs")),
                                "lastCommitTimeMs": self._reload_duration(raw_card.get("lastCommitTimeMs")),
                            }
                        component_renders[surface]["storyCardTypes"] = normalized_story_card_types
                    raw_dialogue_regions = raw_measurement.get("dialogueRegions")
                    if isinstance(raw_dialogue_regions, dict):
                        normalized_dialogue_regions: dict[str, dict[str, float | int]] = {}
                        for region in ("speaker", "expression", "body"):
                            raw_region = raw_dialogue_regions.get(region)
                            if not isinstance(raw_region, dict):
                                continue
                            normalized_dialogue_regions[region] = {
                                "commits": min(10_000, max(0, int(raw_region.get("commits", 0)))) if isinstance(raw_region.get("commits"), (int, float)) and not isinstance(raw_region.get("commits"), bool) else 0,
                                "mounts": min(10_000, max(0, int(raw_region.get("mounts", 0)))) if isinstance(raw_region.get("mounts"), (int, float)) and not isinstance(raw_region.get("mounts"), bool) else 0,
                                "updates": min(10_000, max(0, int(raw_region.get("updates", 0)))) if isinstance(raw_region.get("updates"), (int, float)) and not isinstance(raw_region.get("updates"), bool) else 0,
                                "actualDurationMs": self._reload_duration(raw_region.get("actualDurationMs")),
                                "mountDurationMs": self._reload_duration(raw_region.get("mountDurationMs")),
                                "updateDurationMs": self._reload_duration(raw_region.get("updateDurationMs")),
                                "baseDurationMs": self._reload_duration(raw_region.get("baseDurationMs")),
                                "lastCommitTimeMs": self._reload_duration(raw_region.get("lastCommitTimeMs")),
                            }
                        component_renders[surface]["dialogueRegions"] = normalized_dialogue_regions
        normalized_frontend["componentRenders"] = component_renders
        normalized = {
            "version": 1,
            "complete": True,
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "surface": surface if surface in {"editor", "project-launcher"} else "editor",
            "backend": current["backend"],
            "frontend": normalized_frontend,
        }
        self._latest_project_reload = normalized
        LOGGER.info("Project reload complete performance", extra={"details": normalized})
        return normalized

    def get_project_reload_performance(self) -> dict[str, Any] | None:
        return self._latest_project_reload

    @staticmethod
    def _performance_count(value: Any, maximum: int = 10_000_000) -> int:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return 0
        return min(maximum, max(0, int(value)))

    @staticmethod
    def _performance_bytes(value: Any, *, signed: bool = False) -> int:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return 0
        maximum = 16 * 1024 * 1024 * 1024
        numeric = int(value)
        return min(maximum, max(-maximum if signed else 0, numeric))

    def report_preview_seek_performance(self, report: dict[str, Any]) -> dict[str, Any]:
        raw_duration = report.get("restoreDurationMs") if isinstance(report.get("restoreDurationMs"), dict) else {}
        raw_heap = report.get("heap") if isinstance(report.get("heap"), dict) else None

        def normalize_cache(value: Any, trace: bool = False) -> dict[str, int | float]:
            raw = value if isinstance(value, dict) else {}
            keys = ("exactHits", "misses", "invalidations", "evictions", "cachedResults") if trace else (
                "exactHits", "checkpointHits", "misses", "invalidations", "evictions", "weakReclaims",
                "cachedFragments", "cachedResults", "cachedStrongResults", "cachedWeakResults", "cachedCheckpoints",
            )
            normalized: dict[str, int | float] = {key: self._performance_count(raw.get(key)) for key in keys}
            rate = raw.get("evictionRate")
            normalized["evictionRate"] = round(min(1.0, max(0.0, float(rate))), 4) if isinstance(rate, (int, float)) and not isinstance(rate, bool) else 0.0
            return normalized

        normalized: dict[str, Any] = {
            "version": 1,
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "sampleCount": self._performance_count(report.get("sampleCount")),
            "sampledDurations": self._performance_count(report.get("sampledDurations"), 512),
            "inputCount": self._performance_count(report.get("inputCount")),
            "coalescedInputs": self._performance_count(report.get("coalescedInputs")),
            "restoreDurationMs": {
                key: self._reload_duration(raw_duration.get(key))
                for key in ("total", "average", "p95", "max")
            },
            "engineSeekCache": normalize_cache(report.get("engineSeekCache")),
            "traceRestoreCache": normalize_cache(report.get("traceRestoreCache"), trace=True),
        }
        if raw_heap is not None:
            normalized["heap"] = {
                key: self._performance_bytes(raw_heap.get(key), signed=key.endswith("DeltaBytes"))
                for key in ("startBytes", "peakBytes", "stableBytes", "peakDeltaBytes", "stableDeltaBytes")
            }
        self._latest_preview_seek = normalized
        LOGGER.info("Preview OP seek performance", extra={"details": normalized})
        return normalized

    def get_preview_seek_performance(self) -> dict[str, Any] | None:
        return self._latest_preview_seek

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

    def get_recovery_snapshot_status(self) -> dict[str, Any]:
        return self._store.get_recovery_snapshot_status()

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

    def select_export_location(self) -> str | None:
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

    def preview_script_import(
        self,
        path: str | None = None,
        characters: list[dict[str, Any]] | None = None,
        rules: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        selected = path
        if not selected and self._window is not None:
            import webview
            result = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=("剧本文件 (*.txt;*.md;*.markdown;*.json)",))
            if result:
                selected = result[0] if isinstance(result, (tuple, list)) else result
        if not selected:
            return None
        return preview_script_import(Path(selected), characters, rules)

    def read_clipboard_text(self) -> str:
        return read_system_clipboard_text()

    def write_clipboard_text(self, text: str) -> bool:
        return write_system_clipboard_text(text)

    def preview_clipboard_script(
        self,
        fallback_text: str | None = None,
        characters: list[dict[str, Any]] | None = None,
        rules: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            text = read_system_clipboard_text()
        except Exception as error:
            if fallback_text is None:
                raise
            LOGGER.warning("System clipboard read failed; using the editor clipboard fallback: %s", error)
            text = fallback_text
        if not text.strip() and fallback_text:
            text = fallback_text
        return preview_script_text(text, "系统剪贴板", characters, rules)

    def _build_output_dir(self, project: dict[str, Any], target: str, output_root: str | None = None) -> Path:
        root = self._output_root
        if output_root and output_root.strip():
            requested = Path(output_root.strip()).expanduser()
            if not requested.is_absolute():
                raise ValueError("导出路径必须是绝对路径")
            root = requested.resolve()
            if root.exists() and not root.is_dir():
                raise ValueError("导出路径必须指向文件夹")
        return root / safe_slug(project["meta"]["name"]) / target

    def _remember_build_output(self, output: Path, kind: str) -> Path:
        resolved = output.resolve()
        self._completed_build_outputs[str(resolved)] = kind
        while len(self._completed_build_outputs) > 32:
            self._completed_build_outputs.pop(next(iter(self._completed_build_outputs)))
        return resolved

    def _trusted_build_output(self, path: str) -> tuple[Path, str]:
        output = Path(path).expanduser().resolve()
        kind = self._completed_build_outputs.get(str(output))
        if kind is None:
            raise ValueError("只能打开本次会话中已成功构建的产物")
        if not output.exists():
            raise FileNotFoundError("构建产物已被移动或删除")
        return output, kind

    def open_build_output(self, path: str) -> dict[str, Any]:
        output, _kind = self._trusted_build_output(path)
        directory = output if output.is_dir() else output.parent
        os.startfile(str(directory))
        return {"ok": True, "path": str(directory)}

    def launch_build_output(self, path: str) -> dict[str, Any]:
        output, kind = self._trusted_build_output(path)
        if kind == "renpy":
            raise ValueError("Ren'Py 导出仅包含脚本，请在 Ren'Py Launcher 中运行")
        if not output.is_file():
            raise FileNotFoundError("构建入口文件不存在")
        if kind == "windows":
            subprocess.Popen([str(output)], cwd=str(output.parent), close_fds=True)
        else:
            os.startfile(str(output))
        return {"ok": True, "path": str(output)}

    def export_renpy(self, project: dict[str, Any], output_root: str | None = None) -> dict[str, Any]:
        with self._save_lock:
            self._store.save(project)
        output_dir = self._build_output_dir(project, "renpy", output_root)
        output = self._remember_build_output(export_renpy(project, output_dir), "renpy")
        LOGGER.info("RenPy export built: %s", output)
        return {"ok": True, "path": str(output)}

    def preflight_build(self, project: dict[str, Any], target: str, frontend_report: dict[str, Any] | None = None) -> dict[str, Any]:
        return collect_build_preflight(project, target, self._root / "assets", self._store.asset_dir, frontend_report)

    @staticmethod
    def _blocked_build(report: dict[str, Any]) -> dict[str, Any]:
        return {
            "ok": False,
            "preflight": report,
            "error": {
                "code": "BUILD_PREFLIGHT_FAILED",
                "message": f"构建前检查发现 {report['errors']} 个阻断问题",
                "diagnostics": report["issues"],
            },
        }

    def build_web(self, project: dict[str, Any], preflight: dict[str, Any] | None = None, output_root: str | None = None) -> dict[str, Any]:
        report = self.preflight_build(project, "web", preflight)
        if report["blocked"]:
            return self._blocked_build(report)
        with self._save_lock:
            self._store.save(project)
        output_dir = self._build_output_dir(project, "web", output_root)
        try:
            output = self._remember_build_output(build_web_game(project, output_dir, self._store.project_path, self._root / "assets", self._store.asset_dir, self._root / "frontend" / "runtime-dist"), "web")
        except BuildPreflightError as error:
            return self._blocked_build(error.report)
        LOGGER.info("Web export built: %s", output)
        return {"ok": True, "path": str(output), "preflight": report}

    def build_windows(self, project: dict[str, Any], preflight: dict[str, Any] | None = None, output_root: str | None = None) -> dict[str, Any]:
        report = self.preflight_build(project, "windows", preflight)
        if report["blocked"]:
            return self._blocked_build(report)
        with self._save_lock:
            self._store.save(project)
        output_dir = self._build_output_dir(project, "windows", output_root)
        try:
            executable = self._remember_build_output(build_windows_game(
                project,
                output_dir,
                self._store.project_path,
                self._root / "assets",
                self._store.asset_dir,
                self._root / "frontend" / "runtime-dist",
                self._root,
                self._root / "launcher" / "Hikari.GameLauncher" / "Hikari.GameLauncher.csproj",
                self._root / "launcher" / "dist" / "win-x64",
            ), "windows")
        except BuildPreflightError as error:
            return self._blocked_build(error.report)
        LOGGER.info("Windows game built: %s", executable)
        return {"ok": True, "path": str(executable), "preflight": report}

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

    def move_window(self, x: float, y: float) -> bool:
        if self._window is None:
            return False
        try:
            target_x = round(float(x))
            target_y = round(float(y))
        except (TypeError, ValueError, OverflowError):
            return False
        if not (-100_000 <= target_x <= 100_000 and -100_000 <= target_y <= 100_000):
            return False
        if self._window_maximized and not self._project_creation_mode:
            self._window.restore()
            self._window_maximized = False
        self._window.move(target_x, target_y)
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
