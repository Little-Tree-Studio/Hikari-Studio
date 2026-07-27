from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.desktop_paths import migrate_legacy_desktop_data, resolve_desktop_paths
from backend.project_store import ProjectStore
from backend.single_instance import SingleInstance
from backend.window_state import WindowPlacement, WindowStateStore


class DesktopRuntimeTests(unittest.TestCase):
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
