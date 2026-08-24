from __future__ import annotations

import json
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.ai_service import AiService
from backend.ai_health import ModelHealthCache
from backend.ai_provider import ProviderRequestCancelled, ProviderResponse, ProviderToolCall, ProviderUnavailableError
from tests.test_agent_tools import sample_project


class MemorySecretStore:
    def __init__(self) -> None:
        self.value: str | None = None

    def read(self) -> str | None:
        return self.value

    def write(self, value: str) -> None:
        self.value = value


class AiServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.secret_store = MemorySecretStore()
        self.service = AiService(Path(self.temporary.name), self.secret_store)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_api_key_is_not_written_to_settings_file(self) -> None:
        result = self.service.save_settings({
            "url": "https://example.com/v1/",
            "model": "test-model",
            "temperature": 0.7,
            "apiKey": "secret-value",
        })
        saved = self.service.settings_path.read_text(encoding="utf-8")
        self.assertNotIn("secret-value", saved)
        self.assertEqual(self.secret_store.value, "secret-value")
        self.assertTrue(result["hasKey"])
        self.assertEqual(result["url"], "https://example.com/v1")

    def test_public_http_endpoint_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "公网 http"):
            self.service.save_settings({"url": "http://example.com/v1", "model": "test-model"})
        with self.assertRaisesRegex(ValueError, "公网 http"):
            self.service.save_settings({"url": "http://8.8.8.8/v1", "model": "test-model"})

    def test_local_and_private_http_endpoints_are_allowed(self) -> None:
        for url in ["http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://[::1]:8000/v1", "http://192.168.1.10:8080/v1"]:
            result = self.service.save_settings({"url": url, "model": "llama3", "apiKey": "local-secret"})
            self.assertEqual(result["url"], url)
        self.assertTrue(self.service.get_settings()["hasKey"])

    def test_clear_key_removes_saved_credential(self) -> None:
        self.service.save_settings({"url": "https://example.com/v1", "model": "test-model", "apiKey": "secret-value"})
        result = self.service.clear_key()
        self.assertEqual(self.secret_store.value, "")
        self.assertFalse(result["hasKey"])

    def test_save_settings_clear_key_flag_removes_credential(self) -> None:
        self.secret_store.value = "saved-secret"
        result = self.service.save_settings({"url": "https://example.com/v1", "model": "test-model", "apiKey": "ignored", "clearKey": True})
        self.assertEqual(self.secret_store.value, "")
        self.assertFalse(result["hasKey"])

    def test_openai_compatible_endpoint_is_normalized(self) -> None:
        self.assertEqual(AiService._endpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions")
        self.assertEqual(AiService._endpoint("https://host.example"), "https://host.example/v1/chat/completions")
        self.assertEqual(AiService._endpoint("https://host.example/chat/completions"), "https://host.example/chat/completions")

    def test_models_endpoint_is_normalized(self) -> None:
        self.assertEqual(AiService._models_endpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/models")
        self.assertEqual(AiService._models_endpoint("https://host.example"), "https://host.example/v1/models")
        self.assertEqual(AiService._models_endpoint("https://host.example/v1/chat/completions"), "https://host.example/v1/models")
        self.assertEqual(AiService._models_endpoint("https://host.example/v1/models?ignored=true"), "https://host.example/v1/models")

    def test_model_discovery_classifies_and_recommends_agent_models(self) -> None:
        self.secret_store.value = "saved-secret"
        response = {"data": [
            {"id": "text-embedding-3-large"},
            {"id": "custom-model"},
            {"id": "gpt-5-mini", "context_window": 400000},
            {"id": "o3", "context_window": 200000},
            {"id": "qwen-vl-max", "capabilities": {"tools": True, "vision": True, "structured_output": True}},
        ]}
        with patch.object(self.service, "_request_json", return_value=response) as request_json:
            result = self.service.discover_models({"url": "https://example.com/v1"})
        request = request_json.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.com/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer saved-secret")
        self.assertEqual(result["source"], "upstream")
        self.assertEqual(result["recommendedModelId"], "gpt-5-mini")
        by_id = {model["id"]: model for model in result["models"]}
        self.assertEqual(by_id["gpt-5-mini"]["category"], "fast")
        self.assertEqual(by_id["o3"]["category"], "reasoning")
        self.assertEqual(by_id["qwen-vl-max"]["category"], "vision")
        self.assertNotIn("saved-secret", json.dumps(result))

    def test_discovery_prefers_temporary_key_without_saving_it(self) -> None:
        self.secret_store.value = "saved-secret"
        with patch.object(self.service, "_request_json", return_value={"data": [{"id": "gpt-4.1"}]}) as request_json:
            self.service.discover_models({"url": "https://example.com/v1", "apiKey": "temporary-secret"})
        self.assertEqual(request_json.call_args.args[0].get_header("Authorization"), "Bearer temporary-secret")
        self.assertEqual(self.secret_store.value, "saved-secret")

    def test_discovery_failures_fall_back_to_builtin_catalog(self) -> None:
        failures = [
            TimeoutError("timeout"),
            HTTPError("https://example.com/v1/models", 500, "error", {}, io.BytesIO(b"error")),
            json.JSONDecodeError("bad json", "x", 0),
            None,
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__ if failure else "empty"):
                result_or_error = failure if failure is not None else {"data": []}
                with patch.object(self.service, "_request_json", side_effect=failure if failure is not None else None, return_value=result_or_error):
                    result = self.service.discover_models({"url": "https://example.com/v1"})
                self.assertEqual(result["source"], "builtin")
                self.assertTrue(result["models"])
                self.assertIn("手动输入", result["warning"])
                if isinstance(failure, HTTPError):
                    failure.close()

    def test_plan_schema_rejects_unsupported_operations(self) -> None:
        content = json.dumps({"summary": "bad", "operations": [{"type": "delete_project"}]})
        with self.assertRaisesRegex(ValueError, "不受支持"):
            AiService._parse_plan(content)

    def test_plan_schema_accepts_structured_block_changes(self) -> None:
        content = json.dumps({
            "summary": "补写剧情",
            "assumptions": ["沿用当前角色"],
            "operations": [{"type": "add_blocks", "fragmentId": "opening", "blocks": [{"type": "narration", "text": "夜幕降临。"}]}],
        }, ensure_ascii=False)
        plan = AiService._parse_plan(content)
        self.assertEqual(plan["summary"], "补写剧情")
        self.assertEqual(plan["operations"][0]["blocks"][0]["type"], "narration")

    def test_plan_schema_accepts_extended_confirmable_operations(self) -> None:
        content = json.dumps({"summary": "扩展项目", "operations": [
            {"type": "upsert_character", "name": "林澄", "portraits": {"默认": "portrait"}},
            {"type": "update_asset", "assetId": "portrait", "forceBundle": True},
            {"type": "upsert_variable", "name": "affection", "defaultValue": 0, "valueType": "number", "persistence": "slot"},
            {"type": "update_branch", "fragmentId": "opening", "blockId": "choice", "title": "选择", "options": [{"text": "留下", "target": "opening"}]},
        ]}, ensure_ascii=False)
        plan = self.service._parse_plan(content)
        self.assertEqual([operation["type"] for operation in plan["operations"]], ["upsert_character", "update_asset", "upsert_variable", "update_branch"])

    def test_agent_runs_tools_and_returns_confirmable_patch_and_build(self) -> None:
        class FakeProvider:
            def __init__(self) -> None:
                self.calls = 0

            def complete(self, messages, tools):
                self.calls += 1
                if self.calls == 1:
                    raw_calls = [
                        {"id": "read", "type": "function", "function": {"name": "get_project_overview", "arguments": "{}"}},
                        {"id": "edit", "type": "function", "function": {"name": "propose_add_blocks", "arguments": '{"fragmentId":"opening","blocks":[{"type":"narration","text":"新内容"}]}' }},
                        {"id": "build", "type": "function", "function": {"name": "request_build", "arguments": '{"target":"web"}'}},
                    ]
                    return ProviderResponse("", [
                        ProviderToolCall("read", "get_project_overview", {}),
                        ProviderToolCall("edit", "propose_add_blocks", {"fragmentId": "opening", "blocks": [{"type": "narration", "text": "新内容"}]}),
                        ProviderToolCall("build", "request_build", {"target": "web"}),
                    ], {"prompt_tokens": 10}, {"role": "assistant", "content": "", "tool_calls": raw_calls})
                return ProviderResponse('{"summary":"补写并构建","assumptions":[],"operations":[]}', [], {"completion_tokens": 5}, {"role": "assistant", "content": '{"summary":"补写并构建","assumptions":[],"operations":[]}'})

        provider = FakeProvider()
        self.secret_store.value = "secret"
        self.service.provider_factory = lambda settings, key: provider
        plan = self.service.run("补写片段并构建 Web", sample_project())
        self.assertEqual(plan["operations"][0]["type"], "add_blocks")
        self.assertEqual(plan["requestedBuilds"][0]["target"], "web")
        self.assertEqual(len(plan["toolCalls"]), 3)
        self.assertEqual(plan["usage"], {"prompt_tokens": 10, "completion_tokens": 5})

    def test_agent_forwards_streamed_text_as_incremental_progress(self) -> None:
        class StreamingProvider:
            def complete(self, messages, tools, on_delta=None, cancellation=None):
                content = '{"summary":"流式完成","assumptions":[],"operations":[]}'
                on_delta(content[:18])
                on_delta(content[18:])
                return ProviderResponse(content, [], {}, {"role": "assistant", "content": content})

        self.secret_store.value = "secret"
        self.service.provider_factory = lambda settings, key: StreamingProvider()
        events: list[tuple[str, dict]] = []
        plan = self.service.run("流式生成", sample_project(), progress=lambda kind, message, data=None: events.append((kind, data or {})))
        deltas = [event[1]["delta"] for event in events if event[0] == "text_delta"]
        self.assertEqual("".join(deltas), '{"summary":"流式完成","assumptions":[],"operations":[]}')
        self.assertEqual(plan["summary"], "流式完成")

    def test_agent_resumes_after_completed_tool_without_invoking_it_again(self) -> None:
        raw_call = {"id": "read", "type": "function", "function": {"name": "get_project_overview", "arguments": "{}"}}

        class PausingProvider:
            def __init__(self) -> None:
                self.calls = 0

            def complete(self, messages, tools):
                self.calls += 1
                if self.calls == 1:
                    return ProviderResponse("", [ProviderToolCall("read", "get_project_overview", {})], {}, {"role": "assistant", "content": "", "tool_calls": [raw_call]})
                raise ProviderRequestCancelled("paused")

        class ResumingProvider:
            def __init__(self) -> None:
                self.messages: list[dict] = []

            def complete(self, messages, tools):
                self.messages = messages
                content = '{"summary":"检查点恢复成功","assumptions":[],"operations":[]}'
                return ProviderResponse(content, [], {}, {"role": "assistant", "content": content})

        self.secret_store.value = "secret"
        checkpoints: list[dict] = []
        pausing = PausingProvider()
        self.service.provider_factory = lambda settings, key: pausing
        with self.assertRaises(ProviderRequestCancelled):
            self.service.run("读取后暂停", sample_project(), save_execution_checkpoint=checkpoints.append)
        self.assertEqual(len(checkpoints), 1)
        self.assertEqual(checkpoints[0]["registry"]["trace"][0]["name"], "get_project_overview")

        resuming = ResumingProvider()
        self.service.provider_factory = lambda settings, key: resuming
        plan = self.service.run("读取后暂停", sample_project(), execution_checkpoint=checkpoints[0])
        self.assertEqual(plan["summary"], "检查点恢复成功")
        self.assertEqual(len(plan["toolCalls"]), 1)
        self.assertEqual(sum(message.get("role") == "tool" for message in resuming.messages), 1)

    def test_health_probe_removes_unavailable_model_from_recommendation(self) -> None:
        response = {"data": [
            {"id": "gpt-5-mini", "context_window": 400000},
            {"id": "o3", "context_window": 200000},
            {"id": "gpt-4.1", "context_window": 1000000},
        ]}

        class ProbeProvider:
            def __init__(self, model: str) -> None:
                self.model = model

            def probe(self):
                if self.model == "gpt-5-mini":
                    raise ProviderUnavailableError("route unavailable")
                return {"status": "healthy", "latencyMs": 120 if self.model == "o3" else 280, "supportsTools": True, "message": "ok"}

        self.secret_store.value = "secret"
        self.service.provider_factory = lambda settings, key: ProbeProvider(settings["model"])
        with patch.object(self.service, "_request_json", return_value=response):
            result = self.service.discover_models({"url": "https://example.com/v1", "probe": True, "probeLimit": 3})
        by_id = {model["id"]: model for model in result["models"]}
        self.assertEqual(by_id["gpt-5-mini"]["health"], "unavailable")
        self.assertEqual(result["recommendedModelId"], "gpt-4.1")
        self.assertIn("o3", result["fallbackModelIds"])

    def test_agent_fails_over_to_saved_healthy_candidate(self) -> None:
        class UnavailableProvider:
            def complete(self, messages, tools):
                raise ProviderUnavailableError("primary unavailable")

        class WorkingProvider:
            def complete(self, messages, tools):
                content = '{"summary":"回退成功","assumptions":[],"operations":[]}'
                return ProviderResponse(content, [], {}, {"role": "assistant", "content": content})

        self.secret_store.value = "secret"
        self.service.save_settings({"url": "https://example.com/v1", "model": "primary", "fallbackModels": ["healthy", "healthy"], "temperature": 0.2})
        self.service.provider_factory = lambda settings, key: UnavailableProvider() if settings["model"] == "primary" else WorkingProvider()
        plan = self.service.run("检查项目", sample_project())
        self.assertEqual(plan["model"], "healthy")
        self.assertEqual(plan["failoverHistory"][0]["model"], "primary")
        self.assertEqual(plan["summary"], "回退成功")

    def test_saved_fallback_models_are_deduplicated_and_do_not_include_primary(self) -> None:
        result = self.service.save_settings({"url": "https://example.com/v1", "model": "primary", "fallbackModels": ["primary", "backup", "backup", "second"], "temperature": 0.2})
        self.assertEqual(result["fallbackModels"], ["backup", "second"])

    def test_fresh_catalog_and_health_cache_prevent_repeated_requests(self) -> None:
        response = {"data": [{"id": "gpt-5-mini", "context_window": 400000}]}

        class ProbeProvider:
            calls = 0

            def probe(self):
                ProbeProvider.calls += 1
                return {"status": "healthy", "latencyMs": 100, "supportsTools": True, "message": "ok"}

        self.secret_store.value = "secret"
        self.service.provider_factory = lambda settings, key: ProbeProvider()
        with patch.object(self.service, "_request_json", return_value=response) as request_json:
            first = self.service.discover_models({"url": "https://example.com/v1", "probe": True, "probeLimit": 1})
            second = self.service.discover_models({"url": "https://example.com/v1", "probe": True, "probeLimit": 1})
        self.assertEqual(request_json.call_count, 1)
        self.assertEqual(ProbeProvider.calls, 1)
        self.assertFalse(first["catalogCached"])
        self.assertTrue(second["catalogCached"])
        self.assertEqual(second["healthCache"]["cachedHits"], 1)
        self.assertEqual(second["healthCache"]["probed"], 0)

    def test_open_circuit_skips_primary_provider_and_uses_fallback(self) -> None:
        class WorkingProvider:
            def complete(self, messages, tools):
                content = '{"summary":"熔断回退成功","assumptions":[],"operations":[]}'
                return ProviderResponse(content, [], {}, {"role": "assistant", "content": content})

        self.secret_store.value = "secret"
        self.service.save_settings({"url": "https://example.com/v1", "model": "primary", "fallbackModels": ["backup"], "temperature": 0.2})
        self.service.health_cache.record_failure("https://example.com/v1", "secret", "primary")
        self.service.health_cache.record_failure("https://example.com/v1", "secret", "primary")
        created: list[str] = []
        self.service.provider_factory = lambda settings, key: created.append(settings["model"]) or WorkingProvider()
        plan = self.service.run("检查项目", sample_project())
        self.assertEqual(created, ["backup"])
        self.assertEqual(plan["model"], "backup")
        self.assertEqual(plan["failoverHistory"][0]["status"], "circuit_open")

    def test_background_pass_only_rechecks_expired_configured_models(self) -> None:
        class Clock:
            value = 1000.0

            def __call__(self):
                return self.value

        class ProbeProvider:
            calls = 0

            def probe(self):
                ProbeProvider.calls += 1
                return {"status": "healthy", "latencyMs": 80, "supportsTools": True, "message": "ok"}

        clock = Clock()
        self.service.health_cache = ModelHealthCache(Path(self.temporary.name) / "settings" / "background-health.json", clock, ttl_seconds=600)
        self.secret_store.value = "secret"
        self.service.save_settings({"url": "https://example.com/v1", "model": "primary", "fallbackModels": [], "temperature": 0.2})
        self.service.health_cache.record_success("https://example.com/v1", "secret", "primary")
        self.service.provider_factory = lambda settings, key: ProbeProvider()
        self.assertEqual(self.service.background_health_pass(), 0)
        clock.value += 601
        self.assertEqual(self.service.background_health_pass(), 1)
        self.assertEqual(ProbeProvider.calls, 1)

    def test_health_monitor_starts_once_and_stops_cleanly(self) -> None:
        self.service.start_health_monitor(interval_seconds=10)
        thread = self.service._monitor_thread
        self.assertIsNotNone(thread)
        self.assertTrue(thread.is_alive())
        self.service.start_health_monitor(interval_seconds=10)
        self.assertIs(self.service._monitor_thread, thread)
        self.service.stop_health_monitor()
        self.assertIsNone(self.service._monitor_thread)
        self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
