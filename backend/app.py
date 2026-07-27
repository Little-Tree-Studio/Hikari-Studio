from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import threading
from pathlib import Path
from typing import Any

from .api import DesktopApi
from .desktop_paths import DesktopPaths, migrate_legacy_desktop_data, resolve_desktop_paths
from .logging_config import configure_logging
from .project_store import ProjectStore
from .single_instance import SingleInstance
from .window_state import WindowStateStore


ROOT = Path(__file__).resolve().parents[1]


def create_api(data_dir: Path | None = None, *, paths: DesktopPaths | None = None) -> DesktopApi:
    if paths is None:
        if data_dir is not None:
            return DesktopApi(ProjectStore(data_dir), ROOT)
        paths = resolve_desktop_paths(root=ROOT)
    store = ProjectStore(paths.projects_dir, state_dir=paths.app_data_dir)
    return DesktopApi(store, paths.resource_root, state_dir=paths.app_data_dir, output_root=paths.exports_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description="Hikari Studio desktop editor")
    parser.add_argument("project", nargs="?", help="Open a Hikari project manifest")
    parser.add_argument("--debug", action="store_true", help="Enable webview debug tools")
    parser.add_argument("--portable", action="store_true", help="Store projects and settings beside the executable")
    args = parser.parse_args()

    paths = resolve_desktop_paths(portable=args.portable, root=ROOT)
    migrated = migrate_legacy_desktop_data(paths)
    log_path = configure_logging(paths.app_data_dir)
    logger = logging.getLogger(__name__)
    logger.info("Starting Hikari Studio; log=%s data=%s projects=%s portable=%s", log_path, paths.app_data_dir, paths.projects_dir, paths.portable)
    if migrated:
        logger.info("Migrated legacy projects: %s", [str(path) for path in migrated])

    frontend_dist = paths.resource_root / "frontend" / "dist"
    if not frontend_dist.joinpath("desktop.html").exists():
        raise SystemExit("Frontend build is missing. Run: cd frontend && pnpm install && pnpm build")

    try:
        import webview
    except ImportError as exc:
        raise SystemExit("pywebview is not installed. Run: pip install -r requirements.txt") from exc

    pending_messages: queue.Queue[dict[str, Any]] = queue.Queue()
    window_holder: dict[str, Any] = {}
    editor_ready = threading.Event()

    def handle_instance_message(payload: dict[str, Any]) -> None:
        window = window_holder.get("window")
        if window is None or not editor_ready.is_set():
            pending_messages.put(payload)
            return
        try:
            window.restore()
            window.show()
            project_path = str(payload.get("projectPath") or "").strip()
            if project_path:
                encoded = json.dumps(project_path, ensure_ascii=False)
                window.evaluate_js(f"window.dispatchEvent(new CustomEvent('hikari-open-project-request', {{ detail: {encoded} }}))")
        except Exception:
            logger.exception("Failed to activate the primary Hikari Studio window")

    instance = SingleInstance(paths.app_data_dir, handle_instance_message)
    payload = {"projectPath": str(Path(args.project).expanduser().resolve()) if args.project else None}
    if not instance.acquire(payload):
        return

    api: DesktopApi | None = None
    background_services_started = False
    try:
        api = create_api(paths=paths)
        if args.project:
            api.open_project_path(str(Path(args.project).expanduser().resolve()))
        state_store = WindowStateStore(paths.config_dir / "window-state.json")
        placement = state_store.load()
        window_options: dict[str, Any] = {
            "title": "Hikari Studio",
            "url": (frontend_dist / "desktop.html").as_uri(),
            "js_api": api,
            "width": placement.width,
            "height": placement.height,
            "min_size": (1080, 680),
            "frameless": True,
            "easy_drag": False,
            "background_color": "#f4f6f8",
        }
        if placement.x is not None and placement.y is not None:
            window_options.update({"x": placement.x, "y": placement.y})
        window = webview.create_window(**window_options)
        window_holder["window"] = window
        api._bind_window(window, state_store, placement)
        window.events.moved += lambda *_: api.schedule_window_state()
        window.events.resized += lambda *_: api.schedule_window_state()
        window.events.maximized += lambda *_: api.schedule_window_state(True)
        window.events.restored += lambda *_: api.schedule_window_state(False)
        window.events.closing += lambda *_: api.persist_window_state()

        def editor_loaded(*_: object) -> None:
            editor_ready.set()
            if placement.maximized:
                window.maximize()
            while not pending_messages.empty():
                handle_instance_message(pending_messages.get_nowait())

        window.events.loaded += editor_loaded
        api.start_background_services()
        background_services_started = True
        webview.start(debug=args.debug or os.getenv("HIKARI_DEBUG") == "1", private_mode=True)
    finally:
        if api is not None:
            api.persist_window_state()
            if background_services_started:
                api.stop_background_services()
        instance.close()
