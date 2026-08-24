from __future__ import annotations

import json
import hashlib
import logging
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .native_asset_worker import inspect_assets, scan_assets


PROJECT_VERSION = 3
LOGGER = logging.getLogger(__name__)


def default_production_memory() -> dict[str, Any]:
    return {"version": 1, "world": "", "characterRules": [], "styleRules": [], "facts": [], "restrictions": [], "updatedAt": ""}
MANIFEST_NAME = "project.slide.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AUDIO_EXTENSIONS = {".mp3", ".ogg", ".wav", ".flac", ".m4a"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}
SUPPORTED_ASSET_EXTENSIONS = IMAGE_EXTENSIONS | AUDIO_EXTENSIONS | VIDEO_EXTENSIONS | FONT_EXTENSIONS
MAX_RUNTIME_VALUE_BYTES = 64 * 1024 * 1024
MAX_COMMAND_HISTORY_BYTES = 128 * 1024 * 1024


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _safe_name(value: str, fallback: str) -> str:
    return re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", value.strip()).strip("-") or fallback


def _component_id(value: Any) -> str:
    identifier = str(value or "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", identifier) or identifier in {".", ".."}:
        raise ValueError(f"Unsafe project component id: {identifier!r}")
    return identifier


def _language_file_name(language: Any) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", str(language or "").strip()).strip("_")
    if not cleaned or cleaned in {".", ".."}:
        raise ValueError(f"Unsafe language code: {language!r}")
    return f"{cleaned}.json"


def _translation_table(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {str(key): entry for key, entry in value.items() if isinstance(entry, dict)}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def default_blocks() -> list[dict[str, Any]]:
    return [
        {"id": "b1", "type": "scene", "sceneId": "scene-lake", "title": "晨雾湖畔", "assetId": "lake", "transition": "dissolve", "duration": 1.2},
        {"id": "b2", "type": "sound", "title": "summer_memory.mp3", "volume": 0.68, "loop": True},
        {"id": "b3", "type": "narration", "text": "薄雾沿着湖面缓慢散开，夏日的第一束阳光落在旧码头上。"},
        {"id": "b4", "type": "dialogue", "speaker": "林澄", "text": "你果然还是来了。", "expression": "浅笑"},
        {"id": "b5", "type": "dialogue", "speaker": "苏芮", "text": "因为有人在信里说，错过今天就再也见不到这片星海了。", "expression": "平静"},
        {"id": "b6", "type": "branch", "title": "如何回应？", "options": [{"text": "相信她", "target": "opening"}, {"text": "转移话题", "target": "old-school"}]},
    ]


def default_project(name: str = "星海回声") -> dict[str, Any]:
    return {
        "version": PROJECT_VERSION,
        "meta": {
            "id": new_id("project"),
            "name": name,
            "author": "",
            "resolution": [1280, 720],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "characters": [
            {"id": "lin-cheng", "name": "林澄", "color": "#e66b4f", "expressions": ["默认", "浅笑", "惊讶", "难过"], "portraits": {}},
            {"id": "su-rui", "name": "苏芮", "color": "#825eb5", "expressions": ["默认", "平静", "犹豫"], "portraits": {}},
        ],
        "scenes": [
            {"id": "scene-lake", "name": "晨雾湖畔", "layers": [{"id": "layer-lake", "name": "背景", "assetId": "lake", "opacity": 1, "blendMode": "normal", "offsetX": 0, "offsetY": 0, "scale": 1, "distance": 1, "visible": True}]},
            {"id": "scene-mountain", "name": "远山晴空", "layers": [{"id": "layer-mountain", "name": "背景", "assetId": "mountain", "opacity": 1, "blendMode": "normal", "offsetX": 0, "offsetY": 0, "scale": 1, "distance": 1, "visible": True}]},
        ],
        "sceneGroups": [],
        "chapters": [
            {"id": "start", "name": "开始", "entry": True, "fragments": [{"id": "opening", "name": "片头"}, {"id": "menu", "name": "主菜单"}]},
            {"id": "chapter-1", "name": "第一章 · 雾中的来信", "fragments": [{"id": "lake-meeting", "name": "湖畔相遇"}, {"id": "old-school", "name": "旧校舍"}, {"id": "rain-call", "name": "雨夜电话"}]},
            {"id": "chapter-2", "name": "第二章 · 蓝色时刻", "fragments": [{"id": "rooftop", "name": "天台"}, {"id": "planetarium", "name": "星象馆"}]},
        ],
        "activeFragmentId": "lake-meeting",
        "scripts": {
            "opening": [{"id": new_id("block"), "type": "narration", "text": "星海回声"}],
            "menu": [],
            "lake-meeting": default_blocks(),
            "old-school": [{"id": new_id("block"), "type": "scene", "title": "旧校舍"}, {"id": new_id("block"), "type": "narration", "text": "尘埃在走廊的光束中缓缓飘落。"}],
            "rain-call": [], "rooftop": [], "planetarium": [],
        },
        "timelines": {},
        "assets": [
            {"id": "lake", "kind": "scene", "name": "晨雾湖畔", "path": "builtin/lake.jpg", "uri": "./assets/lake.jpg"},
            {"id": "mountain", "kind": "scene", "name": "远山晴空", "path": "builtin/mountain.jpg", "uri": "./assets/mountain.jpg"},
        ],
        "variables": {"好感度": 0},
        "variableDefinitions": {
            "好感度": {"displayName": "好感度", "description": "角色好感数值", "type": "number", "scope": "project", "persistence": "slot"},
        },
        "settings": {"textSpeed": 35, "autoSave": True, "skipRead": True},
        "locale": {"default": "zh-CN", "languages": ["zh-CN"]},
        "ui": {"theme": "slide-light", "dialogueStyle": "glass"},
        "productionMemory": default_production_memory(),
    }


def blank_project(name: str = "未命名项目") -> dict[str, Any]:
    project = default_project(name)
    project.update({
        "characters": [],
        "scenes": [],
        "sceneGroups": [],
        "chapters": [{"id": "start", "name": "开始", "entry": True, "fragments": [{"id": "opening", "name": "主线"}]}],
        "activeFragmentId": "opening",
        "scripts": {"opening": []},
        "timelines": {},
        "assets": [],
        "variables": {},
        "variableDefinitions": {},
    })
    return project


class ProjectStore:
    def __init__(self, data_dir: Path, state_dir: Path | None = None) -> None:
        self.data_dir = data_dir.resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.state_dir = (state_dir or self.data_dir / ".slide-studio").resolve()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        legacy = self.data_dir / "star-sea-echo.slide.json"
        current = self.data_dir / "star-sea-echo" / MANIFEST_NAME
        self.project_path = legacy if legacy.exists() and not current.exists() else current
        self._lock = threading.RLock()
        self._last_recovery_used = False
        if not self.project_path.exists():
            self.save(default_project())

    @property
    def project_root(self) -> Path:
        return self.project_path.parent

    @property
    def asset_dir(self) -> Path:
        folder = self.project_root / "assets" / "files"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    @property
    def recovery_path(self) -> Path:
        return self.project_root / ".slide" / "recovery.json"

    @property
    def command_history_path(self) -> Path:
        return self.project_root / ".slide" / "history" / "commands.json"

    @property
    def recent_projects_path(self) -> Path:
        return self.state_dir / "recent-projects.json"

    @property
    def runtime_storage_dir(self) -> Path:
        folder = self.state_dir / "runtime-storage"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    @property
    def asset_hash_cache_path(self) -> Path:
        return self.state_dir / "cache" / "asset-hashes-v1.json"

    def _runtime_value_path(self, key: str) -> Path:
        if not isinstance(key, str) or not key or len(key) > 1024:
            raise ValueError("Runtime storage key must be a non-empty string of at most 1024 characters")
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.runtime_storage_dir / f"{digest}.value"

    def read_runtime_value(self, key: str) -> str | None:
        path = self._runtime_value_path(key)
        with self._lock:
            if not path.exists():
                return None
            if path.stat().st_size > MAX_RUNTIME_VALUE_BYTES:
                raise ValueError("Runtime storage value exceeds the 64 MiB limit")
            return path.read_text(encoding="utf-8")

    def write_runtime_value(self, key: str, value: str) -> bool:
        if not isinstance(value, str):
            raise ValueError("Runtime storage value must be a string")
        if len(value.encode("utf-8")) > MAX_RUNTIME_VALUE_BYTES:
            raise ValueError("Runtime storage value exceeds the 64 MiB limit")
        path = self._runtime_value_path(key)
        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary_name = tempfile.mkstemp(prefix=".slide-runtime-", suffix=".tmp", dir=path.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                    stream.write(value)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary_name, path)
            finally:
                if os.path.exists(temporary_name):
                    os.unlink(temporary_name)
        return True

    def delete_runtime_value(self, key: str) -> bool:
        path = self._runtime_value_path(key)
        with self._lock:
            path.unlink(missing_ok=True)
        return True

    def load_command_history(self) -> dict[str, Any] | None:
        with self._lock:
            path = self.command_history_path
            if not path.exists():
                return None
            if path.stat().st_size > MAX_COMMAND_HISTORY_BYTES:
                raise ValueError("Command history exceeds the 128 MiB limit")
            value = self._validate_command_history(self._read_json(path))
            manifest = self._read_json(self.project_path)
            return value if value.get("projectId") == manifest.get("meta", {}).get("id") else None

    def load_recovery_snapshot(self) -> dict[str, Any] | None:
        with self._lock:
            if not self.recovery_path.exists():
                return None
            project = self._load_recovery()
            if project is None:
                return None
            manifest = self._read_json(self.project_path)
            if project.get("meta", {}).get("id") != manifest.get("meta", {}).get("id"):
                return None
            modified = datetime.fromtimestamp(self.recovery_path.stat().st_mtime, timezone.utc).isoformat()
            return {"project": project, "updatedAt": modified, "recoveredDuringLoad": self._last_recovery_used}

    def get_recovery_snapshot_status(self) -> dict[str, Any]:
        """Return recovery metadata without parsing the potentially large snapshot."""
        with self._lock:
            path = self.recovery_path
            if not path.exists():
                return {"exists": False, "updatedAt": None, "bytes": 0, "recoveredDuringLoad": self._last_recovery_used}
            stat = path.stat()
            return {
                "exists": True,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "bytes": stat.st_size,
                "recoveredDuringLoad": self._last_recovery_used,
            }

    def save_command_history(self, history: dict[str, Any]) -> dict[str, Any]:
        value = self._validate_command_history(history)
        manifest = self._read_json(self.project_path)
        if value.get("projectId") != manifest.get("meta", {}).get("id"):
            raise ValueError("Command history belongs to another project")
        encoded_size = len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if encoded_size > MAX_COMMAND_HISTORY_BYTES:
            raise ValueError("Command history exceeds the 128 MiB limit")
        with self._lock:
            self._write_json_atomic(self.command_history_path, value)
        return {"ok": True, "path": str(self.command_history_path), **self._command_history_stats(value, self.command_history_path.stat().st_size)}

    def load_command_history_stats(self) -> dict[str, Any]:
        with self._lock:
            value = self.load_command_history()
            if value is None:
                return self._command_history_stats(None, 0)
            return self._command_history_stats(value, self.command_history_path.stat().st_size)

    @staticmethod
    def _command_history_stats(history: dict[str, Any] | None, size: int) -> dict[str, Any]:
        if history is None:
            return {"version": 2, "bytes": 0, "uncompressedBytes": 0, "compressionRate": 0.0, "commandCount": 0, "ordinaryCount": 0, "pinnedCount": 0, "snapshotCount": 0}
        archive = history.get("archive", []) if history["version"] == 2 else []
        commands = [*history["undo"], *history["redo"], *archive]
        raw_size = history.get("storage", {}).get("uncompressedBytes", size) if history["version"] == 2 else size
        uncompressed_size = max(size, int(raw_size)) if isinstance(raw_size, (int, float)) and raw_size >= 0 else size
        compression_rate = max(0.0, min(1.0, 1.0 - (size / uncompressed_size))) if uncompressed_size else 0.0
        pinned_count = sum(1 for command in commands if command.get("pinned") is True)
        return {
            "version": history["version"], "bytes": size, "uncompressedBytes": uncompressed_size, "compressionRate": compression_rate,
            "commandCount": len(commands), "ordinaryCount": len(commands) - pinned_count, "pinnedCount": pinned_count,
            "snapshotCount": len(history.get("snapshots", [])) if history["version"] == 2 else len(commands) * 2,
        }

    @staticmethod
    def _validate_command_history(history: Any) -> dict[str, Any]:
        if not isinstance(history, dict) or history.get("version") not in {1, 2}:
            raise ValueError("Unsupported Command history version")
        if not isinstance(history.get("projectId"), str) or not history["projectId"]:
            raise ValueError("Command history project id is invalid")
        undo = history.get("undo")
        redo = history.get("redo")
        if not isinstance(undo, list) or not isinstance(redo, list) or len(undo) > 50 or len(redo) > 50:
            raise ValueError("Command history stack is invalid")
        archive = history.get("archive", []) if history["version"] == 2 else []
        if not isinstance(archive, list) or len(archive) > 50:
            raise ValueError("Command history archive is invalid")
        commands = [*undo, *redo, *archive]
        command_ids: set[str] = set()
        for command in commands:
            if not isinstance(command, dict) or not isinstance(command.get("id"), str) or not command["id"].startswith("command-"):
                raise ValueError("Command history entry is invalid")
            if command["id"] in command_ids:
                raise ValueError("Command history contains duplicate entries")
            command_ids.add(command["id"])
            if not isinstance(command.get("label"), str) or not isinstance(command.get("timestamp"), (int, float)):
                raise ValueError("Command history metadata is invalid")
            if command.get("name") is not None and (not isinstance(command["name"], str) or len(command["name"]) > 120):
                raise ValueError("Command history name is invalid")
            if command.get("pinned") is not None and not isinstance(command["pinned"], bool):
                raise ValueError("Command history pin state is invalid")
        if history["version"] == 1:
            for command in commands:
                if not isinstance(command.get("before"), dict) or not isinstance(command.get("after"), dict):
                    raise ValueError("Command history snapshot is invalid")
        else:
            storage = history.get("storage")
            if storage is not None and (not isinstance(storage, dict) or not isinstance(storage.get("uncompressedBytes"), int) or storage["uncompressedBytes"] < 0):
                raise ValueError("Command history storage metadata is invalid")
            snapshots = history.get("snapshots")
            if not isinstance(snapshots, list) or len(snapshots) > 400:
                raise ValueError("Command history snapshots are invalid")
            snapshot_ids: set[str] = set()
            for snapshot in snapshots:
                snapshot_id = snapshot.get("id") if isinstance(snapshot, dict) else None
                if not isinstance(snapshot_id, str) or not snapshot_id.startswith("snapshot-") or snapshot_id in snapshot_ids:
                    raise ValueError("Command history snapshot id is invalid")
                has_value = isinstance(snapshot.get("value"), dict)
                has_delta = isinstance(snapshot.get("baseId"), str) and isinstance(snapshot.get("delta"), dict) and snapshot["baseId"] in snapshot_ids
                if has_value == has_delta:
                    raise ValueError("Command history snapshot payload is invalid")
                snapshot_ids.add(snapshot_id)
            for command in commands:
                if command.get("beforeRef") not in snapshot_ids or command.get("afterRef") not in snapshot_ids:
                    raise ValueError("Command history snapshot reference is invalid")
        return deepcopy(history)

    def list_recent_projects(self) -> list[dict[str, Any]]:
        entries = self._read_json(self.recent_projects_path, default=[])
        if not isinstance(entries, list):
            entries = []
        normalized = []
        for item in entries:
            if not isinstance(item, dict) or not item.get("path"):
                continue
            path = Path(str(item["path"])).expanduser()
            normalized.append({
                "path": str(path),
                "name": str(item.get("name") or path.parent.name),
                "updatedAt": str(item.get("updatedAt") or ""),
                "pinned": bool(item.get("pinned", False)),
                "exists": path.is_file(),
            })
        return sorted(normalized, key=lambda item: (not item["pinned"], item["updatedAt"]), reverse=False)

    def set_project_pinned(self, path_text: str, pinned: bool) -> list[dict[str, Any]]:
        target = str(Path(path_text).expanduser().resolve())
        entries = self.list_recent_projects()
        found = False
        for item in entries:
            if str(Path(item["path"]).resolve()) == target:
                item["pinned"] = bool(pinned)
                found = True
        if not found:
            raise ValueError("最近项目记录不存在")
        self._write_json_atomic(self.recent_projects_path, [{key: value for key, value in item.items() if key != "exists"} for item in entries])
        return self.list_recent_projects()

    def _remember_project(self, project: dict[str, Any]) -> None:
        target = str(self.project_path.resolve())
        entries = self.list_recent_projects()
        previous = next((item for item in entries if str(Path(item["path"]).resolve()) == target), None)
        entries = [item for item in entries if str(Path(item["path"]).resolve()) != target]
        entries.insert(0, {
            "path": target,
            "name": str(project.get("meta", {}).get("name") or self.project_root.name),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "pinned": bool(previous and previous.get("pinned")),
        })
        pinned = [item for item in entries if item.get("pinned")]
        unpinned = [item for item in entries if not item.get("pinned")][:12]
        self._write_json_atomic(self.recent_projects_path, [{key: value for key, value in item.items() if key != "exists"} for item in pinned + unpinned])

    def create(self, name: str) -> dict[str, Any]:
        safe_name = _safe_name(name, "new-project")
        candidate = self.data_dir / safe_name
        index = 2
        while candidate.exists():
            candidate = self.data_dir / f"{safe_name}-{index}"
            index += 1
        self.project_path = candidate / MANIFEST_NAME
        project = default_project(name.strip() or "未命名项目")
        self.save(project)
        return self.load()

    def create_configured(self, options: dict[str, Any]) -> dict[str, Any]:
        name = str(options.get("name", "")).strip() or "未命名项目"
        template = str(options.get("template", "blank"))
        if template not in {"blank", "sample"}:
            raise ValueError("未知的项目模板")
        resolution = options.get("resolution", [1280, 720])
        if not isinstance(resolution, list) or len(resolution) != 2:
            raise ValueError("画布分辨率格式无效")
        width, height = (int(resolution[0]), int(resolution[1]))
        if width < 640 or height < 360 or width > 7680 or height > 4320:
            raise ValueError("画布分辨率必须在 640x360 到 7680x4320 之间")
        requested_directory = str(options.get("projectDirectory", "")).strip()
        if requested_directory:
            candidate = Path(requested_directory).expanduser().resolve()
        else:
            candidate = (self.data_dir / _safe_name(name, "new-project")).resolve()
            suffix = 2
            while candidate.exists():
                candidate = (self.data_dir / f"{_safe_name(name, 'new-project')}-{suffix}").resolve()
                suffix += 1
        if (candidate / MANIFEST_NAME).exists() or (candidate.exists() and any(candidate.iterdir())):
            raise ValueError("目标项目文件夹已存在且不为空，请选择其他位置")
        candidate.mkdir(parents=True, exist_ok=True)
        previous = self.project_path
        self.project_path = candidate / MANIFEST_NAME
        project = blank_project(name) if template == "blank" else default_project(name)
        background_color = str(options.get("backgroundColor", "#101718"))
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", background_color):
            background_color = "#101718"
        project["meta"].update({
            "author": str(options.get("author", "")).strip(),
            "description": str(options.get("description", "")).strip(),
            "resolution": [width, height],
            "windowTitle": str(options.get("windowTitle", "")).strip() or name,
            "backgroundColor": background_color,
        })
        project.setdefault("ui", {}).setdefault("title", {})["backgroundColor"] = project["meta"]["backgroundColor"]
        try:
            self.save(project)
            return self.load()
        except Exception:
            self.project_path = previous
            raise

    def open(self, path: Path) -> dict[str, Any]:
        resolved = path.expanduser().resolve()
        if resolved.is_dir():
            resolved = resolved / MANIFEST_NAME
        is_legacy = resolved.is_file() and (resolved.suffix.lower() == ".slide" or resolved.name.endswith(".slide.json")) and resolved.name != MANIFEST_NAME
        if not resolved.is_file() or (resolved.name != MANIFEST_NAME and not is_legacy):
            raise ValueError("请选择 project.slide.json、.slide 或旧版 .slide.json 项目文件")
        previous = self.project_path
        self.project_path = resolved
        try:
            return self.load(recover=False)
        except Exception:
            self.project_path = previous
            raise

    def save_as(self, project: dict[str, Any], target_folder: Path) -> dict[str, Any]:
        target_root = target_folder.expanduser().resolve()
        if target_root.name == MANIFEST_NAME:
            target_root = target_root.parent
        source_asset_dir = self.asset_dir
        source_assets = [path for path in source_asset_dir.iterdir() if path.is_file()]
        previous = self.project_path
        self.project_path = target_root / MANIFEST_NAME
        try:
            destination = self.asset_dir
            for source in source_assets:
                shutil.copy2(source, destination / source.name)
            return self.save(project)
        except Exception:
            self.project_path = previous
            raise

    def load(self, recover: bool = True) -> dict[str, Any]:
        with self._lock:
            self._last_recovery_used = False
            try:
                if self.project_path.name == MANIFEST_NAME:
                    project = self._load_v3()
                else:
                    project = self._load_legacy_and_upgrade()
                self._validate(project)
                return project
            except (OSError, json.JSONDecodeError, ValueError, KeyError):
                if not recover:
                    raise
                recovered = self._load_recovery()
                if recovered is not None:
                    self._last_recovery_used = True
                    self.save(recovered)
                    return recovered
                raise

    def save(self, project: dict[str, Any], expected_project_id: str | None = None) -> dict[str, Any]:
        project = self._migrate(project)
        self._validate(project)
        payload = deepcopy(project)
        payload["version"] = PROJECT_VERSION
        payload["meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
        if self.project_path.name != MANIFEST_NAME:
            self._backup_legacy(self.project_path)
            self.project_path = self._upgrade_destination(self.project_path)

        with self._lock:
            if expected_project_id:
                incoming_id = payload.get("meta", {}).get("id")
                if incoming_id != expected_project_id:
                    raise ValueError("Project save payload does not match the expected project")
                if self.project_path.name == MANIFEST_NAME and self.project_path.is_file():
                    try:
                        current_manifest = self._read_json(self.project_path)
                    except (OSError, json.JSONDecodeError):
                        current_manifest = {}
                    current_id = current_manifest.get("meta", {}).get("id") if isinstance(current_manifest, dict) else None
                    if current_id and current_id != expected_project_id:
                        raise ValueError("Project save target changed; refusing to overwrite another project")
            root = self.project_root
            root.mkdir(parents=True, exist_ok=True)
            manifest = {
                "version": PROJECT_VERSION,
                "meta": payload["meta"],
                "activeFragmentId": payload["activeFragmentId"],
                "variables": payload.get("variables", {}),
                "variableDefinitions": payload.get("variableDefinitions", {}),
                "locale": payload.get("locale", {"default": "zh-CN", "languages": ["zh-CN"]}),
                "chapterOrder": [chapter["id"] for chapter in payload["chapters"]],
                "characterOrder": [character["id"] for character in payload.get("characters", [])],
                "sceneOrder": [scene["id"] for scene in payload.get("scenes", [])],
                "sceneGroups": payload.get("sceneGroups", []),
            }
            expected: dict[Path, Any] = {self.project_path: manifest}
            expected.update({root / "chapters" / f"{_component_id(chapter['id'])}.json": chapter for chapter in payload["chapters"]})
            expected.update({root / "scripts" / f"{_component_id(fragment_id)}.json": blocks for fragment_id, blocks in payload["scripts"].items()})
            expected.update({root / "timelines" / f"{_component_id(fragment_id)}.json": timeline for fragment_id, timeline in payload.get("timelines", {}).items()})
            expected.update({root / "characters" / f"{_component_id(character['id'])}.json": character for character in payload.get("characters", [])})
            expected.update({root / "scenes" / f"{_component_id(scene['id'])}.json": scene for scene in payload.get("scenes", [])})
            assets = [{key: value for key, value in asset.items() if key != "uri"} for asset in payload.get("assets", [])]
            expected[root / "assets" / "index.json"] = assets
            translations_payload = payload.get("translations") if isinstance(payload.get("translations"), dict) else {}
            for language in manifest["locale"]["languages"]:
                expected[root / "locales" / _language_file_name(language)] = _translation_table(translations_payload.get(language))
            expected[root / "settings" / "editor.json"] = payload.get("settings", {})
            expected[root / "ui" / "theme.json"] = payload.get("ui", {"theme": "slide-light", "dialogueStyle": "glass"})
            expected[root / ".slide" / "agent" / "memory.json"] = payload.get("productionMemory", default_production_memory())

            # 提交顺序：组件分片 → 崩溃恢复快照 → manifest。
            # manifest 是唯一提交点（最后写入）：中途失败时旧 manifest 仍然有效，
            # 而 recovery 快照已包含本次完整载荷，可供 load(recover=True) 恢复。
            save_started_at = time.time()
            for path, value in expected.items():
                if path != self.project_path:
                    self._write_json_atomic(path, value)
            self._write_json_atomic(self.recovery_path, payload)
            self._write_json_atomic(self.project_path, manifest)
            self._remove_stale_json(root / "chapters", {path for path in expected if path.parent == root / "chapters"}, save_started_at)
            self._remove_stale_json(root / "scripts", {path for path in expected if path.parent == root / "scripts"}, save_started_at)
            self._remove_stale_json(root / "timelines", {path for path in expected if path.parent == root / "timelines"}, save_started_at)
            self._remove_stale_json(root / "characters", {path for path in expected if path.parent == root / "characters"}, save_started_at)
            self._remove_stale_json(root / "scenes", {path for path in expected if path.parent == root / "scenes"}, save_started_at)
            self._remove_stale_json(root / "locales", {path for path in expected if path.parent == root / "locales"}, save_started_at)

        self._remember_project(payload)

        return {"ok": True, "path": str(self.project_path), "bytes": sum(path.stat().st_size for path in expected if path.exists()), "version": PROJECT_VERSION}

    def import_assets(self, source_paths: list[str], audio_category: str | None = None) -> list[dict[str, Any]]:
        sources = list(dict.fromkeys(
            Path(source_text).expanduser().resolve()
            for source_text in source_paths
            if Path(source_text).expanduser().resolve().is_file()
        ))
        native_result = inspect_assets(sources, hash_files=True, cache_path=self.asset_hash_cache_path)
        native_files = {item.path: item for item in native_result.files} if native_result else {}
        if native_result:
            for warning in native_result.warnings:
                LOGGER.warning("Rust asset inspection warning [%s] %s: %s", warning.code, warning.path or "", warning.message)
        imported: list[dict[str, Any]] = []
        destination_hashes: dict[Path, str] = {}
        for source in sources:
            native_file = native_files.get(source)
            source_size = native_file.size if native_file else source.stat().st_size
            source_hash = native_file.sha256 if native_file and native_file.sha256 else _sha256(source)
            extension = source.suffix.lower()
            kind = "image" if extension in IMAGE_EXTENSIONS else "audio" if extension in AUDIO_EXTENSIONS else "video" if extension in VIDEO_EXTENSIONS else "font" if extension in FONT_EXTENSIONS else "file"
            destination = self.asset_dir / source.name
            counter = 2
            while destination.exists():
                destination_size = destination.stat().st_size
                if destination_size == source_size:
                    destination_hash = destination_hashes.get(destination)
                    if destination_hash is None:
                        destination_hash = _sha256(destination)
                        destination_hashes[destination] = destination_hash
                    if destination_hash == source_hash:
                        break
                destination = self.asset_dir / f"{source.stem}-{counter}{source.suffix}"
                counter += 1
            if not destination.exists():
                shutil.copy2(source, destination)
            content_hash = source_hash
            destination_size = destination.stat().st_size
            if native_file is None or destination_size != source_size:
                content_hash = _sha256(destination)
            item = {
                "id": new_id("asset"), "kind": kind, "name": destination.stem,
                "path": destination.name, "uri": destination.as_uri(), "size": destination_size,
                "contentHash": content_hash,
            }
            if kind == "audio":
                item["audioCategory"] = audio_category if audio_category in {"bgm", "sfx", "voice"} else "bgm"
                if item["audioCategory"] == "voice":
                    item["asrStatus"] = "pending"
            imported.append(item)
        return imported

    def replace_asset_file(self, asset_id: str, source_path: str) -> dict[str, Any] | None:
        imported = self.import_assets([source_path])
        if not imported:
            return None
        replacement = imported[0]
        replacement["id"] = asset_id
        destination = self.asset_dir / Path(str(replacement["path"])).name
        replacement["uri"] = f'{replacement["uri"]}?v={destination.stat().st_mtime_ns}'
        return replacement

    def match_missing_assets(self, folder: str, issues: list[dict[str, Any]]) -> dict[str, Any]:
        root = Path(folder).expanduser().resolve()
        if not root.is_dir():
            raise ValueError("选择的素材修复目录不存在")

        expected_hashes = {
            str(issue.get("contentHash") or "").lower()
            for issue in issues
            if str(issue.get("contentHash") or "")
        }
        native_result = scan_assets(
            root,
            SUPPORTED_ASSET_EXTENSIONS,
            hash_files=bool(expected_hashes),
            cache_path=self.asset_hash_cache_path,
        )
        if native_result is None:
            candidates = sorted(
                (path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_ASSET_EXTENSIONS),
                key=lambda path: str(path).casefold(),
            )
            sizes: dict[Path, int] = {}
            hashes: dict[Path, str] = {}
        else:
            candidates = [item.path for item in native_result.files]
            sizes = {item.path: item.size for item in native_result.files}
            hashes = {item.path: item.sha256 for item in native_result.files if item.sha256}
            for warning in native_result.warnings:
                LOGGER.warning("Rust asset scan warning [%s] %s: %s", warning.code, warning.path or "", warning.message)

        def candidate_hash(path: Path) -> str:
            if path not in hashes:
                hashes[path] = _sha256(path)
            return hashes[path]

        def candidate_size(path: Path) -> int:
            if path not in sizes:
                sizes[path] = path.stat().st_size
            return sizes[path]

        matches: list[dict[str, Any]] = []
        ambiguous: list[dict[str, Any]] = []
        unmatched: list[dict[str, Any]] = []
        for raw_issue in issues:
            issue = dict(raw_issue)
            asset_id = str(issue.get("assetId") or "")
            expected_path = str(issue.get("path") or asset_id)
            expected_name = str(issue.get("name") or Path(expected_path).stem or asset_id)
            expected_file = Path(expected_path).name
            if not Path(expected_file).suffix and Path(asset_id).suffix:
                expected_file = Path(asset_id).name
            expected_extension = Path(expected_file).suffix.lower()
            expected_stem = Path(expected_file).stem.casefold() if expected_file else expected_name.casefold()
            expected_hash = str(issue.get("contentHash") or "").lower()
            expected_size = issue.get("size")

            ranked: list[tuple[int, str, Path]] = []
            for candidate in candidates:
                score = 0
                reason = ""
                candidate_name = candidate.name.casefold()
                candidate_extension = candidate.suffix.lower()
                if expected_hash and candidate_hash(candidate) == expected_hash:
                    score, reason = 400, "SHA-256 哈希完全一致"
                elif expected_file and candidate_name == expected_file.casefold():
                    score, reason = 300, "完整文件名一致"
                elif expected_extension and candidate_extension == expected_extension and candidate.stem.casefold() == expected_stem:
                    score, reason = 250, "文件名与扩展名一致"
                elif candidate.stem.casefold() == expected_name.casefold() and (not expected_extension or candidate_extension == expected_extension):
                    score, reason = 200, "素材显示名与扩展名一致"
                elif expected_size is not None and candidate_extension == expected_extension and candidate_size(candidate) == int(expected_size):
                    score, reason = 100, "文件大小与扩展名一致（弱匹配）"
                if score:
                    ranked.append((score, reason, candidate))

            base = {"assetId": asset_id, "name": expected_name, "expectedPath": expected_path}
            if not ranked:
                unmatched.append(base)
                continue
            best_score = max(item[0] for item in ranked)
            best = [item for item in ranked if item[0] == best_score]
            if len(best) > 1:
                ambiguous.append({
                    **base,
                    "score": best_score,
                    "reason": best[0][1],
                    "candidates": [{"sourcePath": str(item[2]), "fileName": item[2].name} for item in best],
                })
                continue
            score, reason, candidate = best[0]
            matches.append({
                **base, "sourcePath": str(candidate), "fileName": candidate.name,
                "reason": reason, "score": score,
            })
        return {
            "folder": str(root), "scannedFiles": len(candidates),
            "matches": matches, "ambiguous": ambiguous, "unmatched": unmatched,
            "scanWarnings": [
                {"code": warning.code, "path": str(warning.path) if warning.path else None, "message": warning.message}
                for warning in native_result.warnings
            ] if native_result else [],
            "hashCacheHits": native_result.stats.cache_hits if native_result else 0,
        }

    def apply_asset_folder_repair(self, matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
        replacements: list[dict[str, Any]] = []
        for match in matches:
            asset_id = str(match.get("assetId") or "")
            source_path = str(match.get("sourcePath") or "")
            if not asset_id or not source_path:
                raise ValueError("批量修复项缺少素材 ID 或源文件路径")
            replacement = self.replace_asset_file(asset_id, source_path)
            if replacement is None:
                raise ValueError(f"无法读取修复素材: {source_path}")
            replacements.append(replacement)
        return replacements

    def _load_v3(self) -> dict[str, Any]:
        manifest = self._read_json(self.project_path)
        if int(manifest.get("version", 0)) != PROJECT_VERSION:
            raise ValueError("Unsupported directory project version")
        root = self.project_root
        chapters = [self._read_json(root / "chapters" / f"{_component_id(chapter_id)}.json") for chapter_id in manifest.get("chapterOrder", [])]
        characters = [self._read_json(root / "characters" / f"{_component_id(character_id)}.json") for character_id in manifest.get("characterOrder", [])]
        scenes = [self._read_json(root / "scenes" / f"{_component_id(scene_id)}.json") for scene_id in manifest.get("sceneOrder", [])]
        fragment_ids = [fragment["id"] for chapter in chapters for fragment in chapter.get("fragments", [])]
        scripts = {fragment_id: self._read_json(root / "scripts" / f"{_component_id(fragment_id)}.json") for fragment_id in fragment_ids}
        timelines = {
            fragment_id: self._read_json(root / "timelines" / f"{_component_id(fragment_id)}.json")
            for fragment_id in fragment_ids
            if (root / "timelines" / f"{_component_id(fragment_id)}.json").is_file()
        }
        assets = self._read_json(root / "assets" / "index.json")
        asset_directory_uri: str | None = None
        for asset in assets:
            path_value = str(asset.get("path", ""))
            if path_value.startswith("builtin/"):
                asset["uri"] = f"./assets/{Path(path_value).name}"
            elif path_value:
                if asset_directory_uri is None:
                    asset_directory_uri = self.asset_dir.as_uri().rstrip("/")
                asset["uri"] = f"{asset_directory_uri}/{quote(Path(path_value).name, safe='')}"
        locale_config = manifest.get("locale", {"default": "zh-CN", "languages": ["zh-CN"]})
        if not isinstance(locale_config, dict) or not isinstance(locale_config.get("languages"), list):
            locale_config = {"default": locale_config.get("default", "zh-CN") if isinstance(locale_config, dict) else "zh-CN", "languages": ["zh-CN"]}
        translations: dict[str, Any] = {}
        for language in locale_config["languages"]:
            data = self._read_json(root / "locales" / _language_file_name(language), default={})
            translations[str(language)] = _translation_table(data)
        project = {
            "version": PROJECT_VERSION,
            "meta": manifest["meta"],
            "characters": characters,
            "scenes": scenes,
            "sceneGroups": manifest.get("sceneGroups", []),
            "chapters": chapters,
            "activeFragmentId": manifest["activeFragmentId"],
            "scripts": scripts,
            "timelines": timelines,
            "assets": assets,
            "variables": manifest.get("variables", {}),
            "variableDefinitions": manifest.get("variableDefinitions", {}),
            "settings": self._read_json(root / "settings" / "editor.json", default={"textSpeed": 35, "autoSave": True, "skipRead": True}),
            "locale": locale_config,
            "translations": translations,
            "ui": self._read_json(root / "ui" / "theme.json", default={"theme": "slide-light", "dialogueStyle": "glass"}),
            "productionMemory": self._read_json(root / ".slide" / "agent" / "memory.json", default=default_production_memory()),
        }
        return self._migrate(project, copy_project=False)

    def _load_legacy_and_upgrade(self) -> dict[str, Any]:
        legacy_path = self.project_path
        project = self._migrate(self._read_json(legacy_path))
        self._validate(project)
        self._backup_legacy(legacy_path)
        old_asset_dir = legacy_path.parent / f"{legacy_path.stem}.assets"
        self.project_path = self._upgrade_destination(legacy_path)
        if old_asset_dir.is_dir():
            self.asset_dir.mkdir(parents=True, exist_ok=True)
            for source in old_asset_dir.iterdir():
                if source.is_file() and not (self.asset_dir / source.name).exists():
                    shutil.copy2(source, self.asset_dir / source.name)
        self.save(project)
        return self._load_v3()

    def _upgrade_destination(self, legacy_path: Path) -> Path:
        stem = legacy_path.name.removesuffix(".slide.json").removesuffix(".slide")
        return legacy_path.parent / _safe_name(stem, "slide-project") / MANIFEST_NAME

    @staticmethod
    def _backup_legacy(legacy_path: Path) -> Path | None:
        if not legacy_path.is_file():
            return None
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        backup = legacy_path.with_name(f"{legacy_path.name}.v2-backup-{timestamp}")
        shutil.copy2(legacy_path, backup)
        return backup

    def _load_recovery(self) -> dict[str, Any] | None:
        try:
            project = self._migrate(self._read_json(self.recovery_path))
            self._validate(project)
            return project
        except (OSError, json.JSONDecodeError, ValueError, KeyError):
            return None

    @staticmethod
    def _read_json(path: Path, default: Any = None) -> Any:
        if default is not None and not path.exists():
            return deepcopy(default)
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)

    @staticmethod
    def _write_json_atomic(path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        encoded = json.dumps(value, ensure_ascii=False, indent=2)
        fd, temporary_name = tempfile.mkstemp(prefix=".slide-", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_name, path)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)

    @staticmethod
    def _remove_stale_json(folder: Path, expected: set[Path], save_started_at: float) -> None:
        """删除本次保存载荷中已不存在的分片文件。

        仅删除保存开始前就存在的旧文件：保存期间被并发写入器创建或更新的
        文件会被跳过，避免竞态下误删仍被引用的分片。
        """
        if not folder.exists():
            return
        for path in folder.glob("*.json"):
            if path in expected:
                continue
            try:
                modified_at = path.stat().st_mtime
            except OSError:
                continue
            if modified_at > save_started_at:
                continue
            path.unlink()

    @staticmethod
    def _migrate(project: dict[str, Any], *, copy_project: bool = True) -> dict[str, Any]:
        result = deepcopy(project) if copy_project else project
        if int(result.get("version", 1)) < 2 or "scripts" not in result:
            active = result.get("activeFragmentId", "opening")
            result["scripts"] = {active: result.pop("blocks", [])}
            for chapter in result.get("chapters", []):
                for fragment in chapter.get("fragments", []):
                    result["scripts"].setdefault(fragment["id"], [])
        if not isinstance(result.get("variables"), dict):
            result["variables"] = {}
        if not isinstance(result.get("variableDefinitions"), dict):
            result["variableDefinitions"] = {}
        definitions = result["variableDefinitions"]
        for name, value in result["variables"].items():
            if name not in definitions:
                variable_type = "boolean" if isinstance(value, bool) else "number" if isinstance(value, (int, float)) else "string"
                definitions[name] = {
                    "type": variable_type,
                    "scope": "project",
                    "persistence": "slot",
                }
        settings = result.setdefault("settings", {})
        settings.setdefault("textSpeed", 35)
        settings.setdefault("autoSave", True)
        settings.setdefault("skipRead", True)
        settings.setdefault("autoPlay", False)
        settings.setdefault("autoPlayDelay", 1.5)
        settings.setdefault("fastForward", True)
        settings.setdefault("narrativeMap", {"positions": {}})
        timelines = result.get("timelines")
        if not isinstance(timelines, dict):
            timelines = {}
            result["timelines"] = timelines
        valid_fragments = {fragment.get("id") for chapter in result.get("chapters", []) for fragment in chapter.get("fragments", [])}
        result["timelines"] = {
            str(fragment_id): timeline for fragment_id, timeline in timelines.items()
            if fragment_id in valid_fragments and isinstance(timeline, dict)
        }
        result.setdefault("meta", {}).setdefault("gameVersion", "1.0.0")
        if not isinstance(result.get("locale"), dict):
            result["locale"] = {"default": "zh-CN", "languages": ["zh-CN"]}
        locale = result["locale"]
        locale.setdefault("default", "zh-CN")
        if not isinstance(locale.get("languages"), list):
            locale["languages"] = [locale["default"]]
        if locale["default"] not in locale["languages"]:
            locale["languages"].insert(0, locale["default"])
        raw_translations = result.get("translations")
        result["translations"] = {
            str(language): _translation_table(table)
            for language, table in (raw_translations.items() if isinstance(raw_translations, dict) else [])
            if isinstance(table, dict)
        }
        result.setdefault("ui", {"theme": "slide-light", "dialogueStyle": "glass"})
        memory = result.get("productionMemory")
        if not isinstance(memory, dict):
            memory = default_production_memory()
            result["productionMemory"] = memory
        memory["version"] = 1
        memory.setdefault("world", "")
        for section in ("characterRules", "styleRules", "facts", "restrictions"):
            if not isinstance(memory.get(section), list):
                memory[section] = []
            normalized_entries = []
            for entry in memory[section]:
                if not isinstance(entry, dict):
                    continue
                normalized = deepcopy(entry)
                normalized.setdefault("id", f"memory-{uuid.uuid4().hex[:10]}")
                normalized["title"] = str(normalized.get("title", "")).strip()
                normalized["content"] = str(normalized.get("content", "")).strip()
                normalized["pinned"] = bool(normalized.get("pinned", False))
                normalized["references"] = normalized.get("references") if isinstance(normalized.get("references"), list) else []
                normalized.setdefault("updatedAt", "")
                normalized_entries.append(normalized)
            memory[section] = normalized_entries
        memory.setdefault("updatedAt", "")
        result["version"] = PROJECT_VERSION
        for chapter in result.get("chapters", []):
            chapter["disabled"] = False if chapter.get("entry") else bool(chapter.get("disabled", False))
        for character in result.get("characters", []):
            character.setdefault("portraits", {})
        if not result.get("scenes"):
            result["scenes"] = [
                {"id": f"scene-{asset['id']}", "name": asset.get("name", "场景"), "layers": [{"id": f"layer-{asset['id']}", "name": "背景", "assetId": asset["id"], "opacity": 1, "blendMode": "normal", "offsetX": 0, "offsetY": 0, "scale": 1, "distance": 1, "visible": True}]}
                for asset in result.get("assets", []) if asset.get("kind") == "scene"
            ]
        result.setdefault("sceneGroups", [])
        for asset in result.get("assets", []):
            asset.setdefault("forceBundle", False)
            path_value = str(asset.get("path", "")).replace("\\", "/")
            if path_value in {"assets/lake.jpg", "assets/mountain.jpg"}:
                filename = Path(path_value).name
                asset["path"] = f"builtin/{filename}"
                asset["uri"] = f"./assets/{filename}"
        asset_ids_by_name = {asset.get("name"): asset.get("id") for asset in result.get("assets", [])}
        fragment_ids_by_name = {fragment.get("name"): fragment.get("id") for chapter in result.get("chapters", []) for fragment in chapter.get("fragments", [])}
        scenes_by_name: dict[str, tuple[int, dict[str, Any]]] = {}
        scenes_by_asset: dict[str, tuple[int, dict[str, Any]]] = {}
        for scene_index, scene in enumerate(result.get("scenes", [])):
            scene_name = scene.get("name")
            if isinstance(scene_name, str):
                scenes_by_name.setdefault(scene_name, (scene_index, scene))
            layers = scene.get("layers")
            last_layer = layers[-1] if isinstance(layers, list) and layers and isinstance(layers[-1], dict) else None
            asset_id = last_layer.get("assetId") if last_layer else None
            if isinstance(asset_id, str):
                scenes_by_asset.setdefault(asset_id, (scene_index, scene))
        for blocks in result.get("scripts", {}).values():
            for block in blocks:
                block.setdefault("version", 1)
                if block.get("type") == "scene" and not block.get("assetId"):
                    block["assetId"] = asset_ids_by_name.get(block.get("title"))
                if block.get("type") == "scene":
                    block.setdefault("layers", [])
                    if not block.get("sceneId"):
                        candidates = []
                        if isinstance(block.get("title"), str) and block["title"] in scenes_by_name:
                            candidates.append(scenes_by_name[block["title"]])
                        if isinstance(block.get("assetId"), str) and block["assetId"] in scenes_by_asset:
                            candidates.append(scenes_by_asset[block["assetId"]])
                        if candidates:
                            block["sceneId"] = min(candidates, key=lambda candidate: candidate[0])[1]["id"]
                if block.get("type") == "sound":
                    block.setdefault("channel", "bgm")
                    block.setdefault("action", "play")
                    block.setdefault("fadeDuration", 0)
                if block.get("type") == "branch":
                    for option in block.get("options", []):
                        option["target"] = fragment_ids_by_name.get(option.get("target"), option.get("target"))
        return result

    @staticmethod
    def _validate(project: Any) -> None:
        if not isinstance(project, dict):
            raise ValueError("Project must be an object")
        if not isinstance(project.get("meta"), dict) or not str(project["meta"].get("name", "")).strip():
            raise ValueError("Project metadata and name are required")
        if not isinstance(project.get("chapters"), list) or not project["chapters"]:
            raise ValueError("Project must contain chapters")
        if not isinstance(project.get("scripts"), dict):
            raise ValueError("Project scripts must be an object")
        fragment_ids = {fragment.get("id") for chapter in project["chapters"] for fragment in chapter.get("fragments", [])}
        if not fragment_ids:
            raise ValueError("Project must contain at least one fragment")
        if project.get("activeFragmentId") not in fragment_ids:
            raise ValueError("Active fragment does not exist")
        if not all(isinstance(project["scripts"].get(fragment_id, []), list) for fragment_id in fragment_ids):
            raise ValueError("Every fragment script must be a list")
        timelines = project.get("timelines", {})
        if not isinstance(timelines, dict) or any(fragment_id not in fragment_ids or not isinstance(timeline, dict) for fragment_id, timeline in timelines.items()):
            raise ValueError("Project timelines are invalid")
        memory = project.get("productionMemory", default_production_memory())
        if not isinstance(memory, dict) or int(memory.get("version", 0)) != 1 or not isinstance(memory.get("world", ""), str):
            raise ValueError("Production memory is invalid")
        for section in ("characterRules", "styleRules", "facts", "restrictions"):
            entries = memory.get(section)
            if not isinstance(entries, list) or any(not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not isinstance(entry.get("title"), str) or not isinstance(entry.get("content"), str) or not isinstance(entry.get("references", []), list) for entry in entries):
                raise ValueError(f"Production memory section is invalid: {section}")
        component_ids = [chapter.get("id") for chapter in project["chapters"]]
        component_ids += list(fragment_ids)
        component_ids += [character.get("id") for character in project.get("characters", [])]
        component_ids += [scene.get("id") for scene in project.get("scenes", [])]
        for identifier in component_ids:
            _component_id(identifier)
