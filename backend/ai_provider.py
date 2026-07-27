from __future__ import annotations

import json
import socket
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol


@dataclass(frozen=True)
class ProviderToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ProviderResponse:
    content: str
    tool_calls: list[ProviderToolCall]
    usage: dict[str, int]
    assistant_message: dict[str, Any]


class AiProvider(Protocol):
    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_delta: Callable[[str], None] | None = None,
        cancellation: "RequestCancellation | None" = None,
    ) -> ProviderResponse: ...
    def probe(self) -> dict[str, Any]: ...


class ProviderUnavailableError(RuntimeError):
    """The selected model or its upstream route is temporarily unavailable."""


class ProviderAuthenticationError(RuntimeError):
    """Credentials or upstream access are invalid; switching models cannot fix this."""


class ProviderRequestCancelled(RuntimeError):
    """The caller intentionally aborted the active provider request."""


class RequestCancellation:
    def __init__(self) -> None:
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._aborters: set[Callable[[], None]] = set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise ProviderRequestCancelled("AI 请求已取消")

    def register(self, aborter: Callable[[], None]) -> Callable[[], None]:
        with self._lock:
            if self._event.is_set():
                abort_now = True
            else:
                self._aborters.add(aborter)
                abort_now = False
        if abort_now:
            self._safe_abort(aborter)

        def unregister() -> None:
            with self._lock:
                self._aborters.discard(aborter)

        return unregister

    def cancel(self) -> None:
        self._event.set()
        with self._lock:
            aborters = list(self._aborters)
            self._aborters.clear()
        for aborter in aborters:
            self._safe_abort(aborter)

    @staticmethod
    def _safe_abort(aborter: Callable[[], None]) -> None:
        try:
            aborter()
        except OSError:
            pass


class OpenAiCompatibleProvider:
    def __init__(self, endpoint: str, api_key: str, model: str, temperature: float = 0.4) -> None:
        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model
        self.temperature = temperature

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_delta: Callable[[str], None] | None = None,
        cancellation: RequestCancellation | None = None,
    ) -> ProviderResponse:
        return self._complete_stream(messages, tools, timeout=90, attempts=3, on_delta=on_delta, cancellation=cancellation)

    def _complete_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        timeout: int,
        attempts: int,
        on_delta: Callable[[str], None] | None,
        cancellation: RequestCancellation | None,
    ) -> ProviderResponse:
        payload: dict[str, Any] = {"model": self.model, "temperature": self.temperature, "messages": messages, "stream": True}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json", "Accept": "text/event-stream"},
            method="POST",
        )
        emitted = False
        for attempt in range(attempts):
            response: Any = None
            unregister = lambda: None
            try:
                if cancellation:
                    cancellation.raise_if_cancelled()
                response = urllib.request.urlopen(request, timeout=timeout)
                if cancellation:
                    unregister = cancellation.register(lambda: self._abort_response(response))
                    cancellation.raise_if_cancelled()
                content_type = str(getattr(response, "headers", {}).get("Content-Type", ""))
                if "application/json" in content_type:
                    body = json.loads(response.read().decode("utf-8"))
                    return self._response_from_body(body, on_delta)
                result, emitted = self._read_sse(response, on_delta, cancellation)
                return result
            except ProviderRequestCancelled:
                raise
            except urllib.error.HTTPError as error:
                error.read(500)
                if error.code in {401, 403}:
                    raise ProviderAuthenticationError(f"AI 服务鉴权失败（HTTP {error.code}）") from error
                retryable = error.code in {408, 409, 429, 500, 502, 503, 504}
                if emitted or not retryable or attempt == attempts - 1:
                    raise ProviderUnavailableError(f"模型 {self.model} 不可用（HTTP {error.code}）") from error
            except (OSError, ValueError, urllib.error.URLError) as error:
                if cancellation and cancellation.cancelled:
                    raise ProviderRequestCancelled("AI 请求已取消") from error
                if emitted or attempt == attempts - 1:
                    raise ProviderUnavailableError(f"模型 {self.model} 无法连接上游服务") from error
            finally:
                unregister()
                if response is not None:
                    response.close()
            if cancellation:
                cancellation.raise_if_cancelled()
            time.sleep(0.5 * (2 ** attempt))
        raise ProviderUnavailableError(f"模型 {self.model} 未返回有效响应")

    @staticmethod
    def _abort_response(response: Any) -> None:
        fp = getattr(response, "fp", None)
        raw = getattr(fp, "raw", None)
        network_socket = getattr(raw, "_sock", None) or getattr(fp, "_sock", None)
        if network_socket is not None:
            try:
                network_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                network_socket.close()
            except OSError:
                pass
        response.close()

    def _read_sse(
        self,
        response: Any,
        on_delta: Callable[[str], None] | None,
        cancellation: RequestCancellation | None,
    ) -> tuple[ProviderResponse, bool]:
        content_parts: list[str] = []
        tool_parts: dict[int, dict[str, str]] = {}
        usage: dict[str, int] = {}
        emitted = False
        while True:
            if cancellation:
                cancellation.raise_if_cancelled()
            raw = response.readline()
            if not raw:
                if cancellation:
                    cancellation.raise_if_cancelled()
                break
            line = raw.decode("utf-8").strip()
            if not line or line.startswith(":") or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError as error:
                raise RuntimeError("AI 服务返回了无效的 SSE 数据") from error
            raw_usage = chunk.get("usage")
            if isinstance(raw_usage, dict):
                usage.update({key: int(value) for key, value in raw_usage.items() if isinstance(value, (int, float))})
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            text = delta.get("content")
            if isinstance(text, str) and text:
                content_parts.append(text)
                emitted = True
                if on_delta:
                    on_delta(text)
            for raw_call in delta.get("tool_calls") or []:
                index = int(raw_call.get("index", 0))
                current = tool_parts.setdefault(index, {"id": "", "name": "", "arguments": ""})
                if raw_call.get("id"):
                    current["id"] += str(raw_call["id"])
                function = raw_call.get("function") or {}
                if function.get("name"):
                    current["name"] += str(function["name"])
                if function.get("arguments"):
                    current["arguments"] += str(function["arguments"])
                emitted = True
        if not emitted and not content_parts and not tool_parts:
            raise RuntimeError("AI 流式响应为空")
        content = "".join(content_parts)
        raw_calls = []
        calls = []
        for index in sorted(tool_parts):
            item = tool_parts[index]
            try:
                arguments = json.loads(item["arguments"] or "{}")
            except json.JSONDecodeError as error:
                raise RuntimeError(f"模型工具调用参数不是有效 JSON：{item['name'] or 'unknown'}") from error
            if not isinstance(arguments, dict):
                raise RuntimeError("模型工具调用参数必须是 JSON 对象")
            call_id = item["id"] or f"call_{index}"
            calls.append(ProviderToolCall(call_id, item["name"], arguments))
            raw_calls.append({"id": call_id, "type": "function", "function": {"name": item["name"], "arguments": item["arguments"] or "{}"}})
        assistant: dict[str, Any] = {"role": "assistant", "content": content}
        if raw_calls:
            assistant["tool_calls"] = raw_calls
        return ProviderResponse(content, calls, usage, assistant), emitted

    def _response_from_body(self, body: dict[str, Any], on_delta: Callable[[str], None] | None = None) -> ProviderResponse:
        result = self._parse_body(body)
        if result.content and on_delta:
            on_delta(result.content)
        return result

    def _complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], timeout: int, attempts: int) -> ProviderResponse:
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": self.temperature,
            "messages": messages,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        body: dict[str, Any] | None = None
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    body = json.loads(response.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as error:
                error.read(500)
                if error.code in {401, 403}:
                    raise ProviderAuthenticationError(f"AI 服务鉴权失败（HTTP {error.code}）") from error
                retryable = error.code in {408, 409, 429, 500, 502, 503, 504}
                if not retryable or attempt == attempts - 1:
                    raise ProviderUnavailableError(f"模型 {self.model} 不可用（HTTP {error.code}）") from error
            except urllib.error.URLError as error:
                if attempt == attempts - 1:
                    raise ProviderUnavailableError(f"模型 {self.model} 无法连接上游服务") from error
            time.sleep(0.5 * (2 ** attempt))
        if body is None:
            raise RuntimeError("AI 服务未返回响应")
        return self._parse_body(body)

    @staticmethod
    def _parse_body(body: dict[str, Any]) -> ProviderResponse:
        try:
            message = body["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError("AI 服务响应格式不兼容 OpenAI Chat Completions") from error
        calls: list[ProviderToolCall] = []
        for index, raw in enumerate(message.get("tool_calls") or []):
            function = raw.get("function") or {}
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except json.JSONDecodeError as error:
                raise RuntimeError(f"模型工具调用参数不是有效 JSON：{function.get('name', 'unknown')}") from error
            if not isinstance(arguments, dict):
                raise RuntimeError("模型工具调用参数必须是 JSON 对象")
            calls.append(ProviderToolCall(str(raw.get("id") or f"call_{index}"), str(function.get("name") or ""), arguments))
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        normalized_usage = {key: int(value) for key, value in usage.items() if isinstance(value, (int, float))}
        assistant = {"role": "assistant", "content": message.get("content") or ""}
        if message.get("tool_calls"):
            assistant["tool_calls"] = message["tool_calls"]
        return ProviderResponse(str(message.get("content") or ""), calls, normalized_usage, assistant)

    def probe(self) -> dict[str, Any]:
        started = time.perf_counter()
        health_tool = [{
            "type": "function",
            "function": {
                "name": "health_check",
                "description": "确认模型能够执行标准工具调用。",
                "parameters": {"type": "object", "properties": {"status": {"type": "string", "enum": ["ok"]}}, "required": ["status"], "additionalProperties": False},
            },
        }]
        response = self._complete([
            {"role": "system", "content": "这是连接测试。必须调用 health_check 工具并传入 status=ok，不要输出其它内容。"},
            {"role": "user", "content": "执行健康检查。"},
        ], health_tool, timeout=12, attempts=1)
        latency = max(1, round((time.perf_counter() - started) * 1000))
        supports_tools = any(call.name == "health_check" and call.arguments.get("status") == "ok" for call in response.tool_calls)
        return {
            "status": "healthy" if supports_tools else "degraded",
            "latencyMs": latency,
            "supportsTools": supports_tools,
            "message": "连接正常，工具调用可用" if supports_tools else "连接正常，但未完成标准工具调用",
        }
