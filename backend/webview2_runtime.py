from __future__ import annotations

import os


WEBVIEW2_CLIENT_ID = "{F1E7E5F0-2142-4BD1-8F07-DAE8E4F12D52}"


def _valid_version(value: str | None) -> bool:
    return bool(value and value.strip() and value.strip() != "0.0.0.0")


def installed_webview2_version() -> str | None:
    if os.name != "nt":
        return None
    try:
        import winreg
    except ImportError:
        return None

    key_path = rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"
    access_modes = (winreg.KEY_READ | winreg.KEY_WOW64_32KEY, winreg.KEY_READ | winreg.KEY_WOW64_64KEY)
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
