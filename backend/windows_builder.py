from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .exporters import build_web_game, safe_slug


class WindowsBuildPrerequisiteError(RuntimeError):
    pass


def _dotnet_has_sdk(dotnet: Path) -> bool:
    try:
        result = subprocess.run(
            [str(dotnet), "--list-sdks"],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
        return bool(result.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return False


def find_dotnet_sdk(workspace_root: Path, explicit: Path | None = None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    else:
        configured = os.getenv("HIKARI_DOTNET")
        if configured:
            candidates.append(Path(configured))
        candidates.append(workspace_root / ".tools" / "dotnet" / "dotnet.exe")
        discovered = shutil.which("dotnet")
        if discovered:
            candidates.append(Path(discovered))
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if resolved.is_file() and _dotnet_has_sdk(resolved):
            return resolved
    raise WindowsBuildPrerequisiteError(
        "未找到 .NET 8 SDK，且没有可用的预编译 Windows 启动器。请安装 .NET 8 SDK 或配置 HIKARI_DOTNET。"
    )


def build_launcher_distribution(
    workspace_root: Path,
    launcher_project: Path,
    launcher_dist: Path,
    dotnet_path: Path | None = None,
) -> Path:
    dotnet = find_dotnet_sdk(workspace_root, dotnet_path)
    launcher_dist.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hikari-launcher-") as temporary:
        publish_dir = Path(temporary) / "publish"
        command = [
            str(dotnet),
            "publish",
            str(launcher_project),
            "--configuration", "Release",
            "--runtime", "win-x64",
            "--self-contained", "true",
            "--output", str(publish_dir),
            "-p:DebugType=None",
            "-p:DebugSymbols=false",
        ]
        result = subprocess.run(command, cwd=workspace_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
        if result.returncode != 0:
            details = (result.stderr or result.stdout).strip()[-4000:]
            raise RuntimeError(f"Windows 启动器编译失败：{details}")
        executable = publish_dir / "Hikari.GameLauncher.exe"
        if not executable.is_file():
            raise RuntimeError("Windows 启动器编译完成，但没有生成可执行文件")
        if launcher_dist.exists():
            shutil.rmtree(launcher_dist)
        shutil.copytree(publish_dir, launcher_dist)
    return launcher_dist


def build_windows_game(
    project: dict[str, Any],
    output_dir: Path,
    project_path: Path,
    builtin_assets: Path,
    custom_assets: Path,
    runtime_dist: Path,
    workspace_root: Path,
    launcher_project: Path,
    launcher_dist: Path,
    dotnet_path: Path | None = None,
) -> Path:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not (launcher_dist / "Hikari.GameLauncher.exe").is_file():
        build_launcher_distribution(workspace_root, launcher_project, launcher_dist, dotnet_path)

    game_dir = output_dir / "game"
    build_web_game(project, game_dir, project_path, builtin_assets, custom_assets, runtime_dist)

    for source in launcher_dist.iterdir():
        destination = output_dir / source.name
        if source.is_dir():
            shutil.copytree(source, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(source, destination)

    launcher_config = {
        "projectId": str(project.get("meta", {}).get("id") or "hikari-game"),
        "name": str(project.get("meta", {}).get("name") or "Hikari Game"),
        "width": int(project.get("meta", {}).get("resolution", [1280, 720])[0]),
        "height": int(project.get("meta", {}).get("resolution", [1280, 720])[1]),
        "version": str(project.get("meta", {}).get("gameVersion") or "1.0.0"),
    }
    (output_dir / "launcher.json").write_text(json.dumps(launcher_config, ensure_ascii=False, indent=2), encoding="utf-8")

    original = output_dir / "Hikari.GameLauncher.exe"
    named_executable = output_dir / f"{safe_slug(launcher_config['name'])}.exe"
    if named_executable != original:
        original.replace(named_executable)
    return named_executable
