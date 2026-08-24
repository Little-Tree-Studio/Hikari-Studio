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
from backend.window_state import WindowPlacement, WindowStateStore


class DesktopRuntimeTests(unittest.TestCase):
    def test_popup_always_on_top_targets_only_registered_window(self) -> None:
        class FakeWindow:
            def __init__(self) -> None:
                self.values: list[bool] = []
                self.sizes: list[tuple[int, int]] = []

            def set_always_on_top(self, enabled: bool) -> None:
                self.values.append(enabled)

            def resize_content(self, width: int, height: int) -> None:
                self.sizes.append((width, height))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main = FakeWindow()
            popup = FakeWindow()
            api = DesktopApi(ProjectStore(root / "projects"), root)
            api._bind_window(main)

            self.assertTrue(api._register_popup_window("inspector", popup))
            self.assertTrue(api.set_window_always_on_top(True, "inspector"))
            self.assertEqual(popup.values, [True])
            self.assertEqual(main.values, [])
            self.assertTrue(api.resize_popup_window(520, 500, "inspector"))
            self.assertEqual(popup.sizes, [(520, 500)])
            self.assertFalse(api.resize_popup_window(200, 100, "inspector"))
            api._unregister_popup_window("inspector")
            self.assertFalse(api.set_window_always_on_top(False, "inspector"))

    def test_window_drag_moves_to_a_valid_pointer_derived_position(self) -> None:
        class FakeWindow:
            def __init__(self) -> None:
                self.calls: list[tuple[object, ...]] = []

            def restore(self) -> None:
                self.calls.append(("restore",))

            def move(self, x: int, y: int) -> None:
                self.calls.append((x, y))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            window = FakeWindow()
            api = DesktopApi(ProjectStore(root / "projects"), root)
            api._bind_window(window)

            self.assertTrue(api.move_window(321.4, -18.6))
            self.assertEqual(window.calls, [(321, -19)])
            self.assertFalse(api.move_window(float("inf"), 0))
            self.assertEqual(window.calls, [(321, -19)])
            api._window_maximized = True
            self.assertTrue(api.move_window(640, 360))
            self.assertEqual(window.calls[-2:], [("restore",), (640, 360)])
            self.assertFalse(api._window_maximized)

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
            self.assertIn(("resize", 1480, 920), window.calls)
            self.assertIn(("move", 120, 70), window.calls)

    def test_project_creation_mode_keeps_compact_logical_size_for_windows_dpi(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ProjectStore(root / "projects", state_dir=root / "state")
            state_store = WindowStateStore(root / "state" / "config" / "window-state.json")
            placement = WindowPlacement(1500, 900, 125, 75, False)
            state_store.save(placement)

            class FakeWindow:
                width, height, x, y = 1500, 900, 125, 75
                screen = type("Screen", (), {"x": 0, "y": 0, "width": 2560, "height": 1440, "frame": None})()

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
            self.assertIn(("move", 740, 380), window.calls)

            api.set_project_creation_mode(False)
            self.assertIn(("resize", 1500, 900), window.calls)
            self.assertIn(("move", 125, 75), window.calls)

    def test_frameless_window_resize_uses_requested_anchor(self) -> None:
        class FakeWindow:
            def __init__(self) -> None:
                self.calls: list[tuple[object, ...]] = []

            def resize(self, width: int, height: int, fix_point: object = None) -> None:
                self.calls.append((width, height, fix_point))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            window = FakeWindow()
            api = DesktopApi(ProjectStore(root / "projects"), root)
            api._bind_window(window)

            self.assertTrue(api.resize_window(1200.4, 740.6, "east", "south"))
            self.assertEqual(window.calls[0][:2], (1200, 741))
            self.assertTrue(api.resize_window(400, 300))
            self.assertEqual(window.calls[1][:2], (760, 520))
            self.assertFalse(api.resize_window(float("inf"), 700))
            api._window_maximized = True
            self.assertFalse(api.resize_window(900, 600))

    def test_maximize_uses_screen_work_area_instead_of_fullscreen(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            placement = WindowPlacement(1200, 760, 100, 80, False)

            class FakeWindow:
                native = type("Native", (), {"scale_factor": 1.25})()
                screen = type(
                    "Screen",
                    (),
                    {
                        "x": 0,
                        "y": 0,
                        "width": 2560,
                        "height": 1440,
                        "frame": type("Frame", (), {"X": 0, "Y": 0, "Width": 2560, "Height": 1400})(),
                    },
                )()

                def __init__(self) -> None:
                    self.calls: list[tuple[object, ...]] = []

                def restore(self) -> None:
                    self.calls.append(("restore",))

                def resize(self, width: int, height: int) -> None:
                    self.calls.append(("resize", width, height))

                def move(self, x: int, y: int) -> None:
                    self.calls.append(("move", x, y))

                def maximize(self) -> None:
                    self.calls.append(("maximize",))

                def set_geometry(self, x: int, y: int, width: int, height: int) -> None:
                    self.calls.append(("geometry", x, y, width, height))

            window = FakeWindow()
            api = DesktopApi(ProjectStore(root / "projects"), root)
            api._bind_window(window, WindowStateStore(root / "window-state.json"), placement)

            self.assertTrue(api.toggle_maximize())
            self.assertIn(("maximize",), window.calls)
            self.assertTrue(api.toggle_maximize())
            self.assertIn(("resize", 1200, 760), window.calls)

    def test_project_creation_mode_fits_smaller_screen(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            placement = WindowPlacement(900, 600, 0, 0, False)

            class FakeWindow:
                width, height, x, y = 900, 600, 0, 0
                screen = type("Screen", (), {"x": 0, "y": 0, "width": 900, "height": 600, "frame": None})()

                def __init__(self) -> None:
                    self.calls: list[tuple[object, ...]] = []

                def restore(self) -> None:
                    self.calls.append(("restore",))

                def resize(self, width: int, height: int) -> None:
                    self.calls.append(("resize", width, height))

                def move(self, x: int, y: int) -> None:
                    self.calls.append(("move", x, y))

            window = FakeWindow()
            api = DesktopApi(ProjectStore(root / "projects"), root)
            api._bind_window(window, WindowStateStore(root / "window-state.json"), placement)

            self.assertTrue(api.set_project_creation_mode(True))
            self.assertIn(("resize", 900, 600), window.calls)
            self.assertIn(("move", 0, 0), window.calls)

    def test_standard_paths_support_overrides_and_keep_state_outside_projects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = {"SLIDE_APP_DATA": str(root / "state"), "SLIDE_PROJECTS_DIR": str(root / "workspace" / "Projects")}
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
            (source / ".slide" / "agent").mkdir(parents=True)
            (source / "project.slide.json").write_text('{"version":3}', encoding="utf-8")
            (source / ".slide" / "agent" / "memory.json").write_text('{"world":"kept"}', encoding="utf-8")
            environment = {"SLIDE_APP_DATA": str(root / "state"), "SLIDE_PROJECTS_DIR": str(root / "documents" / "Projects")}
            with patch.dict(os.environ, environment, clear=False):
                paths = resolve_desktop_paths(root=resources)
            migrated = migrate_legacy_desktop_data(paths)
            self.assertEqual(migrated, [paths.projects_dir / "demo"])
            self.assertTrue((paths.projects_dir / "demo" / ".slide" / "agent" / "memory.json").is_file())
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
            screen = type("Screen", (), {"x": 0, "y": 0, "width": 2560, "height": 1600, "frame": None})()
            store = WindowStateStore(path)

            placement = store.load(screens=[screen], scale_factor=1.5)

            self.assertEqual(placement, WindowPlacement(1707, 1047, 0, 20, False))

    def test_current_window_state_is_clamped_to_logical_screen_bounds_at_high_dpi(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config" / "window-state.json"
            store = WindowStateStore(path)
            store.save(WindowPlacement(1800, 1000, 100, 80, False))
            screen = type("Screen", (), {"x": 0, "y": 0, "width": 1920, "height": 1080, "frame": None})()

            placement = store.load(screens=[screen], scale_factor=1.5)

            self.assertEqual(placement, WindowPlacement(1280, 720, 0, 0, False))

    def test_window_capture_persists_logical_pixels_at_high_dpi(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config" / "window-state.json"
            store = WindowStateStore(path)
            window = type("Window", (), {"width": 1440, "height": 900, "x": 120, "y": 80})()

            placement = store.capture(window, maximized=False, scale_factor=1)

            self.assertEqual(placement, WindowPlacement(1440, 900, 120, 80, False))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["version"], 2)

    def test_second_instance_forwards_payload_and_does_not_acquire_lock(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            received: list[dict[str, str]] = []
            delivered = threading.Event()
            first = SingleInstance(Path(directory), lambda payload: (received.append(payload), delivered.set()), app_id="SlideStudioTest")
            second = SingleInstance(Path(directory), lambda _: None, app_id="SlideStudioTest")
            try:
                self.assertTrue(first.acquire())
                self.assertFalse(second.acquire({"projectPath": "C:/story/project.slide.json"}))
                self.assertTrue(delivered.wait(2))
                self.assertEqual(received, [{"projectPath": "C:/story/project.slide.json"}])
            finally:
                second.close()
                first.close()


if __name__ == "__main__":
    unittest.main()
