from __future__ import annotations

import ctypes
import json
import logging
import os
import urllib.error
import urllib.request
from ctypes import wintypes
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse


LOGGER = logging.getLogger(__name__)
CREDENTIAL_TARGET = "HikariStudio/AiProvider"


class SecretStore(Protocol):
    def read(self) -> str | None: ...
    def write(self, value: str) -> None: ...


class WindowsCredentialStore:
    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", wintypes.LPVOID),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    def __init__(self, target: str = CREDENTIAL_TARGET) -> None:
        if os.name != "nt":
            raise RuntimeError("Windows Credential Manager is only available on Windows")
        self.target = target
        self.advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
        self.advapi32.CredWriteW.argtypes = [ctypes.POINTER(self.CREDENTIAL), wintypes.DWORD]
        self.advapi32.CredWriteW.restype = wintypes.BOOL
        self.advapi32.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(self.CREDENTIAL))]
        self.advapi32.CredReadW.restype = wintypes.BOOL
        self.advapi32.CredFree.argtypes = [wintypes.LPVOID]

    def write(self, value: str) -> None:
        encoded = value.encode("utf-16-le")
        blob = (ctypes.c_ubyte * len(encoded)).from_buffer_copy(encoded)
        credential = self.CREDENTIAL()
        credential.Type = 1
        credential.TargetName = self.target
        credential.CredentialBlobSize = len(encoded)
        credential.CredentialBlob = ctypes.cast(blob, ctypes.POINTER(ctypes.c_ubyte))
        credential.Persist = 2
        credential.UserName = "Hikari Studio"
        if not self.advapi32.CredWriteW(ctypes.byref(credential), 0):
            raise ctypes.WinError()

    def read(self) -> str | None:
        pointer = ctypes.POINTER(self.CREDENTIAL)()
        ctypes.set_last_error(0)
        if not self.advapi32.CredReadW(self.target, 1, 0, ctypes.byref(pointer)):
            error = ctypes.get_last_error()
            if error == 1168:
                return None
            raise ctypes.WinError(error)
        try:
            credential = pointer.contents
            data = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
            return data.decode("utf-16-le")
        finally:
            self.advapi32.CredFree(pointer)


class AiService:
    def __init__(self, data_dir: Path, secret_store: SecretStore | None = None) -> None:
        self.settings_path = data_dir.resolve() / "settings" / "ai.json"
        self.secret_store = secret_store or WindowsCredentialStore()

    def get_settings(self) -> dict[str, Any]:
        settings = self._read_settings()
        return {**settings, "hasKey": bool(self.secret_store.read())}

    def save_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        url = str(settings.get("url", "")).strip().rstrip("/")
        model = str(settings.get("model", "")).strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("API URL 必须是有效的 http 或 https 地址")
        if not model:
            raise ValueError("模型名称不能为空")
        api_key = str(settings.get("apiKey", "")).strip()
        if api_key:
            self.secret_store.write(api_key)
        public = {"url": url, "model": model, "temperature": min(1.5, max(0.0, float(settings.get("temperature", 0.4))))}
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(json.dumps(public, ensure_ascii=False, indent=2), encoding="utf-8")
        return {**public, "hasKey": bool(self.secret_store.read())}

    def run(self, instruction: str, project: dict[str, Any]) -> dict[str, Any]:
        instruction = instruction.strip()
        if not instruction:
            raise ValueError("请先描述希望 Agent 完成的任务")
        settings = self._read_settings()
        api_key = self.secret_store.read()
        if not api_key:
            raise ValueError("请先配置 API Key")
        context = self._project_context(project)
        response = self._chat(settings, api_key, instruction, context)
        plan = self._parse_plan(response)
        LOGGER.info("AI plan generated: operations=%s", len(plan["operations"]))
        return plan

    def _read_settings(self) -> dict[str, Any]:
        defaults = {"url": "https://api.openai.com/v1", "model": "gpt-5-mini", "temperature": 0.4}
        if not self.settings_path.exists():
            return defaults
        try:
            return {**defaults, **json.loads(self.settings_path.read_text(encoding="utf-8"))}
        except (OSError, json.JSONDecodeError):
            return defaults

    @staticmethod
    def _endpoint(url: str) -> str:
        base = url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        if base.endswith("/v1"):
            return f"{base}/chat/completions"
        return f"{base}/v1/chat/completions"

    def _chat(self, settings: dict[str, Any], api_key: str, instruction: str, context: dict[str, Any]) -> str:
        system = (
            "你是 Hikari Studio 的 Galgame 制作 Agent。只输出 JSON，不要 Markdown。"
            "返回 {summary:string, assumptions:string[], operations:array}。"
            "operation 只允许："
            "{type:'add_blocks',fragmentId:string,blocks:StoryBlock[]};"
            "{type:'create_fragment',chapterId:string,name:string,blocks:StoryBlock[]};"
            "{type:'update_project',name?:string,author?:string}。"
            "StoryBlock.type 允许 scene,sound,characterShow,characterHide,camera,narration,dialogue,branch,setVariable,condition,jump,call,return；不要生成 id。"
            "引用片段、角色和素材时必须使用上下文中已有的 id 或名称。"
        )
        payload = {
            "model": settings["model"],
            "temperature": settings.get("temperature", 0.4),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"task": instruction, "project": context}, ensure_ascii=False)},
            ],
        }
        request = urllib.request.Request(
            self._endpoint(settings["url"]),
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"AI 服务返回 HTTP {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"无法连接 AI 服务: {error.reason}") from error
        try:
            return str(body["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError("AI 服务响应格式不兼容 OpenAI Chat Completions") from error

    @staticmethod
    def _project_context(project: dict[str, Any]) -> dict[str, Any]:
        active = project.get("activeFragmentId")
        return {
            "meta": project.get("meta", {}),
            "activeFragmentId": active,
            "chapters": project.get("chapters", []),
            "characters": project.get("characters", []),
            "assets": [{key: asset.get(key) for key in ("id", "kind", "name")} for asset in project.get("assets", [])],
            "variables": project.get("variables", {}),
            "activeBlocks": project.get("scripts", {}).get(active, []),
        }

    @staticmethod
    def _parse_plan(content: str) -> dict[str, Any]:
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
        try:
            plan = json.loads(text)
        except json.JSONDecodeError as error:
            raise ValueError("Agent 没有返回有效的结构化计划") from error
        if not isinstance(plan, dict) or not isinstance(plan.get("summary"), str) or not isinstance(plan.get("operations"), list):
            raise ValueError("Agent 计划缺少 summary 或 operations")
        allowed_operations = {"add_blocks", "create_fragment", "update_project"}
        allowed_blocks = {"scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "condition", "jump", "call", "return"}
        for operation in plan["operations"]:
            if not isinstance(operation, dict) or operation.get("type") not in allowed_operations:
                raise ValueError("Agent 计划包含不受支持的操作")
            for block in operation.get("blocks", []):
                if not isinstance(block, dict) or block.get("type") not in allowed_blocks:
                    raise ValueError("Agent 计划包含不受支持的 Block")
        return {"summary": plan["summary"], "assumptions": plan.get("assumptions", []), "operations": plan["operations"]}
