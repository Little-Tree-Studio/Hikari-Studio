from __future__ import annotations

import ctypes
import os
import time
from ctypes import wintypes


CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
MAX_CLIPBOARD_TEXT_BYTES = 4 * 1024 * 1024


def _open_windows_clipboard() -> None:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    for _ in range(8):
        if user32.OpenClipboard(None):
            return
        time.sleep(0.025)
    raise OSError(ctypes.get_last_error(), "无法打开 Windows 剪贴板")


def _read_windows_text() -> str:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.GetClipboardData.argtypes = [wintypes.UINT]
    user32.GetClipboardData.restype = wintypes.HANDLE
    user32.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
    user32.IsClipboardFormatAvailable.restype = wintypes.BOOL
    user32.CloseClipboard.restype = wintypes.BOOL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype = wintypes.BOOL

    _open_windows_clipboard()
    handle = None
    try:
        if not user32.IsClipboardFormatAvailable(CF_UNICODETEXT):
            return ""
        handle = user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            raise OSError(ctypes.get_last_error(), "无法读取 Windows 剪贴板")
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            raise OSError(ctypes.get_last_error(), "无法锁定 Windows 剪贴板数据")
        try:
            text = ctypes.wstring_at(pointer)
        finally:
            kernel32.GlobalUnlock(handle)
        if len(text.encode("utf-8")) > MAX_CLIPBOARD_TEXT_BYTES:
            raise ValueError("剪贴板文本超过 4 MB 限制")
        return text
    finally:
        user32.CloseClipboard()


def _write_windows_text(text: str) -> None:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.CloseClipboard.restype = wintypes.BOOL
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype = wintypes.BOOL
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.restype = wintypes.HGLOBAL

    encoded = (text + "\0").encode("utf-16-le")
    handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(encoded))
    if not handle:
        raise OSError(ctypes.get_last_error(), "无法分配 Windows 剪贴板内存")
    transferred = False
    try:
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            raise OSError(ctypes.get_last_error(), "无法锁定 Windows 剪贴板内存")
        try:
            ctypes.memmove(pointer, encoded, len(encoded))
        finally:
            kernel32.GlobalUnlock(handle)

        _open_windows_clipboard()
        try:
            if not user32.EmptyClipboard():
                raise OSError(ctypes.get_last_error(), "无法清空 Windows 剪贴板")
            if not user32.SetClipboardData(CF_UNICODETEXT, handle):
                raise OSError(ctypes.get_last_error(), "无法写入 Windows 剪贴板")
            transferred = True
        finally:
            user32.CloseClipboard()
    finally:
        if not transferred:
            kernel32.GlobalFree(handle)


def _read_tk_text() -> str:
    import tkinter

    root = tkinter.Tk()
    root.withdraw()
    try:
        return str(root.clipboard_get())
    except tkinter.TclError:
        return ""
    finally:
        root.destroy()


def _write_tk_text(text: str) -> None:
    import tkinter

    root = tkinter.Tk()
    root.withdraw()
    try:
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
    finally:
        root.destroy()


def read_clipboard_text() -> str:
    return _read_windows_text() if os.name == "nt" else _read_tk_text()


def write_clipboard_text(text: str) -> bool:
    if not isinstance(text, str):
        raise ValueError("剪贴板内容必须是文本")
    if len(text.encode("utf-8")) > MAX_CLIPBOARD_TEXT_BYTES:
        raise ValueError("剪贴板文本超过 4 MB 限制")
    if os.name == "nt":
        _write_windows_text(text)
    else:
        _write_tk_text(text)
    return True
