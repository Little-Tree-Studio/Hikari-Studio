from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.desktop_paths import migrate_legacy_desktop_data, resolve_desktop_paths
from backend.api import DesktopApi
from backend.project_store import ProjectStore
from backend.single_instance import SingleInstance
from backend.webview2_runtime import _installed_file_version, _valid_version
from backend.window_state import WindowPlacement, WindowStateStore


class DesktopRuntimeTests(unittest.TestCase):
    def test_project_creation_mode_uses_a_centered_compact_window_and_restores_editor_placement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "projects", state_dir=root / "state")
            state_store = WindowStateStore(root / "state" / "config" / "window-state.json")
            placement = WindowPlacement(1480, 920, 120, 70, True)
            state_store.save(placement)

            class FakeWindow:
                width = 1920
                height = 1080
                x = 0
                y = 0
                screen = type("Screen", (), {"x": 0, "y": 0, "width": 1920, "height": 1080})()

                def __init__(self) -> None:
                    self.calls: list[tuple[object, ...]] = []

                def restore(self) -> None:
                    self.calls.append(("restore",))

                def resize(self, width: int, height: int) -> None:
                    self.width, self.height = width, height
                    self.calls.append(("resize", width, height))

                def move(self, x: int, y: int) -> None:
                    self.x, self.y = x, y
                    self.calls.append(("move", x, y))

                def maximize(self) -> None:
                    self.calls.append(("maximize",))

            window = FakeWindow()
            api = DesktopApi(store, root, state_dir=root / "state")
            api._bind_window(window, state_store, placement)

            self.assertTrue(api.set_project_creation_mode(True))
            self.assertIn(("resize", 1080, 680), window.calls)
            self.assertIn(("move", 420, 200), window.calls)
            self.assertEqual(state_store.load(), placement)
            self.assertFalse(api.toggle_maximize())

            self.assertTrue(api.set_project_creation_mode(False))
            self.assertIn(("resize", 1480, 920), window.calls)
            self.assertIn(("move", 120, 70), window.calls)
            self.assertEqual(window.calls[-1], ("maximize",))

    def test_project_creation_mode_keeps_compact_logical_size_for_windows_dpi(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "projects", state_dir=root / "state")
            state_store = WindowStateStore(root / "state" / "config" / "window-state.json")
            placement = WindowPlacement(1500, 900, 125, 75, False)
            state_store.save(placement)

            class FakeWindow:
                width, height, x, y = 1875, 1125, 156, 94
                native = type("Native", (), {"scale_factor": 1.25})()
                screen = type("Screen", (), {"x": 0, "y": 0, "width": 1920, "height": 1080, "frame": None})()

                def __init__(self) -> None:
                    self.calls: list[tuple[object, ...]] = []

                def restore(self) -> None:
                    self.calls.append(("restore",))

                def resize(self, width: int, height: int) -> None:
                    self.width, self.height = width, height
                    self.calls.append(("resize", width, height))

                def move(self, x: int, y: int) -> None:
                    self.calls.append(("move", x, y))

            window = FakeWindow()
            api = DesktopApi(store, root, state_dir=root / "state")
            api._bind_window(window, state_store, placement)

            api.set_project_creation_mode(True)
            self.assertIn(("resize", 1080, 680), window.calls)
            self.assertIn(("move", 420, 200), window.calls)

            api.set_project_creation_mode(False)
            self.assertIn(("resize", 1875, 1125), window.calls)
            self.assertIn(("move", 125, 75), window.calls)

    def test_webview2_version_validation_rejects_missing_runtime_marker(self) -> None:
        self.assertFalse(_valid_version(None))
        self.assertFalse(_valid_version("0.0.0.0"))
        self.assertTrue(_valid_version("126.0.2592.87"))

    def test_webview2_file_fallback_uses_latest_complete_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "149.0.1.0").mkdir()
            latest = root / "150.0.4078.99"
            latest.mkdir()
            latest.joinpath("msedgewebview2.exe").write_bytes(b"runtime")
            self.assertEqual(_installed_file_version(root), "150.0.4078.99")

    def test_standard_paths_support_overrides_and_keep_state_outside_projects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = {"HIKARI_APP_DATA": str(root / "state"), "HIKARI_PROJECTS_DIR": str(root / "workspace" / "Projects")}
            with patch.dict(os.environ, environment, clear=False):
                paths = resolve_desktop_paths(root=root / "resources")
            self.assertEqual(paths.app_data_dir, (root / "state").resolve())
            self.assertEqual(paths.projects_dir, (root / "workspace" / "Projects").resolve())
            self.assertEqual(paths.exports_dir, (root / "workspace" / "Builds").resolve())
            self.assertTrue(paths.config_dir.is_dir())

            store = ProjectStore(paths.projects_dir, state_dir=paths.app_data_dir)
            store.load()
            self.assertEqual(store.recent_projects_path.parent, paths.app_data_dir)
            self.assertEqual(store.runtime_storage_dir.parent, paths.app_data_dir)

    def test_legacy_migration_copies_projects_and_private_history_without_deleting_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / "resources"
            source = resources / "data" / "demo"
            (source / ".hikari" / "agent").mkdir(parents=True)
            (source / "project.hikari.json").write_text('{"version":3}', encoding="utf-8")
            (source / ".hikari" / "agent" / "memory.json").write_text('{"world":"kept"}', encoding="utf-8")
            environment = {"HIKARI_APP_DATA": str(root / "state"), "HIKARI_PROJECTS_DIR": str(root / "documents" / "Projects")}
            with patch.dict(os.environ, environment, clear=False):
                paths = resolve_desktop_paths(root=resources)
            migrated = migrate_legacy_desktop_data(paths)
            self.assertEqual(migrated, [paths.projects_dir / "demo"])
            self.assertTrue((paths.projects_dir / "demo" / ".hikari" / "agent" / "memory.json").is_file())
            self.assertTrue(source.is_dir())
            self.assertEqual(migrate_legacy_desktop_data(paths), [])

    def test_window_state_is_atomic_validated_and_preserves_normal_bounds_when_maximized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config" / "window-state.json"
            store = WindowStateStore(path)
            store.save(WindowPlacement(1500, 920, -1200, 80, False))
            self.assertEqual(store.load(), WindowPlacement(1500, 920, -1200, 80, False))
            window = type("Window", (), {"width": 1920, "height": 1080, "x": 0, "y": 0})()
            maximized = store.capture(window, maximized=True, previous=store.load())
            self.assertEqual(maximized, WindowPlacement(1500, 920, -1200, 80, True))
            destroyed_window = type("DestroyedWindow", (), {
                "width": property(lambda _: (_ for _ in ()).throw(TypeError("window destroyed"))),
                "height": property(lambda _: (_ for _ in ()).throw(TypeError("window destroyed"))),
                "x": property(lambda _: (_ for _ in ()).throw(TypeError("window destroyed"))),
                "y": property(lambda _: (_ for _ in ()).throw(TypeError("window destroyed"))),
            })()
            restored = store.capture(destroyed_window, maximized=False, previous=maximized)
            self.assertEqual(restored, WindowPlacement(1500, 920, -1200, 80, False))
            path.write_text(json.dumps({"width": 20, "height": 10, "x": "bad"}), encoding="utf-8")
            self.assertEqual(store.load(), WindowPlacement())

    def test_legacy_physical_window_state_migrates_to_logical_pixels_and_visible_screen(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config" / "window-state.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"width": 2564, "height": 1570, "x": -211, "y": 1000}), encoding="utf-8")
            screen = type("Screen", (), {"x": 0, "y": 0, "width": 1707, "height": 1067, "frame": None})()
            store = WindowStateStore(path)

            placement = store.load(screens=[screen], scale_factor=1.5)

            self.assertEqual(placement, WindowPlacement(1707, 1047, 0, 20, False))

    def test_window_capture_persists_logical_pixels_at_high_dpi(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config" / "window-state.json"
            store = WindowStateStore(path)
            window = type("Window", (), {"width": 2160, "height": 1350, "x": 180, "y": 120})()

            placement = store.capture(window, maximized=False, scale_factor=1.5)

            self.assertEqual(placement, WindowPlacement(1440, 900, 120, 80, False))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["version"], 2)

    def test_second_instance_forwards_payload_and_does_not_acquire_lock(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            received: list[dict[str, str]] = []
            delivered = threading.Event()
            first = SingleInstance(Path(directory), lambda payload: (received.append(payload), delivered.set()), app_id="HikariStudioTest")
            second = SingleInstance(Path(directory), lambda _: None, app_id="HikariStudioTest")
            try:
                self.assertTrue(first.acquire())
                self.assertFalse(second.acquire({"projectPath": "C:/story/project.hikari.json"}))
                self.assertTrue(delivered.wait(2))
                self.assertEqual(received, [{"projectPath": "C:/story/project.hikari.json"}])
            finally:
                second.close()
                first.close()


if __name__ == "__main__":
    unittest.main()
