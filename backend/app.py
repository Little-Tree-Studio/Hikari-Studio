from __future__ import annotations

import argparse
import json
import logging
import queue
import threading
from pathlib import Path
from typing import Any

from .api import DesktopApi
from .desktop_paths import DesktopPaths, migrate_legacy_desktop_data, resolve_desktop_paths
from .fastapi_rpc import QtRpcDispatcher, QtRpcSignalHost, RpcServer
from .logging_config import configure_logging
from .project_store import ProjectStore
from .qt_host import QtWebHost, QtWindowAdapter, screen_proxies
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
    parser.add_argument("--debug", action="store_true", help="Enable Qt WebEngine developer tools")
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

    from PySide6.QtWidgets import QApplication
    from PySide6.QtCore import QUrl

    application = QApplication.instance() or QApplication([])
    QApplication.setApplicationName("Hikari Studio")
    QApplication.setOrganizationName("Hikari Studio")

    pending_messages: queue.Queue[dict[str, Any]] = queue.Queue()
    editor_ready = threading.Event()
    window_holder: dict[str, Any] = {}

    api: DesktopApi | None = None
    background_services_started = False
    rpc_server: RpcServer | None = None

    def handle_instance_message(payload: dict[str, Any]) -> None:
        window = window_holder.get("window")
        if window is None or not editor_ready.is_set():
            pending_messages.put(payload)
            return
        try:
            window.activate()
            project_path = str(payload.get("projectPath") or "").strip()
            if project_path:
                encoded = json.dumps(project_path, ensure_ascii=False)
                window.evaluate_js(f"window.dispatchEvent(new CustomEvent('hikari-open-project-request', {{ detail: {encoded} }}))")
        except Exception:
            logger.exception("Failed to activate the primary Hikari Studio window")

    def dispatch_instance_message(payload: dict[str, Any]) -> None:
        window = window_holder.get("window")
        if window is None or not editor_ready.is_set():
            pending_messages.put(payload)
            return
        window.dispatch_instance_message(payload)

    instance = SingleInstance(paths.app_data_dir, dispatch_instance_message)
    payload = {"projectPath": str(Path(args.project).expanduser().resolve()) if args.project else None}
    if not instance.acquire(payload):
        return

    try:
        api = create_api(paths=paths)
        api.install_crash_handlers()
        if args.project:
            api.open_project_path(str(Path(args.project).expanduser().resolve()))
            api.mark_startup_project_requested()

        state_store = WindowStateStore(paths.config_dir / "window-state.json")
        screens = screen_proxies(application)
        placement = state_store.load(screens=screens)
        rpc_signal_host = QtRpcSignalHost()
        dispatcher = QtRpcDispatcher(api, rpc_signal_host.request)
        rpc_signal_host.request.connect(dispatcher.handle)
        rpc_server = RpcServer(dispatcher, static_root=frontend_dist)
        rpc_server.start()
        host = QtWebHost(
            api,
            QUrl(f"{rpc_server.base_url}/desktop.html"),
            placement.width,
            placement.height,
            placement.x,
            placement.y,
            application,
            rpc_server=rpc_server,
        )
        window = QtWindowAdapter(host.window, host.view, application)
        window_holder["window"] = window
        api._bind_window(window, state_store, placement)
        host.window.moved.connect(lambda: api.schedule_window_state())
        host.window.resized.connect(lambda: api.schedule_window_state())
        host.window.closing.connect(lambda: api.persist_window_state())
        host.window.instance_message.connect(handle_instance_message)

        def editor_loaded(ok: bool) -> None:
            if not ok:
                raise RuntimeError("Qt WebEngine failed to load the editor frontend")
            editor_ready.set()
            if placement.maximized:
                api.maximize_window()
            while not pending_messages.empty():
                handle_instance_message(pending_messages.get_nowait())

        host.load_finished_connect(editor_loaded)
        host.show()
        api.start_background_services()
        background_services_started = True
        exit_code = application.exec()
        if exit_code:
            raise SystemExit(exit_code)
    except Exception as exc:
        if api is not None:
            api.capture_python_crash("python-main", exc)
        raise
    finally:
        if api is not None:
            api.persist_window_state()
            if background_services_started:
                api.stop_background_services()
            api.restore_crash_handlers()
        if rpc_server is not None:
            rpc_server.stop()
        instance.close()
