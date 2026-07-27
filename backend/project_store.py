from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import tempfile
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_VERSION = 3
MANIFEST_NAME = "project.hikari.json"
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
        {"id": "b4", "type": "dialogue", "speaker": "林澄", "text": "你果然还是来了。", "expression": "浅笑", "voice": "lc_001.ogg"},
        {"id": "b5", "type": "dialogue", "speaker": "苏芮", "text": "因为有人在信里说，错过今天就再也见不到这片星海了。", "expression": "平静", "voice": "sr_014.ogg"},
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
        "ui": {"theme": "hikari-light", "dialogueStyle": "glass"},
    }


class ProjectStore:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir.resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        legacy = self.data_dir / "star-sea-echo.hikari.json"
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
        return self.project_root / ".hikari" / "recovery.json"

    @property
    def command_history_path(self) -> Path:
        return self.project_root / ".hikari" / "history" / "commands.json"

    @property
    def recent_projects_path(self) -> Path:
        return self.data_dir / ".hikari-studio" / "recent-projects.json"

    @property
    def runtime_storage_dir(self) -> Path:
        folder = self.data_dir / ".hikari-studio" / "runtime-storage"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

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
            fd, temporary_name = tempfile.mkstemp(prefix=".hikari-runtime-", suffix=".tmp", dir=path.parent)
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
        return {"ok": True, "path": str(self.command_history_path), "bytes": self.command_history_path.stat().st_size, "commandCount": len(value["undo"]) + len(value["redo"])}

    @staticmethod
    def _validate_command_history(history: Any) -> dict[str, Any]:
        if not isinstance(history, dict) or history.get("version") != 1:
            raise ValueError("Unsupported Command history version")
        if not isinstance(history.get("projectId"), str) or not history["projectId"]:
            raise ValueError("Command history project id is invalid")
        undo = history.get("undo")
        redo = history.get("redo")
        if not isinstance(undo, list) or not isinstance(redo, list) or len(undo) > 50 or len(redo) > 50:
            raise ValueError("Command history stack is invalid")
        for command in [*undo, *redo]:
            if not isinstance(command, dict) or not isinstance(command.get("id"), str) or not command["id"].startswith("command-"):
                raise ValueError("Command history entry is invalid")
            if not isinstance(command.get("label"), str) or not isinstance(command.get("timestamp"), (int, float)):
                raise ValueError("Command history metadata is invalid")
            if not isinstance(command.get("before"), dict) or not isinstance(command.get("after"), dict):
                raise ValueError("Command history snapshot is invalid")
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

    def open(self, path: Path) -> dict[str, Any]:
        resolved = path.expanduser().resolve()
        if resolved.is_dir():
            resolved = resolved / MANIFEST_NAME
        is_legacy = resolved.is_file() and resolved.name.endswith(".hikari.json") and resolved.name != MANIFEST_NAME
        if not resolved.is_file() or (resolved.name != MANIFEST_NAME and not is_legacy):
            raise ValueError("请选择 project.hikari.json 或旧版 .hikari.json 项目文件")
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

    def save(self, project: dict[str, Any]) -> dict[str, Any]:
        project = self._migrate(project)
        self._validate(project)
        payload = deepcopy(project)
        payload["version"] = PROJECT_VERSION
        payload["meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
        if self.project_path.name != MANIFEST_NAME:
            self._backup_legacy(self.project_path)
            self.project_path = self._upgrade_destination(self.project_path)

        with self._lock:
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
            expected.update({root / "characters" / f"{_component_id(character['id'])}.json": character for character in payload.get("characters", [])})
            expected.update({root / "scenes" / f"{_component_id(scene['id'])}.json": scene for scene in payload.get("scenes", [])})
            assets = [{key: value for key, value in asset.items() if key != "uri"} for asset in payload.get("assets", [])]
            expected[root / "assets" / "index.json"] = assets
            expected[root / "locales" / "zh-CN.json"] = payload.get("translations", {})
            expected[root / "settings" / "editor.json"] = payload.get("settings", {})
            expected[root / "ui" / "theme.json"] = payload.get("ui", {"theme": "hikari-light", "dialogueStyle": "glass"})

            for path, value in expected.items():
                if path != self.project_path:
                    self._write_json_atomic(path, value)
            self._write_json_atomic(self.project_path, manifest)
            self._remove_stale_json(root / "chapters", {path for path in expected if path.parent == root / "chapters"})
            self._remove_stale_json(root / "scripts", {path for path in expected if path.parent == root / "scripts"})
            self._remove_stale_json(root / "characters", {path for path in expected if path.parent == root / "characters"})
            self._remove_stale_json(root / "scenes", {path for path in expected if path.parent == root / "scenes"})
            self._write_json_atomic(self.recovery_path, payload)

        self._remember_project(payload)

        return {"ok": True, "path": str(self.project_path), "bytes": sum(path.stat().st_size for path in expected if path.exists()), "version": PROJECT_VERSION}

    def import_assets(self, source_paths: list[str], audio_category: str | None = None) -> list[dict[str, Any]]:
        imported: list[dict[str, Any]] = []
        for source_text in source_paths:
            source = Path(source_text).expanduser().resolve()
            if not source.is_file():
                continue
            extension = source.suffix.lower()
            kind = "image" if extension in IMAGE_EXTENSIONS else "audio" if extension in AUDIO_EXTENSIONS else "video" if extension in VIDEO_EXTENSIONS else "font" if extension in FONT_EXTENSIONS else "file"
            destination = self.asset_dir / source.name
            counter = 2
            while destination.exists() and destination.read_bytes() != source.read_bytes():
                destination = self.asset_dir / f"{source.stem}-{counter}{source.suffix}"
                counter += 1
            if not destination.exists():
                shutil.copy2(source, destination)
            item = {
                "id": new_id("asset"), "kind": kind, "name": destination.stem,
                "path": destination.name, "uri": destination.as_uri(), "size": destination.stat().st_size,
                "contentHash": _sha256(destination),
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

        candidates = sorted(
            (path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_ASSET_EXTENSIONS),
            key=lambda path: str(path).casefold(),
        )
        hashes: dict[Path, str] = {}

        def candidate_hash(path: Path) -> str:
            if path not in hashes:
                hashes[path] = _sha256(path)
            return hashes[path]

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
                elif expected_size is not None and candidate_extension == expected_extension and candidate.stat().st_size == int(expected_size):
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
        assets = self._read_json(root / "assets" / "index.json")
        for asset in assets:
            path_value = str(asset.get("path", ""))
            if path_value.startswith("builtin/"):
                asset["uri"] = f"./assets/{Path(path_value).name}"
            elif path_value:
                asset["uri"] = (self.asset_dir / Path(path_value).name).as_uri()
        project = {
            "version": PROJECT_VERSION,
            "meta": manifest["meta"],
            "characters": characters,
            "scenes": scenes,
            "sceneGroups": manifest.get("sceneGroups", []),
            "chapters": chapters,
            "activeFragmentId": manifest["activeFragmentId"],
            "scripts": scripts,
            "assets": assets,
            "variables": manifest.get("variables", {}),
            "variableDefinitions": manifest.get("variableDefinitions", {}),
            "settings": self._read_json(root / "settings" / "editor.json", default={"textSpeed": 35, "autoSave": True, "skipRead": True}),
            "locale": manifest.get("locale", {"default": "zh-CN", "languages": ["zh-CN"]}),
            "translations": self._read_json(root / "locales" / "zh-CN.json", default={}),
            "ui": self._read_json(root / "ui" / "theme.json", default={"theme": "hikari-light", "dialogueStyle": "glass"}),
        }
        return self._migrate(project)

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
        stem = legacy_path.name.removesuffix(".hikari.json")
        return legacy_path.parent / _safe_name(stem, "hikari-project") / MANIFEST_NAME

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
        fd, temporary_name = tempfile.mkstemp(prefix=".hikari-", suffix=".tmp", dir=path.parent)
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
    def _remove_stale_json(folder: Path, expected: set[Path]) -> None:
        if not folder.exists():
            return
        for path in folder.glob("*.json"):
            if path not in expected:
                path.unlink()

    @staticmethod
    def _migrate(project: dict[str, Any]) -> dict[str, Any]:
        result = deepcopy(project)
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
        result.setdefault("meta", {}).setdefault("gameVersion", "1.0.0")
        if not isinstance(result.get("locale"), dict):
            result["locale"] = {"default": "zh-CN", "languages": ["zh-CN"]}
        locale = result["locale"]
        locale.setdefault("default", "zh-CN")
        if not isinstance(locale.get("languages"), list):
            locale["languages"] = [locale["default"]]
        if locale["default"] not in locale["languages"]:
            locale["languages"].insert(0, locale["default"])
        result.setdefault("ui", {"theme": "hikari-light", "dialogueStyle": "glass"})
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
        for blocks in result.get("scripts", {}).values():
            for block in blocks:
                block.setdefault("version", 1)
                if block.get("type") == "scene" and not block.get("assetId"):
                    block["assetId"] = asset_ids_by_name.get(block.get("title"))
                if block.get("type") == "scene":
                    block.setdefault("layers", [])
                    if not block.get("sceneId"):
                        matching_scene = next((scene for scene in result["scenes"] if scene.get("name") == block.get("title") or scene.get("layers", [{}])[-1].get("assetId") == block.get("assetId")), None)
                        if matching_scene:
                            block["sceneId"] = matching_scene["id"]
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
        component_ids = [chapter.get("id") for chapter in project["chapters"]]
        component_ids += list(fragment_ids)
        component_ids += [character.get("id") for character in project.get("characters", [])]
        component_ids += [scene.get("id") for scene in project.get("scenes", [])]
        for identifier in component_ids:
            _component_id(identifier)
