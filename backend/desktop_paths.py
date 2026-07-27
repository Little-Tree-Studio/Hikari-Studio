from __future__ import annotations

import os
import shutil
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path


APP_DIRECTORY_NAME = "Hikari Studio"


def _known_folder(folder_id: str, fallback: Path) -> Path:
    if os.name != "nt":
        return fallback
    try:
        import ctypes
        from ctypes import wintypes

        path_pointer = ctypes.c_wchar_p()
        identifier = (ctypes.c_byte * 16).from_buffer_copy(uuid.UUID(folder_id).bytes_le)
        result = ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(identifier), 0, None, ctypes.byref(path_pointer))
        if result != 0:
            return fallback
        try:
            return Path(path_pointer.value)
        finally:
            ctypes.windll.ole32.CoTaskMemFree(path_pointer)
    except (AttributeError, OSError, ValueError):
        return fallback


def resource_root() -> Path:
    bundled = getattr(sys, "_MEIPASS", None)
    if getattr(sys, "frozen", False) and bundled:
        return Path(bundled).resolve()
    if "__compiled__" in globals():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class DesktopPaths:
    resource_root: Path
    app_data_dir: Path
    config_dir: Path
    cache_dir: Path
    logs_dir: Path
    projects_dir: Path
    exports_dir: Path
    legacy_data_dir: Path
    portable: bool = False

    def ensure(self) -> "DesktopPaths":
        for path in (self.app_data_dir, self.config_dir, self.cache_dir, self.logs_dir, self.projects_dir, self.exports_dir):
            path.mkdir(parents=True, exist_ok=True)
        return self


def resolve_desktop_paths(*, portable: bool = False, root: Path | None = None) -> DesktopPaths:
    resources = (root or resource_root()).resolve()
    executable_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else resources
    env_app_data = os.getenv("HIKARI_APP_DATA")
    env_projects = os.getenv("HIKARI_PROJECTS_DIR")
    env_exports = os.getenv("HIKARI_EXPORTS_DIR")
    if portable or os.getenv("HIKARI_PORTABLE") == "1":
        app_data = executable_dir / "user-data"
        projects = executable_dir / "projects"
        exports = executable_dir / "exports"
    else:
        home = Path.home()
        local_app_data = _known_folder("f1b32785-6fba-4fcf-9d55-7b8e7f157091", Path(os.getenv("LOCALAPPDATA", home / "AppData" / "Local")))
        documents = _known_folder("fdd39ad0-238f-46af-adb4-6c85480369c7", home / "Documents")
        app_data = Path(env_app_data).expanduser() if env_app_data else local_app_data / APP_DIRECTORY_NAME
        projects = Path(env_projects).expanduser() if env_projects else documents / APP_DIRECTORY_NAME / "Projects"
        exports = Path(env_exports).expanduser() if env_exports else (projects.parent / "Builds" if env_projects else documents / APP_DIRECTORY_NAME / "Builds")
    return DesktopPaths(
        resource_root=resources,
        app_data_dir=app_data.resolve(),
        config_dir=(app_data / "config").resolve(),
        cache_dir=(app_data / "cache").resolve(),
        logs_dir=(app_data / "logs").resolve(),
        projects_dir=projects.resolve(),
        exports_dir=exports.resolve(),
        legacy_data_dir=(resources / "data").resolve(),
        portable=portable,
    ).ensure()


def migrate_legacy_desktop_data(paths: DesktopPaths) -> list[Path]:
    source = paths.legacy_data_dir
    if not source.is_dir() or source == paths.projects_dir:
        return []
    migrated: list[Path] = []
    for project_dir in source.iterdir():
        if not project_dir.is_dir() or not (project_dir / "project.hikari.json").is_file():
            continue
        destination = paths.projects_dir / project_dir.name
        if destination.exists():
            continue
        shutil.copytree(project_dir, destination)
        migrated.append(destination)
    for legacy_project in source.glob("*.hikari.json"):
        destination = paths.projects_dir / legacy_project.name
        if not destination.exists():
            shutil.copy2(legacy_project, destination)
            migrated.append(destination)
    legacy_state = source / ".hikari-studio"
    if legacy_state.is_dir():
        for item in legacy_state.iterdir():
            destination = paths.app_data_dir / item.name
            if destination.exists():
                continue
            if item.is_dir():
                shutil.copytree(item, destination)
            else:
                shutil.copy2(item, destination)
    return migrated
