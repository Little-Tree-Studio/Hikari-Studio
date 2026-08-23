from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


LOGGER = logging.getLogger(__name__)
WORKER_ENV = "HIKARI_ASSET_WORKER"
WORKER_TIMEOUT_SECONDS = 300
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


def _worker_name() -> str:
    return "hikari-asset-worker.exe" if os.name == "nt" else "hikari-asset-worker"


def find_asset_worker(resource_root: Path | None = None) -> Path | None:
    configured = os.getenv(WORKER_ENV)
    candidates = [Path(configured).expanduser()] if configured else []
    if resource_root is not None:
        candidates.append(resource_root / "native" / _worker_name())
    repository_root = Path(__file__).resolve().parents[1]
    candidates.extend([
        repository_root / "native" / _worker_name(),
        repository_root / "target" / "release" / _worker_name(),
        repository_root / "target" / "debug" / _worker_name(),
    ])
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved.is_file():
            return resolved
    return None


def scan_assets(root: Path, extensions: Iterable[str], *, hash_files: bool, resource_root: Path | None = None) -> list[NativeAssetFile] | None:
    worker = find_asset_worker(resource_root)
    if worker is None:
        return None
    resolved_root = root.resolve()
    normalized_extensions = {str(extension).lower() for extension in extensions}
    request = {
        "root": str(resolved_root),
        "extensions": sorted(normalized_extensions),
        "hashFiles": hash_files,
    }
    try:
        completed = subprocess.run(
            [str(worker), "scan"],
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
        if response.get("version") != 1 or not isinstance(response.get("files"), list):
            raise ValueError("unsupported worker response")
        files: list[NativeAssetFile] = []
        for item in response["files"]:
            path = Path(item["path"]).resolve()
            extension = str(item["extension"]).lower()
            digest = str(item["sha256"]).lower() if item.get("sha256") else None
            if not path.is_relative_to(resolved_root) or extension not in normalized_extensions:
                raise ValueError("worker returned an asset outside the scan scope")
            if digest is not None and re.fullmatch(r"[0-9a-f]{64}", digest) is None:
                raise ValueError("worker returned an invalid SHA-256 digest")
            files.append(NativeAssetFile(
                path=path,
                name=str(item["name"]),
                stem=str(item["stem"]),
                extension=extension,
                size=max(0, int(item["size"])),
                modified_ns=int(item["modifiedNs"]) if item.get("modifiedNs") is not None else None,
                sha256=digest,
            ))
        return files
    except (OSError, subprocess.SubprocessError, UnicodeError, json.JSONDecodeError, KeyError, TypeError, ValueError, RuntimeError):
        LOGGER.warning("Rust asset worker failed; using Python fallback", exc_info=True)
        return None
