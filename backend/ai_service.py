from __future__ import annotations

import contextlib
import ctypes
from copy import deepcopy
import inspect
import ipaddress
import json
import logging
import os
import tempfile
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlparse, urlunparse

from .agent_tools import AgentToolRegistry
from .ai_health import ModelHealthCache
from .ai_provider import AiProvider, OpenAiCompatibleProvider, ProviderAuthenticationError, ProviderUnavailableError, RequestCancellation


LOGGER = logging.getLogger(__name__)
CREDENTIAL_TARGET = "SlideStudio/AiProvider"

BUILTIN_MODELS: tuple[dict[str, Any], ...] = (
    {"id": "gpt-5", "name": "GPT-5", "category": "reasoning", "supportsTools": True, "supportsVision": True, "supportsStructuredOutput": True, "contextWindow": 400000},
    {"id": "gpt-5-mini", "name": "GPT-5 mini", "category": "fast", "supportsTools": True, "supportsVision": True, "supportsStructuredOutput": True, "contextWindow": 400000},
    {"id": "gpt-4.1", "name": "GPT-4.1", "category": "general", "supportsTools": True, "supportsVision": True, "supportsStructuredOutput": True, "contextWindow": 1047576},
    {"id": "gpt-4.1-mini", "name": "GPT-4.1 mini", "category": "fast", "supportsTools": True, "supportsVision": True, "supportsStructuredOutput": True, "contextWindow": 1047576},
    {"id": "o3", "name": "o3", "category": "reasoning", "supportsTools": True, "supportsVision": True, "supportsStructuredOutput": True, "contextWindow": 200000},
    {"id": "o4-mini", "name": "o4-mini", "category": "reasoning", "supportsTools": True, "supportsVision": True, "supportsStructuredOutput": True, "contextWindow": 200000},
    {"id": "deepseek-reasoner", "name": "DeepSeek Reasoner", "category": "reasoning", "supportsTools": False, "supportsVision": False, "supportsStructuredOutput": True, "contextWindow": 128000},
    {"id": "deepseek-chat", "name": "DeepSeek Chat", "category": "general", "supportsTools": True, "supportsVision": False, "supportsStructuredOutput": True, "contextWindow": 128000},
    {"id": "qwen-max", "name": "Qwen Max", "category": "general", "supportsTools": True, "supportsVision": False, "supportsStructuredOutput": True, "contextWindow": 32768},
    {"id": "qwen-vl-max", "name": "Qwen VL Max", "category": "vision", "supportsTools": True, "supportsVision": True, "supportsStructuredOutput": True, "contextWindow": 32768},
)


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
        credential.UserName = "Slide Studio"
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


class FileSecretStore:
    """非 Windows 平台的 API Key 回退存储：应用数据目录内的受限权限文件。

    Windows 继续使用 Credential Manager；此实现让 AiService 在 macOS/Linux
    上可以构造与运行（与项目内其余跨平台回退保持一致），并在 POSIX 上
    将文件权限收紧为 0600。
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def read(self) -> str | None:
        try:
            return self.path.read_text(encoding="utf-8") or None
        except FileNotFoundError:
            return None

    def write(self, value: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(value, encoding="utf-8")
        if os.name == "posix":
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                LOGGER.warning("Failed to restrict secret file permissions: %s", self.path)


def default_secret_store(data_dir: Path) -> SecretStore:
    if os.name == "nt":
        return WindowsCredentialStore()
    store = FileSecretStore(data_dir.resolve() / "settings" / "ai-key.secret")
    LOGGER.warning("Non-Windows platform: API key is stored in a permission-restricted file (%s)", store.path)
    return store


def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp_path)
        raise


def _endpoint_is_local_http(url: str) -> bool:
    """http 明文端点只放行本机回环与私有网段地址（本地 LLM 服务常见场景）。"""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return False


class AiService:
    def __init__(self, data_dir: Path, secret_store: SecretStore | None = None, provider_factory: Callable[[dict[str, Any], str], AiProvider] | None = None) -> None:
        self.settings_path = data_dir.resolve() / "settings" / "ai.json"
        self.health_cache = ModelHealthCache(data_dir.resolve() / "settings" / "ai-health.json")
        self.secret_store = secret_store or default_secret_store(data_dir)
        self.provider_factory = provider_factory or self._create_provider
        self._monitor_stop = threading.Event()
        self._monitor_thread: threading.Thread | None = None

    def get_settings(self) -> dict[str, Any]:
        settings = self._read_settings()
        return {**settings, "hasKey": bool(self.secret_store.read())}

    def clear_key(self) -> dict[str, Any]:
        self.secret_store.write("")
        return self.get_settings()

    def save_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        url = str(settings.get("url", "")).strip().rstrip("/")
        model = str(settings.get("model", "")).strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("API URL 必须是有效的 http 或 https 地址")
        if parsed.scheme == "http" and not _endpoint_is_local_http(url):
            raise ValueError("为避免 API Key 明文传输，不允许使用公网 http:// 端点；本机与私有局域网地址可用，公网请改用 https://")
        if not model:
            raise ValueError("模型名称不能为空")
        clear_key = bool(settings.get("clearKey"))
        api_key = str(settings.get("apiKey", "")).strip()
        if clear_key:
            self.secret_store.write("")
        elif api_key:
            self.secret_store.write(api_key)
        fallback_models = []
        for candidate in settings.get("fallbackModels", []):
            candidate_id = str(candidate).strip()
            if candidate_id and candidate_id != model and candidate_id not in fallback_models:
                fallback_models.append(candidate_id)
        public = {"url": url, "model": model, "fallbackModels": fallback_models[:5], "temperature": min(1.5, max(0.0, float(settings.get("temperature", 0.4))))}
        _write_json_atomic(self.settings_path, public)
        return {**public, "hasKey": bool(self.secret_store.read())}

    def run(
        self,
        instruction: str,
        project: dict[str, Any],
        checkpoint: Callable[[], None] | None = None,
        progress: Callable[[str, str, dict[str, Any] | None], None] | None = None,
        cancellation: RequestCancellation | None = None,
        execution_checkpoint: dict[str, Any] | None = None,
        save_execution_checkpoint: Callable[[dict[str, Any]], None] | None = None,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        checkpoint = checkpoint or (lambda: None)
        progress = progress or (lambda _kind, _message, _data=None: None)
        instruction = instruction.strip()
        if not instruction:
            raise ValueError("请先描述希望 Agent 完成的任务")
        settings = self._read_settings()
        api_key = self.secret_store.read()
        if not api_key:
            raise ValueError("请先配置 API Key")
        candidates = []
        for model in [settings["model"], *settings.get("fallbackModels", [])]:
            model_id = str(model).strip()
            if model_id and model_id not in candidates:
                candidates.append(model_id)
        failures: list[dict[str, str]] = []
        for model_id in candidates:
            checkpoint()
            circuit_state = self.health_cache.circuit_state(settings["url"], api_key, model_id)
            if circuit_state == "open":
                failures.append({"model": model_id, "status": "circuit_open", "message": "熔断器处于冷却期，已跳过"})
                progress("model_skipped", f"模型 {model_id} 处于熔断冷却期", {"model": model_id})
                continue
            candidate_settings = {**settings, "model": model_id}
            registry = AgentToolRegistry(project, context)
            try:
                progress("model_selected", f"正在使用模型 {model_id}", {"model": model_id})
                provider = self.provider_factory(candidate_settings, api_key)
                plan = self._run_tool_loop(provider, registry, instruction, checkpoint, progress, cancellation, execution_checkpoint, save_execution_checkpoint, model_id)
                plan["model"] = model_id
                plan["failoverHistory"] = failures
                self.health_cache.record_success(settings["url"], api_key, model_id, {"status": "healthy", "supportsTools": True, "message": "最近一次 Agent 调用成功"})
                LOGGER.info("AI plan generated: model=%s operations=%s tools=%s", model_id, len(plan["operations"]), len(plan["toolCalls"]))
                progress("plan_ready", "结构化修改计划已生成", {"model": model_id, "operationCount": len(plan["operations"])})
                return plan
            except ProviderUnavailableError:
                self.health_cache.record_failure(settings["url"], api_key, model_id, "Agent 调用失败，上游暂时不可用")
                failures.append({"model": model_id, "status": "unavailable", "message": "上游暂时不可用，已尝试下一候选"})
                progress("model_failed", f"模型 {model_id} 不可用，准备切换", {"model": model_id})
                LOGGER.info("AI model unavailable; trying fallback: model=%s", model_id)
        raise RuntimeError("所有候选模型均不可用，请重新运行健康探测或检查服务状态")

    def _create_provider(self, settings: dict[str, Any], api_key: str) -> AiProvider:
        return OpenAiCompatibleProvider(self._endpoint(settings["url"]), api_key, settings["model"], settings.get("temperature", 0.4))

    def optimize_block_text(self, text: str, kind: str, context: dict[str, Any] | None = None) -> str:
        """润色单个旁白/对白 Block 的文本，返回优化后的纯文本。"""
        settings = self._read_settings()
        api_key = self.secret_store.read()
        if not api_key:
            raise ValueError("请先在 AI Agent 设置中配置 API Key")
        source = (text or "").strip()
        if not source:
            raise ValueError("文本内容为空，无法优化")
        context = context or {}
        speaker = str(context.get("speaker") or "").strip()
        expression = str(context.get("expression") or "").strip()
        if kind == "dialogue":
            role_hint = f"角色：{speaker or '未指定'}"
            if expression:
                role_hint += f"，表情：{expression}"
            task = (
                "请优化下面这条视觉小说角色对白的措辞，使其更自然、生动、贴合角色口吻。"
                f"保持原意与大致长度，不要改变说话人。{role_hint}。"
                "只输出优化后的对白正文，不要任何解释、引号或角色名前缀。"
            )
        else:
            task = (
                "请优化下面这条视觉小说旁白，使其更流畅、更有画面感。"
                "保持原意、文风和大致长度。只输出优化后的旁白正文，不要任何解释或引号。"
            )
        messages = [
            {"role": "system", "content": "你是一位专业的视觉小说剧本编辑，擅长润色对白与旁白。"},
            {"role": "user", "content": f"{task}\n\n原文本：\n{source}"},
        ]
        response = self.provider_factory(settings, api_key).complete(messages, tools=[])
        result = (response.content or "").strip()
        if not result:
            raise RuntimeError("AI 未返回可用的优化文本")
        return result

    def _run_tool_loop(
        self,
        provider: AiProvider,
        registry: AgentToolRegistry,
        instruction: str,
        checkpoint: Callable[[], None] | None = None,
        progress: Callable[[str, str, dict[str, Any] | None], None] | None = None,
        cancellation: RequestCancellation | None = None,
        execution_checkpoint: dict[str, Any] | None = None,
        save_execution_checkpoint: Callable[[dict[str, Any]], None] | None = None,
        model_id: str = "",
    ) -> dict[str, Any]:
        checkpoint = checkpoint or (lambda: None)
        progress = progress or (lambda _kind, _message, _data=None: None)
        system = (
            "你是 Slide Studio 的全栈 Galgame 制作 Agent。先使用工具读取需要的项目上下文，不要猜测 ID。"
            "查询和诊断工具可直接执行；编辑工具只创建待用户确认的结构化差异；构建工具只创建单独确认请求。"
            "完成工具调用后只输出 JSON：{summary:string,assumptions:string[],operations:array}。"
            "operations 通常留空，因为编辑工具产生的提案会自动合并；禁止声称已经写入或构建。"
        )
        if registry.context.get("mode") == "director":
            system += (
                "当前任务是导演模式。必须先调用 get_project_overview、get_production_memory、get_fragment 和 get_branch_simulation，"
                "只使用项目中真实存在的角色、场景和音频素材。使用插入、更新或移动 Block 工具编排场景、角色、镜头、声音与转场，"
                "保持原对白和流程控制不变，并在摘要中列出制作记忆冲突与模拟风险。"
            )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps({"task": instruction, "activeFragmentId": registry.project.get("activeFragmentId"), "context": registry.context}, ensure_ascii=False)},
        ]
        usage: dict[str, int] = {}
        start_round = 0
        if execution_checkpoint:
            if int(execution_checkpoint.get("version", 0)) != 1:
                raise ValueError("Agent 执行检查点版本不受支持")
            restored_messages = execution_checkpoint.get("messages")
            restored_registry = execution_checkpoint.get("registry")
            if not isinstance(restored_messages, list) or not isinstance(restored_registry, dict):
                raise ValueError("Agent 执行检查点已损坏")
            messages = deepcopy(restored_messages)
            usage = {str(key): int(value) for key, value in (execution_checkpoint.get("usage") or {}).items() if isinstance(value, (int, float))}
            start_round = max(0, int(execution_checkpoint.get("nextRound", 0)))
            registry.proposed_operations = deepcopy(restored_registry.get("proposedOperations") or [])
            registry.requested_builds = deepcopy(restored_registry.get("requestedBuilds") or [])
            registry.trace = deepcopy(restored_registry.get("trace") or [])
            restored_tool_count = len(registry.trace)
            progress("checkpoint_restored", f"已恢复 {restored_tool_count} 个已完成工具步骤", {"step": restored_tool_count, "round": start_round, "model": execution_checkpoint.get("model") or model_id})
        final_content = ""
        for round_index in range(start_round, 8):
            checkpoint()
            progress("thinking", f"模型推理中 · 第 {round_index + 1} 轮", {"round": round_index + 1})
            streamed_length = 0
            pending_delta: list[str] = []
            pending_length = 0
            last_delta_emit = time.monotonic()

            def flush_delta() -> None:
                nonlocal pending_length, last_delta_emit
                if not pending_delta:
                    return
                progress("text_delta", "模型正在生成回复", {"delta": "".join(pending_delta), "round": round_index + 1, "contentLength": streamed_length})
                pending_delta.clear()
                pending_length = 0
                last_delta_emit = time.monotonic()

            def on_delta(delta: str) -> None:
                nonlocal streamed_length, pending_length
                streamed_length += len(delta)
                pending_delta.append(delta)
                pending_length += len(delta)
                if pending_length >= 64 or time.monotonic() - last_delta_emit >= 0.08:
                    flush_delta()

            parameters = inspect.signature(provider.complete).parameters
            try:
                if "on_delta" in parameters:
                    response = provider.complete(messages, registry.schemas(), on_delta=on_delta, cancellation=cancellation)
                else:
                    response = provider.complete(messages, registry.schemas())
            finally:
                flush_delta()
            checkpoint()
            for key, value in response.usage.items():
                usage[key] = usage.get(key, 0) + value
            messages.append(response.assistant_message)
            if not response.tool_calls:
                final_content = response.content
                break
            for call in response.tool_calls:
                checkpoint()
                progress("tool_started", f"执行工具 {call.name}", {"tool": call.name})
                result = registry.invoke(call.name, call.arguments)
                progress("tool_finished", f"工具 {call.name} 已完成", {"tool": call.name, "ok": bool(result.get("ok"))})
                messages.append({"role": "tool", "tool_call_id": call.id, "name": call.name, "content": json.dumps(result, ensure_ascii=False)})
            if save_execution_checkpoint:
                save_execution_checkpoint({
                    "version": 1,
                    "model": model_id,
                    "nextRound": round_index + 1,
                    "messages": deepcopy(messages),
                    "usage": deepcopy(usage),
                    "registry": {
                        "proposedOperations": deepcopy(registry.proposed_operations),
                        "requestedBuilds": deepcopy(registry.requested_builds),
                        "trace": deepcopy(registry.trace),
                    },
                })
        else:
            raise RuntimeError("Agent 工具调用超过 8 轮，已停止以避免循环")
        if final_content.strip():
            plan = self._parse_plan(final_content)
        else:
            plan = {"summary": "Agent 已生成项目修改建议", "assumptions": [], "operations": []}
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for operation in [*registry.proposed_operations, *plan["operations"]]:
            fingerprint = json.dumps(operation, ensure_ascii=False, sort_keys=True)
            if fingerprint not in seen:
                seen.add(fingerprint)
                merged.append(operation)
        plan["operations"] = merged
        plan["toolCalls"] = registry.trace
        plan["requestedBuilds"] = registry.requested_builds
        plan["usage"] = usage
        return plan

    def _read_settings(self) -> dict[str, Any]:
        defaults = {"url": "https://api.openai.com/v1", "model": "gpt-5-mini", "fallbackModels": [], "temperature": 0.4}
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

    @staticmethod
    def _models_endpoint(url: str) -> str:
        parsed = urlparse(url.strip())
        path = parsed.path.rstrip("/")
        if path.endswith("/chat/completions"):
            path = path[: -len("/chat/completions")]
        elif path.endswith("/models"):
            return urlunparse(parsed._replace(path=path, query="", fragment=""))
        if not path.endswith("/v1"):
            path = f"{path}/v1" if path else "/v1"
        return urlunparse(parsed._replace(path=f"{path}/models", query="", fragment=""))

    def discover_models(self, settings: dict[str, Any] | None = None) -> dict[str, Any]:
        override = settings or {}
        saved = self._read_settings()
        url = str(override.get("url") or saved["url"]).strip().rstrip("/")
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("API URL 必须是有效的 http 或 https 地址")
        api_key = str(override.get("apiKey") or "").strip() or self.secret_store.read()
        cached_catalog = None if override.get("forceRefresh") else self.health_cache.get_catalog(url, api_key)
        if cached_catalog:
            cached_source = cached_catalog.get("source", "upstream")
            cached_warning = "当前使用缓存的内置常见模型目录。你仍可手动输入模型 ID。" if cached_source == "builtin" else None
            result = self._discovery_result(cached_catalog["models"], cached_source, cached_warning)
            result["catalogCached"] = True
            if override.get("probe"):
                return self._probe_discovery(result, url, api_key, int(override.get("probeLimit", 4)))
            return result
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        request = urllib.request.Request(self._models_endpoint(url), headers=headers, method="GET")
        try:
            body = self._request_json(request, timeout=15)
            raw_models = body.get("data") if isinstance(body, dict) else None
            if not isinstance(raw_models, list) or not raw_models:
                raise ValueError("上游没有返回可用的模型列表")
            models = [self._model_info(item, "upstream") for item in raw_models if isinstance(item, (dict, str))]
            models = [model for model in models if model["id"]]
            if not models:
                raise ValueError("上游模型列表为空")
            self.health_cache.set_catalog(url, api_key, models, "upstream")
            result = self._discovery_result(models, "upstream")
            result["catalogCached"] = False
            if override.get("probe"):
                return self._probe_discovery(result, url, api_key, int(override.get("probeLimit", 4)))
            return result
        except (OSError, TimeoutError, ValueError, json.JSONDecodeError, urllib.error.URLError) as error:
            LOGGER.info("AI model discovery unavailable; using builtin catalog: %s", type(error).__name__)
            models = [dict(model, source="builtin") for model in BUILTIN_MODELS]
            self.health_cache.set_catalog(url, api_key, models, "builtin")
            result = self._discovery_result(models, "builtin", "无法读取上游模型列表，已切换到内置常见模型目录。你仍可手动输入模型 ID。")
            result["catalogCached"] = False
            if override.get("probe"):
                return self._probe_discovery(result, url, api_key, int(override.get("probeLimit", 4)))
            return result

    @staticmethod
    def _request_json(request: urllib.request.Request, timeout: int) -> dict[str, Any]:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    @classmethod
    def _model_info(cls, raw: dict[str, Any] | str, source: str) -> dict[str, Any]:
        metadata = raw if isinstance(raw, dict) else {}
        model_id = str(metadata.get("id", raw if isinstance(raw, str) else "")).strip()
        inferred = cls._classify_model(model_id, metadata)
        return {
            "id": model_id,
            "name": str(metadata.get("name") or metadata.get("display_name") or model_id),
            "source": source,
            **inferred,
        }

    @staticmethod
    def _classify_model(model_id: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        value = model_id.lower()
        metadata = metadata or {}
        is_fast = any(token in value for token in ("mini", "nano", "flash", "haiku", "turbo", "lite"))
        is_vision = any(token in value for token in ("vision", "vl", "gpt-4o"))
        is_reasoning = any(token in value for token in ("reason", "deepseek-r1", "o1", "o3", "o4")) or ("gpt-5" in value and not is_fast)
        category = "fast" if is_fast else "reasoning" if is_reasoning else "vision" if is_vision else "general" if any(token in value for token in ("gpt", "claude", "gemini", "qwen", "deepseek", "llama", "mistral")) else "unknown"
        capabilities = metadata.get("capabilities") if isinstance(metadata.get("capabilities"), dict) else {}
        supports_tools = capabilities.get("tools", metadata.get("supports_tools"))
        supports_structured = capabilities.get("structured_output", metadata.get("supports_structured_output"))
        context = metadata.get("context_window") or metadata.get("context_length")
        known_agent_model = any(token in value for token in ("gpt-4", "gpt-5", "o3", "o4", "claude", "gemini", "qwen", "deepseek-chat", "llama", "mistral"))
        return {
            "category": category,
            "supportsTools": bool(known_agent_model if supports_tools is None else supports_tools),
            "supportsVision": bool(capabilities.get("vision", metadata.get("supports_vision", is_vision))),
            "supportsStructuredOutput": bool(known_agent_model if supports_structured is None else supports_structured),
            "contextWindow": int(context) if isinstance(context, (int, float)) and context > 0 else None,
        }

    @classmethod
    def _discovery_result(cls, models: list[dict[str, Any]], source: str, warning: str | None = None) -> dict[str, Any]:
        ordered = sorted(models, key=lambda model: (-cls._model_score(model), model["id"].lower()))
        recommended = next((model for model in ordered if cls._model_score(model) >= 0), ordered[0] if ordered else None)
        for model in ordered:
            model["recommended"] = bool(recommended and model["id"] == recommended["id"])
            model.setdefault("health", "unknown")
            model.setdefault("healthScore", round(max(0, cls._model_score(model)), 1))
        result: dict[str, Any] = {"models": ordered, "source": source}
        if recommended:
            result["recommendedModelId"] = recommended["id"]
        if warning:
            result["warning"] = warning
        return result

    @staticmethod
    def _model_score(model: dict[str, Any]) -> float:
        value = model["id"].lower()
        if any(token in value for token in ("embedding", "whisper", "tts", "audio", "moderation", "rerank", "image")):
            return -1000
        result = 100 if model.get("supportsTools") else 0
        result += 70 if model.get("supportsStructuredOutput") else 0
        result += min(int(model.get("contextWindow") or 0) / 10000, 60)
        result += {"reasoning": 30, "general": 24, "vision": 18, "fast": 16, "unknown": 0}.get(model.get("category"), 0)
        return result

    def _probe_discovery(self, result: dict[str, Any], url: str, api_key: str | None, probe_limit: int) -> dict[str, Any]:
        models = result["models"]
        cached_hits = 0
        stale_entries = 0
        for model in models:
            model.update({"health": "unknown", "healthMessage": "未探测", "lastCheckedAt": None})
            cached = self.health_cache.get(url, api_key, model["id"])
            if cached:
                model.update(self.health_cache.public_entry(cached))
                if self.health_cache.is_fresh(cached):
                    cached_hits += 1
                else:
                    stale_entries += 1
        if not api_key:
            result["warning"] = self._append_warning(result.get("warning"), "未配置 API Key，已跳过模型健康探测。")
            result["fallbackModelIds"] = []
            result["healthCache"] = {"ttlSeconds": self.health_cache.ttl_seconds, "cachedHits": cached_hits, "staleEntries": stale_entries, "probed": 0}
            return result
        limit = max(1, min(8, probe_limit))
        candidates = [model for model in models if self._model_score(model) >= 0][:limit]
        auth_failed = False
        probed = 0
        for model in candidates:
            if probed >= limit:
                break
            if not self.health_cache.should_probe(url, api_key, model["id"]):
                continue
            probed += 1
            try:
                provider = self.provider_factory({"url": url, "model": model["id"], "temperature": 0}, api_key)
                probe = provider.probe()
                probe["healthScore"] = self._health_score(probe["status"], probe.get("latencyMs"), model)
                cached = self.health_cache.record_probe(url, api_key, model["id"], probe)
                model.update(self.health_cache.public_entry(cached))
                if probe.get("supportsTools") is not None:
                    model["supportsTools"] = bool(probe["supportsTools"])
            except ProviderAuthenticationError:
                auth_failed = True
                model.update({"health": "unknown", "healthScore": 0, "healthMessage": "API Key 无效或无访问权限", "lastCheckedAt": datetime.now(timezone.utc).isoformat()})
                break
            except (ProviderUnavailableError, RuntimeError):
                cached = self.health_cache.record_failure(url, api_key, model["id"], "模型路由不可用")
                model.update(self.health_cache.public_entry(cached))
        health_rank = {"healthy": 3, "degraded": 2, "unknown": 1, "unavailable": 0}
        models.sort(key=lambda model: (-health_rank.get(model.get("health"), 0), -float(model.get("healthScore") or 0), model["id"].lower()))
        healthy = [model for model in models if model.get("health") == "healthy" and model.get("supportsTools")]
        for model in models:
            model["recommended"] = bool(healthy and model["id"] == healthy[0]["id"])
        if healthy:
            result["recommendedModelId"] = healthy[0]["id"]
            result["fallbackModelIds"] = [model["id"] for model in healthy[1:6]]
        else:
            result.pop("recommendedModelId", None)
            result["fallbackModelIds"] = []
            message = "健康探测没有找到可用且支持工具调用的模型，请手动选择或稍后重试。"
            result["warning"] = self._append_warning(result.get("warning"), "API Key 鉴权失败，无法评估模型。" if auth_failed else message)
        result["healthCache"] = {"ttlSeconds": self.health_cache.ttl_seconds, "cachedHits": cached_hits, "staleEntries": stale_entries, "probed": probed}
        return result

    def start_health_monitor(self, interval_seconds: int = 60) -> None:
        if self._monitor_thread and self._monitor_thread.is_alive():
            return
        self._monitor_stop.clear()
        self._monitor_thread = threading.Thread(target=self._health_monitor_loop, args=(max(10, interval_seconds),), name="slide-ai-health", daemon=True)
        self._monitor_thread.start()

    def stop_health_monitor(self) -> None:
        self._monitor_stop.set()
        thread = self._monitor_thread
        if thread and thread.is_alive():
            thread.join(timeout=2)
        self._monitor_thread = None

    def _health_monitor_loop(self, interval_seconds: int) -> None:
        while not self._monitor_stop.wait(interval_seconds):
            try:
                self.background_health_pass()
            except Exception as error:  # Background monitoring must never terminate the editor.
                LOGGER.warning("AI health monitor pass failed: %s", type(error).__name__)

    def background_health_pass(self, limit: int = 2) -> int:
        settings = self._read_settings()
        api_key = self.secret_store.read()
        if not api_key:
            return 0
        checked = 0
        candidates: list[str] = []
        for model in [settings["model"], *settings.get("fallbackModels", [])]:
            model_id = str(model).strip()
            if model_id and model_id not in candidates:
                candidates.append(model_id)
        for model_id in candidates:
            if checked >= max(1, limit):
                break
            if not self.health_cache.should_probe(settings["url"], api_key, model_id):
                continue
            checked += 1
            try:
                provider = self.provider_factory({**settings, "model": model_id, "temperature": 0}, api_key)
                probe = provider.probe()
                self.health_cache.record_probe(settings["url"], api_key, model_id, probe)
            except ProviderAuthenticationError:
                break
            except (ProviderUnavailableError, RuntimeError):
                self.health_cache.record_failure(settings["url"], api_key, model_id, "后台重测失败")
        return checked

    @classmethod
    def _health_score(cls, status: str, latency_ms: int | None, model: dict[str, Any]) -> float:
        base = max(0, cls._model_score(model))
        if status == "healthy":
            return round(100 + min(base / 4, 80) - min((latency_ms or 0) / 100, 30), 1)
        if status == "degraded":
            return round(25 + min(base / 10, 20), 1)
        return 0

    @staticmethod
    def _append_warning(existing: str | None, message: str) -> str:
        return f"{existing} {message}".strip() if existing else message

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
            "productionMemory": project.get("productionMemory", {}),
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
        allowed_operations = {"add_blocks", "insert_blocks", "update_blocks", "move_blocks", "create_fragment", "update_project", "upsert_character", "update_asset", "upsert_variable", "update_branch", "update_production_memory"}
        required_fields = {
            "add_blocks": ("fragmentId", "blocks"), "create_fragment": ("chapterId", "name", "blocks"),
            "insert_blocks": ("fragmentId", "position", "blocks"), "update_blocks": ("fragmentId", "updates"),
            "move_blocks": ("fragmentId", "blockIds", "position"),
            "update_project": (), "upsert_character": ("name",), "update_asset": ("assetId",),
            "upsert_variable": ("name", "defaultValue", "valueType", "persistence"),
            "update_branch": ("fragmentId", "blockId", "title", "options"),
            "update_production_memory": ("memory",),
        }
        allowed_blocks = {"scene", "sound", "characterShow", "characterHide", "camera", "narration", "dialogue", "branch", "setVariable", "condition", "jump", "call", "return"}
        for operation in plan["operations"]:
            if not isinstance(operation, dict) or operation.get("type") not in allowed_operations:
                raise ValueError("Agent 计划包含不受支持的操作")
            if any(field not in operation for field in required_fields[operation["type"]]):
                raise ValueError("Agent 计划操作缺少必要字段")
            if operation["type"] == "update_branch" and (not isinstance(operation.get("options"), list) or not operation["options"] or any(not isinstance(option, dict) or not isinstance(option.get("text"), str) or not isinstance(option.get("target"), str) for option in operation["options"])):
                raise ValueError("Agent 分支修改格式无效")
            if operation["type"] == "upsert_character" and "portraits" in operation and not isinstance(operation["portraits"], dict):
                raise ValueError("Agent 角色立绘引用格式无效")
            for block in operation.get("blocks", []):
                if not isinstance(block, dict) or block.get("type") not in allowed_blocks:
                    raise ValueError("Agent 计划包含不受支持的 Block")
        return {"summary": plan["summary"], "assumptions": plan.get("assumptions", []), "operations": plan["operations"]}
