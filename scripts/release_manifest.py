from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_manifest(version: str, installer: Path, portable: Path, repository: str, tag: str, notes: str = "") -> dict[str, Any]:
    normalized_version = version.lstrip("v")
    release_base = f"https://github.com/{repository}/releases/download/{tag}"
    return {
        "schemaVersion": 1,
        "version": normalized_version,
        "channel": "beta" if "-" in normalized_version else "stable",
        "publishedAt": datetime.now(timezone.utc).isoformat(),
        "notes": notes or f"Slide Studio {normalized_version}. See the GitHub Release page for complete notes.",
        "releaseUrl": f"https://github.com/{repository}/releases/tag/{tag}",
        "minimumVersion": "0.3.0",
        "installer": {
            "url": f"{release_base}/{installer.name}",
            "sha256": sha256(installer),
            "size": installer.stat().st_size,
        },
        "portable": {
            "url": f"{release_base}/{portable.name}",
            "sha256": sha256(portable),
            "size": portable.stat().st_size,
        },
    }


def write_release_files(manifest: dict[str, Any], installer: Path, portable: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_dir.joinpath("latest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    checksums = f"{manifest['installer']['sha256']}  {installer.name}\n{manifest['portable']['sha256']}  {portable.name}\n"
    output_dir.joinpath("SHA256SUMS.txt").write_text(checksums, encoding="ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Slide Studio release metadata")
    parser.add_argument("--version", required=True)
    parser.add_argument("--installer", type=Path, required=True)
    parser.add_argument("--portable", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--notes", default="")
    args = parser.parse_args()
    manifest = create_manifest(args.version, args.installer.resolve(), args.portable.resolve(), args.repository, args.tag, args.notes)
    write_release_files(manifest, args.installer.resolve(), args.portable.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
