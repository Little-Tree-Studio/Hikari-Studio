from __future__ import annotations

import os
from pathlib import Path


WEBVIEW2_CLIENT_IDS = (
    "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "{F1E7E5F0-2142-4BD1-8F07-DAE8E4F12D52}",
)


def _valid_version(value: str | None) -> bool:
    return bool(value and value.strip() and value.strip() != "0.0.0.0")


def _installed_file_version(root: Path) -> str | None:
    if not root.is_dir():
        return None
    versions = sorted(
        (item for item in root.iterdir() if item.is_dir() and _valid_version(item.name)),
        key=lambda item: tuple(int(part) if part.isdigit() else 0 for part in item.name.split(".")),
        reverse=True,
    )
    for version in versions:
        if version.joinpath("msedgewebview2.exe").is_file():
            return version.name
    return None


def installed_webview2_version() -> str | None:
    if os.name != "nt":
        return None
    try:
        import winreg
    except ImportError:
        return None

    access_modes = (winreg.KEY_READ | winreg.KEY_WOW64_32KEY, winreg.KEY_READ | winreg.KEY_WOW64_64KEY)
    for client_id in WEBVIEW2_CLIENT_IDS:
        key_path = rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{client_id}"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for access in access_modes:
                try:
                    with winreg.OpenKey(hive, key_path, 0, access) as key:
                        value, _ = winreg.QueryValueEx(key, "pv")
                        version = str(value).strip()
                        if _valid_version(version):
                            return version
                except OSError:
                    continue

    install_roots = (
        Path(os.getenv("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft" / "EdgeWebView" / "Application",
        Path(os.getenv("LOCALAPPDATA", "")) / "Microsoft" / "EdgeWebView" / "Application",
    )
    for install_root in install_roots:
        version = _installed_file_version(install_root)
        if version:
            return version

    # Edge installations can provide a compatible WebView2 browser even when
    # the Evergreen Runtime registration is absent. Ask the bundled WebView2
    # API before declaring the desktop host unavailable.
    try:
        from webview.platforms.edgechromium import CoreWebView2Environment

        version = str(CoreWebView2Environment.GetAvailableBrowserVersionString()).strip()
        if _valid_version(version):
            return version
    except Exception:
        pass
    return None


def show_missing_webview2_message() -> None:
    if os.name != "nt":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            None,
            "Hikari Studio 需要 Microsoft Edge WebView2 Runtime。\n\n请重新运行 Hikari Studio 安装程序，或从 Microsoft 官方网站安装 WebView2 Runtime。",
            "Hikari Studio 无法启动",
            0x10,
        )
    except (AttributeError, OSError):
        pass
