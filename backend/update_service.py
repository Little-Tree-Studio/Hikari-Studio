from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .version import APP_VERSION, GITHUB_RELEASES_API, UPDATE_CHANNEL


LOGGER = logging.getLogger(__name__)
UPDATE_STATE_VERSION = 1
CHECK_INTERVAL_SECONDS = 24 * 60 * 60
MAX_INSTALLER_BYTES = 1024 * 1024 * 1024
VERSION_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")


def _utc_iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def _version_key(value: str) -> tuple[int, int, int, int, tuple[tuple[int, int | str], ...]]:
    match = VERSION_PATTERN.fullmatch(value.strip())
    if not match:
        raise ValueError(f"Invalid application version: {value}")
    major, minor, patch = (int(match.group(index)) for index in range(1, 4))
    prerelease = match.group(4)
    if not prerelease:
        return major, minor, patch, 1, ()
    parts: list[tuple[int, int | str]] = []
    for part in prerelease.split("."):
        parts.append((0, int(part)) if part.isdigit() else (1, part.lower()))
    return major, minor, patch, 0, tuple(parts)


def is_newer_version(candidate: str, current: str = APP_VERSION) -> bool:
    return _version_key(candidate) > _version_key(current)


def normalize_manifest(value: dict[str, Any]) -> dict[str, Any]:
    if int(value.get("schemaVersion", 0)) != 1:
        raise ValueError("Unsupported update manifest version")
    version = str(value.get("version") or "").lstrip("v")
    _version_key(version)
    channel = str(value.get("channel") or ("beta" if "-" in version else "stable"))
    if channel not in {"stable", "beta"}:
        raise ValueError("Invalid update channel")
    installer = value.get("installer")
    if not isinstance(installer, dict):
        raise ValueError("Update manifest is missing the Windows installer")
    url = str(installer.get("url") or "").strip()
    sha256 = str(installer.get("sha256") or "").strip().lower()
    size = int(installer.get("size") or 0)
    if not url.startswith("https://"):
        raise ValueError("Update installer URL must use HTTPS")
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("Update installer SHA-256 is invalid")
    if size <= 0 or size > MAX_INSTALLER_BYTES:
        raise ValueError("Update installer size is invalid")
    return {
        "schemaVersion": 1,
        "version": version,
        "channel": channel,
        "publishedAt": str(value.get("publishedAt") or ""),
        "notes": str(value.get("notes") or ""),
        "releaseUrl": str(value.get("releaseUrl") or ""),
        "minimumVersion": str(value.get("minimumVersion") or "") or None,
        "installer": {"url": url, "sha256": sha256, "size": size},
    }


class UpdateService:
    def __init__(
        self,
        state_dir: Path,
        *,
        current_version: str = APP_VERSION,
        release_api: str = GITHUB_RELEASES_API,
        clock: Callable[[], float] = time.time,
        json_fetcher: Callable[[str], Any] | None = None,
        downloader: Callable[[str, Path, int], None] | None = None,
        launcher: Callable[[Path], None] | None = None,
    ) -> None:
        self.state_dir = state_dir.resolve()
        self.current_version = current_version
        self.release_api = release_api
        self.clock = clock
        self.state_path = self.state_dir / "config" / "update-state.json"
        self.download_dir = self.state_dir / "updates" / "installers"
        self._json_fetcher = json_fetcher or self._fetch_json
        self._downloader = downloader or self._download
        self._launcher = launcher or self._launch_installer

    def status(self) -> dict[str, Any]:
        state = self._load_state()
        return self._public_status(state)

    def check(self, *, force: bool = False, channel: str = UPDATE_CHANNEL) -> dict[str, Any]:
        if channel not in {"stable", "beta"}:
            raise ValueError("Update channel must be stable or beta")
        state = self._load_state()
        now = self.clock()
        if not force and self._cache_is_fresh(state, channel, now):
            return self._public_status(state)
        try:
            manifest = self._discover_manifest(channel)
            available = manifest is not None and is_newer_version(manifest["version"], self.current_version)
            state = {
                "version": UPDATE_STATE_VERSION,
                "status": "available" if available else "up-to-date",
                "channel": channel,
                "currentVersion": self.current_version,
                "lastCheckedAtEpoch": now,
                "lastCheckedAt": _utc_iso(now),
                "nextCheckAt": _utc_iso(now + CHECK_INTERVAL_SECONDS),
                "manifest": manifest if available else None,
                "download": self._valid_download(state.get("download"), manifest),
                "error": None,
            }
        except Exception as exc:
            LOGGER.warning("Update check failed: %s", exc)
            state = {
                **state,
                "version": UPDATE_STATE_VERSION,
                "status": "error",
                "channel": channel,
                "currentVersion": self.current_version,
                "lastCheckedAtEpoch": now,
                "lastCheckedAt": _utc_iso(now),
                "nextCheckAt": _utc_iso(now + CHECK_INTERVAL_SECONDS),
                "error": {"code": "UPDATE_CHECK_FAILED", "message": str(exc)[:240]},
            }
        self._write_state(state)
        return self._public_status(state)

    def download(self) -> dict[str, Any]:
        state = self._load_state()
        manifest = state.get("manifest")
        if not isinstance(manifest, dict):
            raise ValueError("No update is available to download")
        manifest = normalize_manifest(manifest)
        installer = manifest["installer"]
        destination = self.download_dir / f"Slide-Studio-Setup-{manifest['version']}.exe"
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = destination.with_suffix(".exe.partial")
        partial.unlink(missing_ok=True)
        try:
            self._downloader(installer["url"], partial, installer["size"])
            self._verify_file(partial, installer["sha256"], installer["size"])
            os.replace(partial, destination)
        finally:
            partial.unlink(missing_ok=True)
        now = self.clock()
        state["download"] = {
            "version": manifest["version"],
            "path": str(destination),
            "sha256": installer["sha256"],
            "size": installer["size"],
            "downloadedAt": _utc_iso(now),
        }
        metadata_path = destination.with_suffix(".exe.json")
        metadata_path.write_text(json.dumps(state["download"], ensure_ascii=False, indent=2), encoding="utf-8")
        state["status"] = "downloaded"
        state["error"] = None
        self._write_state(state)
        self._retain_recent_installers(2)
        return self._public_status(state)

    def install_downloaded(self, *, confirmed: bool, version: str | None = None) -> dict[str, Any]:
        if not confirmed:
            return {"ok": False, "error": {"code": "UPDATE_CONFIRMATION_REQUIRED", "message": "安装更新前需要用户确认"}}
        state = self._load_state()
        download = state.get("download")
        manifest = state.get("manifest")
        if version and (not isinstance(download, dict) or download.get("version") != version):
            download = next((item for item in self.list_downloaded() if item["version"] == version), None)
            manifest = None
        if not isinstance(download, dict):
            raise ValueError("No verified installer is available")
        path = Path(str(download.get("path") or "")).resolve()
        expected_hash = str(download.get("sha256") or "")
        expected_size = int(download.get("size") or 0)
        if isinstance(manifest, dict) and manifest.get("version") == download.get("version"):
            normalized = normalize_manifest(manifest)
            expected_hash = normalized["installer"]["sha256"]
            expected_size = normalized["installer"]["size"]
        self._verify_file(path, expected_hash, expected_size)
        self._launcher(path)
        return {"ok": True, "version": str(download.get("version") or ""), "path": str(path)}

    def list_downloaded(self) -> list[dict[str, Any]]:
        if not self.download_dir.is_dir():
            return []
        result: list[dict[str, Any]] = []
        for path in self.download_dir.glob("Slide-Studio-Setup-*.exe"):
            version = path.stem.removeprefix("Slide-Studio-Setup-")
            try:
                stat = path.stat()
                metadata_path = path.with_suffix(".exe.json")
                metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.is_file() else {}
                if metadata.get("version") != version or metadata.get("path") != str(path.resolve()) or metadata.get("size") != stat.st_size or not re.fullmatch(r"[0-9a-f]{64}", str(metadata.get("sha256") or "")):
                    continue
                result.append({**metadata, "downloadedAt": str(metadata.get("downloadedAt") or _utc_iso(stat.st_mtime))})
            except OSError:
                continue
            except (ValueError, json.JSONDecodeError):
                continue
        return sorted(result, key=lambda item: item["downloadedAt"], reverse=True)

    def _discover_manifest(self, channel: str) -> dict[str, Any] | None:
        value = self._json_fetcher(self.release_api)
        if isinstance(value, dict) and value.get("schemaVersion") == 1:
            manifest = normalize_manifest(value)
            return manifest if channel == "beta" or manifest["channel"] == "stable" else None
        if not isinstance(value, list):
            raise ValueError("GitHub Releases returned an invalid response")
        candidates: list[dict[str, Any]] = []
        for release in value:
            if not isinstance(release, dict) or release.get("draft"):
                continue
            if channel == "stable" and release.get("prerelease"):
                continue
            assets = release.get("assets") if isinstance(release.get("assets"), list) else []
            manifest_asset = next((asset for asset in assets if isinstance(asset, dict) and asset.get("name") == "latest.json"), None)
            if not manifest_asset:
                continue
            manifest_url = str(manifest_asset.get("browser_download_url") or "")
            if not manifest_url.startswith("https://"):
                continue
            manifest = normalize_manifest(self._json_fetcher(manifest_url))
            if channel == "stable" and manifest["channel"] != "stable":
                continue
            candidates.append(manifest)
        return max(candidates, key=lambda item: _version_key(item["version"])) if candidates else None

    def _cache_is_fresh(self, state: dict[str, Any], channel: str, now: float) -> bool:
        checked = state.get("lastCheckedAtEpoch")
        return state.get("version") == UPDATE_STATE_VERSION and state.get("channel") == channel and isinstance(checked, (int, float)) and now - float(checked) < CHECK_INTERVAL_SECONDS

    def _valid_download(self, download: Any, manifest: dict[str, Any] | None) -> dict[str, Any] | None:
        if not isinstance(download, dict) or not isinstance(manifest, dict) or download.get("version") != manifest.get("version"):
            return None
        path = Path(str(download.get("path") or ""))
        return download if path.is_file() else None

    def _load_state(self) -> dict[str, Any]:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _write_state(self, value: dict[str, Any]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.state_path)

    def _public_status(self, state: dict[str, Any]) -> dict[str, Any]:
        download = state.get("download")
        return {
            "status": str(state.get("status") or "idle"),
            "channel": str(state.get("channel") or UPDATE_CHANNEL),
            "currentVersion": self.current_version,
            "lastCheckedAt": state.get("lastCheckedAt"),
            "nextCheckAt": state.get("nextCheckAt"),
            "manifest": state.get("manifest") if isinstance(state.get("manifest"), dict) else None,
            "download": {key: download.get(key) for key in ("version", "size", "downloadedAt")} if isinstance(download, dict) else None,
            "error": state.get("error") if isinstance(state.get("error"), dict) else None,
            "rollbackInstallers": [{key: item[key] for key in ("version", "size", "downloadedAt")} for item in self.list_downloaded()],
        }

    @staticmethod
    def _fetch_json(url: str) -> Any:
        request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": f"Slide-Studio/{APP_VERSION}"})
        with urllib.request.urlopen(request, timeout=15) as response:
            if int(response.headers.get("Content-Length") or 0) > 2_000_000:
                raise ValueError("Update metadata is too large")
            return json.loads(response.read(2_000_001).decode("utf-8"))

    @staticmethod
    def _download(url: str, destination: Path, expected_size: int) -> None:
        request = urllib.request.Request(url, headers={"Accept": "application/octet-stream", "User-Agent": f"Slide-Studio/{APP_VERSION}"})
        written = 0
        with urllib.request.urlopen(request, timeout=30) as response, destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > min(MAX_INSTALLER_BYTES, expected_size + 1024):
                    raise ValueError("Downloaded installer is larger than the manifest")
                handle.write(chunk)

    @staticmethod
    def _verify_file(path: Path, expected_hash: str, expected_size: int) -> None:
        if not path.is_file() or path.stat().st_size != expected_size:
            raise ValueError("Downloaded installer size does not match the manifest")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest().lower() != expected_hash.lower():
            raise ValueError("Downloaded installer SHA-256 verification failed")

    @staticmethod
    def _launch_installer(path: Path) -> None:
        subprocess.Popen([str(path), "/SILENT", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"], close_fds=True)

    def _retain_recent_installers(self, count: int) -> None:
        paths = sorted(self.download_dir.glob("Slide-Studio-Setup-*.exe"), key=lambda path: path.stat().st_mtime, reverse=True)
        for path in paths[count:]:
            try:
                path.unlink()
                path.with_suffix(".exe.json").unlink(missing_ok=True)
            except OSError:
                LOGGER.warning("Unable to remove old installer: %s", path)
