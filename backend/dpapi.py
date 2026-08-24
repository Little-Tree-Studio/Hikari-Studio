from __future__ import annotations

import ctypes
import os
from ctypes import wintypes

"""Windows DPAPI 加密辅助：保护 Agent 任务检查点等本机敏感数据。

使用 CryptProtectData（用户绑定、UI_FORBIDDEN）加密；密文带魔数前缀，
读取时按前缀区分新旧格式。非 Windows 平台回退为明文（不区分格式），
读取到带魔数的密文时报错，避免误读来自其他平台的加密文件。
"""

MAGIC = b"HIKARI_DPAPI_V1\0"
CRYPTPROTECT_UI_FORBIDDEN = 0x01


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


class _PromptStruct(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("dwPromptFlags", wintypes.DWORD),
        ("hwndApp", wintypes.HANDLE),
        ("szPrompt", wintypes.LPCWSTR),
    ]


class _Dpapi:
    def __init__(self) -> None:
        crypt32 = ctypes.WinDLL("Crypt32.dll", use_last_error=True)
        kernel32 = ctypes.WinDLL("Kernel32.dll", use_last_error=True)
        arguments = [
            ctypes.POINTER(_DataBlob),
            wintypes.LPCWSTR,
            ctypes.POINTER(_DataBlob),
            ctypes.c_void_p,
            ctypes.POINTER(_PromptStruct),
            wintypes.DWORD,
            ctypes.POINTER(_DataBlob),
        ]
        crypt32.CryptProtectData.argtypes = arguments
        crypt32.CryptProtectData.restype = wintypes.BOOL
        crypt32.CryptUnprotectData.argtypes = arguments
        crypt32.CryptUnprotectData.restype = wintypes.BOOL
        kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
        self.crypt32 = crypt32
        self.kernel32 = kernel32

    @staticmethod
    def _to_blob(data: bytes) -> _DataBlob:
        buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        return _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))

    @staticmethod
    def _from_blob(blob: _DataBlob) -> bytes:
        return bytes(ctypes.string_at(blob.pbData, blob.cbData))

    def _protect(self, plaintext: bytes) -> bytes:
        input_blob = self._to_blob(plaintext)
        output = _DataBlob()
        try:
            if not self.crypt32.CryptProtectData(
                ctypes.byref(input_blob), None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output)
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            return self._from_blob(output)
        finally:
            if output.pbData:
                self.kernel32.LocalFree(output.pbData)

    def _unprotect(self, ciphertext: bytes) -> bytes:
        input_blob = self._to_blob(ciphertext)
        output = _DataBlob()
        try:
            if not self.crypt32.CryptUnprotectData(
                ctypes.byref(input_blob), None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output)
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            return self._from_blob(output)
        finally:
            if output.pbData:
                self.kernel32.LocalFree(output.pbData)


_dpapi: _Dpapi | None = None


def _instance() -> _Dpapi | None:
    global _dpapi
    if os.name != "nt":
        return None
    if _dpapi is None:
        _dpapi = _Dpapi()
    return _dpapi


def available() -> bool:
    return _instance() is not None


def protect(plaintext: bytes) -> bytes:
    """加密字节串。Windows 返回带魔数前缀的 DPAPI 密文，其余平台原样返回。"""
    instance = _instance()
    if instance is None:
        return plaintext
    return MAGIC + instance._protect(plaintext)


def unprotect(data: bytes) -> bytes:
    """解密 protect 的输出；无魔数的明文（旧格式/非 Windows）原样返回。"""
    if not data.startswith(MAGIC):
        return data
    instance = _instance()
    if instance is None:
        raise ValueError("Encrypted checkpoint cannot be decrypted on this platform")
    return instance._unprotect(data[len(MAGIC):])
