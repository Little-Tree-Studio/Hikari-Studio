from __future__ import annotations

import json
import io
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from backend.ai_provider import OpenAiCompatibleProvider, ProviderAuthenticationError, ProviderRequestCancelled, RequestCancellation


class FakeResponse:
    def __init__(self, body: dict, content_type: str = "application/json") -> None:
        self.body = body
        self.headers = {"Content-Type": content_type}
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read(self) -> bytes:
        return json.dumps(self.body).encode("utf-8")

    def close(self) -> None:
        self.closed = True


class SseResponse(FakeResponse):
    def __init__(self, chunks: list[dict]) -> None:
        super().__init__({}, "text/event-stream")
        self.lines = [f"data: {json.dumps(chunk)}\n\n".encode("utf-8") for chunk in chunks] + [b"data: [DONE]\n\n"]

    def readline(self) -> bytes:
        return self.lines.pop(0) if self.lines else b""


class BlockingResponse(FakeResponse):
    def __init__(self) -> None:
        super().__init__({}, "text/event-stream")
        self.started = threading.Event()
        self.released = threading.Event()

    def readline(self) -> bytes:
        self.started.set()
        self.released.wait(2)
        return b""

    def close(self) -> None:
        super().close()
        self.released.set()


class AiProviderTests(unittest.TestCase):
    def test_openai_provider_sends_tools_and_parses_calls(self) -> None:
        body = {
            "choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "get_fragment", "arguments": '{"fragmentId":"opening"}'}}]}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 8},
        }
        provider = OpenAiCompatibleProvider("https://example.com/v1/chat/completions", "secret", "model")
        tools = [{"type": "function", "function": {"name": "get_fragment", "parameters": {"type": "object"}}}]
        with patch("backend.ai_provider.urllib.request.urlopen", return_value=FakeResponse(body)) as urlopen:
            result = provider.complete([{"role": "user", "content": "test"}], tools)
        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["tool_choice"], "auto")
        self.assertEqual(result.tool_calls[0].arguments["fragmentId"], "opening")
        self.assertEqual(result.usage["prompt_tokens"], 12)
        self.assertNotIn("secret", json.dumps(payload))

    def test_provider_retries_transient_http_errors(self) -> None:
        unavailable = HTTPError("https://example.com", 503, "unavailable", {}, io.BytesIO(b"temporarily unavailable"))
        success = FakeResponse({"choices": [{"message": {"role": "assistant", "content": "done"}}]})
        provider = OpenAiCompatibleProvider("https://example.com/v1/chat/completions", "secret", "model")
        with patch("backend.ai_provider.urllib.request.urlopen", side_effect=[unavailable, success]) as urlopen, patch("backend.ai_provider.time.sleep"):
            result = provider.complete([{"role": "user", "content": "test"}], [])
        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(result.content, "done")
        unavailable.close()

    def test_provider_streams_text_and_reassembles_fragmented_tool_calls(self) -> None:
        response = SseResponse([
            {"choices": [{"delta": {"content": "Hel"}}]},
            {"choices": [{"delta": {"content": "lo"}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call-1", "function": {"name": "get_", "arguments": "{\"fragment"}}]}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": "fragment", "arguments": "Id\":\"opening\"}"}}]}}]},
            {"choices": [], "usage": {"completion_tokens": 5}},
        ])
        provider = OpenAiCompatibleProvider("https://example.com/v1/chat/completions", "secret", "model")
        deltas: list[str] = []
        with patch("backend.ai_provider.urllib.request.urlopen", return_value=response) as urlopen:
            result = provider.complete([{"role": "user", "content": "test"}], [], on_delta=deltas.append)
        payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertTrue(payload["stream"])
        self.assertEqual(deltas, ["Hel", "lo"])
        self.assertEqual(result.content, "Hello")
        self.assertEqual(result.tool_calls[0].name, "get_fragment")
        self.assertEqual(result.tool_calls[0].arguments, {"fragmentId": "opening"})
        self.assertEqual(result.usage["completion_tokens"], 5)

    def test_cancellation_closes_active_stream_and_stops_request(self) -> None:
        response = BlockingResponse()
        provider = OpenAiCompatibleProvider("https://example.com/v1/chat/completions", "secret", "model")
        cancellation = RequestCancellation()
        errors: list[BaseException] = []

        def run() -> None:
            try:
                provider.complete([{"role": "user", "content": "test"}], [], cancellation=cancellation)
            except BaseException as error:
                errors.append(error)

        worker = threading.Thread(target=run)
        with patch("backend.ai_provider.urllib.request.urlopen", return_value=response):
            worker.start()
            self.assertTrue(response.started.wait(1))
            cancellation.cancel()
            worker.join(1)
        self.assertFalse(worker.is_alive())
        self.assertTrue(response.closed)
        self.assertIsInstance(errors[0], ProviderRequestCancelled)

    def test_health_probe_requires_a_real_tool_call(self) -> None:
        body = {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [{"id": "health", "type": "function", "function": {"name": "health_check", "arguments": '{"status":"ok"}'}}]}}]}
        provider = OpenAiCompatibleProvider("https://example.com/v1/chat/completions", "secret", "model")
        with patch("backend.ai_provider.urllib.request.urlopen", return_value=FakeResponse(body)):
            result = provider.probe()
        self.assertEqual(result["status"], "healthy")
        self.assertTrue(result["supportsTools"])
        self.assertGreater(result["latencyMs"], 0)

    def test_authentication_errors_do_not_enter_retry_loop(self) -> None:
        unauthorized = HTTPError("https://example.com", 401, "unauthorized", {}, io.BytesIO(b"bad key"))
        provider = OpenAiCompatibleProvider("https://example.com/v1/chat/completions", "secret", "model")
        with patch("backend.ai_provider.urllib.request.urlopen", side_effect=unauthorized) as urlopen, self.assertRaises(ProviderAuthenticationError):
            provider.complete([{"role": "user", "content": "test"}], [])
        self.assertEqual(urlopen.call_count, 1)
        unauthorized.close()


if __name__ == "__main__":
    unittest.main()
