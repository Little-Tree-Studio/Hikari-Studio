from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


LOGGER = logging.getLogger(__name__)
WORKER_ENV = "SLIDE_ASSET_WORKER"
WORKER_TIMEOUT_SECONDS = 300
PROTOCOL_VERSION = 2
MAX_INSPECT_PATHS = 100_000
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


@dataclass(frozen=True)
class NativeAssetFile:
    path: Path
    name: str
    stem: str
    extension: str
    size: int
    modified_ns: int | None
    sha256: str | None


@dataclass(frozen=True)
class NativeAssetWarning:
    code: str
    path: Path | None
    message: str


@dataclass(frozen=True)
class NativeAssetStats:
    discovered_files: int
    inspected_files: int
    hashed_files: int
    cache_hits: int


@dataclass(frozen=True)
class NativeAssetResult:
    files: list[NativeAssetFile]
    warnings: list[NativeAssetWarning]
    stats: NativeAssetStats


def _worker_name() -> str:
    return "slide-asset-worker.exe" if os.name == "nt" else "slide-asset-worker"


def find_asset_worker(resource_root: Path | None = None) -> Path | None:
    configured = os.getenv(WORKER_ENV)
    priority_candidates = [Path(configured).expanduser()] if configured else []
    if resource_root is not None:
        priority_candidates.append(resource_root / "native" / _worker_name())
    for candidate in priority_candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved.is_file():
            return resolved

    repository_root = Path(__file__).resolve().parents[1]
    development_candidates = [
        repository_root / "native" / _worker_name(),
        repository_root / "target" / "release" / _worker_name(),
        repository_root / "target" / "debug" / _worker_name(),
    ]
    available: list[tuple[int, Path]] = []
    for candidate in development_candidates:
        try:
            resolved = candidate.resolve()
            modified_ns = resolved.stat().st_mtime_ns
        except OSError:
            continue
        if resolved.is_file():
            available.append((modified_ns, resolved))
    return max(available, default=(0, None), key=lambda item: item[0])[1]


def _run_worker(command: str, request: dict[str, Any], resource_root: Path | None) -> dict[str, Any] | None:
    worker = find_asset_worker(resource_root)
    if worker is None:
        return None
    try:
        completed = subprocess.run(
            [str(worker), command],
            input=json.dumps(request, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
            timeout=WORKER_TIMEOUT_SECONDS,
            check=False,
            creationflags=CREATE_NO_WINDOW,
        )
        if completed.returncode:
            raise RuntimeError(completed.stderr.strip() or f"worker exited with code {completed.returncode}")
        response = json.loads(completed.stdout)
        if response.get("version") != PROTOCOL_VERSION or not isinstance(response.get("files"), list):
            raise ValueError("unsupported worker response")
        if not isinstance(response.get("warnings"), list) or not isinstance(response.get("stats"), dict):
            raise ValueError("incomplete worker response")
        return response
    except (OSError, subprocess.SubprocessError, UnicodeError, json.JSONDecodeError, TypeError, ValueError, RuntimeError):
        LOGGER.warning("Rust asset worker failed; using Python fallback", exc_info=True)
        return None


def _parse_response(response: dict[str, Any], allowed_paths: set[Path] | None = None, root: Path | None = None, extensions: set[str] | None = None) -> NativeAssetResult:
    files: list[NativeAssetFile] = []
    for item in response["files"]:
        path = Path(item["path"]).resolve()
        extension = str(item["extension"]).lower()
        digest = str(item["sha256"]).lower() if item.get("sha256") else None
        if root is not None and not path.is_relative_to(root):
            raise ValueError("worker returned an asset outside the scan scope")
        if allowed_paths is not None and path not in allowed_paths:
            raise ValueError("worker returned an unrequested asset")
        if extensions is not None and extension not in extensions:
            raise ValueError("worker returned an unsupported asset extension")
        if digest is not None and re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise ValueError("worker returned an invalid SHA-256 digest")
        size = int(item["size"])
        modified_ns = int(item["modifiedNs"]) if item.get("modifiedNs") is not None else None
        if size < 0 or modified_ns is not None and modified_ns < 0:
            raise ValueError("worker returned invalid file metadata")
        files.append(NativeAssetFile(
            path=path,
            name=str(item["name"]),
            stem=str(item["stem"]),
            extension=extension,
            size=size,
            modified_ns=modified_ns,
            sha256=digest,
        ))

    warnings: list[NativeAssetWarning] = []
    for item in response["warnings"]:
        warning_path = Path(item["path"]).resolve() if item.get("path") else None
        warnings.append(NativeAssetWarning(
            code=str(item["code"]),
            path=warning_path,
            message=str(item["message"]),
        ))
    stats = response["stats"]
    parsed_stats = NativeAssetStats(
        discovered_files=max(0, int(stats.get("discoveredFiles", 0))),
        inspected_files=max(0, int(stats.get("inspectedFiles", 0))),
        hashed_files=max(0, int(stats.get("hashedFiles", 0))),
        cache_hits=max(0, int(stats.get("cacheHits", 0))),
    )
    if parsed_stats.inspected_files != len(files) or parsed_stats.inspected_files > parsed_stats.discovered_files:
        raise ValueError("worker returned inconsistent file statistics")
    return NativeAssetResult(files=files, warnings=warnings, stats=parsed_stats)


def scan_assets(
    root: Path,
    extensions: Iterable[str],
    *,
    hash_files: bool,
    cache_path: Path | None = None,
    max_threads: int | None = None,
    resource_root: Path | None = None,
) -> NativeAssetResult | None:
    resolved_root = root.resolve()
    normalized_extensions = {str(extension).lower() for extension in extensions}
    request = {
        "root": str(resolved_root),
        "extensions": sorted(normalized_extensions),
        "hashFiles": hash_files,
        "cachePath": str(cache_path.resolve()) if cache_path else None,
        "maxThreads": max_threads,
    }
    response = _run_worker("scan", request, resource_root)
    if response is None:
        return None
    try:
        return _parse_response(response, root=resolved_root, extensions=normalized_extensions)
    except (KeyError, TypeError, ValueError, OSError):
        LOGGER.warning("Rust asset worker returned invalid scan data; using Python fallback", exc_info=True)
        return None


def inspect_assets(
    paths: Iterable[Path],
    *,
    hash_files: bool,
    cache_path: Path | None = None,
    max_threads: int | None = None,
    resource_root: Path | None = None,
) -> NativeAssetResult | None:
    resolved_paths = list(dict.fromkeys(Path(path).resolve() for path in paths))
    if not resolved_paths:
        return NativeAssetResult(files=[], warnings=[], stats=NativeAssetStats(0, 0, 0, 0))
    if len(resolved_paths) > MAX_INSPECT_PATHS:
        raise ValueError(f"Cannot inspect more than {MAX_INSPECT_PATHS} asset paths")
    request = {
        "paths": [str(path) for path in resolved_paths],
        "hashFiles": hash_files,
        "cachePath": str(cache_path.resolve()) if cache_path else None,
        "maxThreads": max_threads,
    }
    response = _run_worker("inspect", request, resource_root)
    if response is None:
        return None
    try:
        return _parse_response(response, allowed_paths=set(resolved_paths))
    except (KeyError, TypeError, ValueError, OSError):
        LOGGER.warning("Rust asset worker returned invalid inspection data; using Python fallback", exc_info=True)
        return None
