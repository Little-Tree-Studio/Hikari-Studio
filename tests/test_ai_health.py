from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.ai_health import ModelHealthCache


class MutableClock:
    def __init__(self, value: float = 1000) -> None:
        self.value = value

    def __call__(self) -> float:
        return self.value


class ModelHealthCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.clock = MutableClock()
        self.path = Path(self.temporary.name) / "ai-health.json"
        self.cache = ModelHealthCache(self.path, self.clock, ttl_seconds=600)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_fresh_health_expires_after_ttl_without_storing_the_key(self) -> None:
        self.cache.record_success("https://example.com/v1", "secret-key", "model", {"status": "healthy", "latencyMs": 120, "supportsTools": True})
        entry = self.cache.get("https://example.com/v1", "secret-key", "model")
        self.assertTrue(self.cache.is_fresh(entry))
        self.assertNotIn("secret-key", self.path.read_text(encoding="utf-8"))
        self.clock.value += 601
        self.assertFalse(self.cache.is_fresh(entry))

    def test_cache_is_isolated_by_url_and_key_fingerprint(self) -> None:
        self.cache.record_success("https://one.example/v1", "first", "model")
        self.assertIsNone(self.cache.get("https://two.example/v1", "first", "model"))
        self.assertIsNone(self.cache.get("https://one.example/v1", "second", "model"))

    def test_model_catalog_uses_the_same_ttl(self) -> None:
        self.cache.set_catalog("https://example.com/v1", "secret", [{"id": "model", "name": "Model"}], "upstream")
        self.assertEqual(self.cache.get_catalog("https://example.com/v1", "secret")["models"][0]["id"], "model")
        self.clock.value += 601
        self.assertIsNone(self.cache.get_catalog("https://example.com/v1", "secret"))

    def test_two_failures_open_circuit_and_half_open_recovers(self) -> None:
        self.cache.record_failure("https://example.com/v1", "secret", "model")
        self.assertEqual(self.cache.circuit_state("https://example.com/v1", "secret", "model"), "closed")
        opened = self.cache.record_failure("https://example.com/v1", "secret", "model")
        self.assertEqual(opened["circuitState"], "open")
        self.assertFalse(self.cache.should_probe("https://example.com/v1", "secret", "model"))
        self.clock.value = opened["nextRetryAtEpoch"] + 1
        self.assertEqual(self.cache.circuit_state("https://example.com/v1", "secret", "model"), "half_open")
        self.assertTrue(self.cache.should_probe("https://example.com/v1", "secret", "model"))
        recovered = self.cache.record_success("https://example.com/v1", "secret", "model")
        self.assertEqual(recovered["circuitState"], "closed")
        self.assertEqual(recovered["failureCount"], 0)

    def test_repeated_open_failures_back_off_up_to_the_cap(self) -> None:
        first = self.cache.record_failure("https://example.com/v1", "secret", "model")
        second = self.cache.record_failure("https://example.com/v1", "secret", "model")
        self.clock.value = second["nextRetryAtEpoch"] + 1
        third = self.cache.record_failure("https://example.com/v1", "secret", "model")
        self.assertGreater(third["nextRetryAtEpoch"] - self.clock.value, second["nextRetryAtEpoch"] - 1000)


if __name__ == "__main__":
    unittest.main()
