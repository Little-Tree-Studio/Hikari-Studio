from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


HEALTH_CACHE_VERSION = 1
DEFAULT_TTL_SECONDS = 10 * 60
CIRCUIT_FAILURE_THRESHOLD = 2
CIRCUIT_BASE_COOLDOWN_SECONDS = 5 * 60
CIRCUIT_MAX_COOLDOWN_SECONDS = 30 * 60


class ModelHealthCache:
    def __init__(self, path: Path, clock: Callable[[], float] = time.time, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        self.path = path.resolve()
        self.clock = clock
        self.ttl_seconds = ttl_seconds
        self._lock = threading.RLock()

    @staticmethod
    def key_fingerprint(api_key: str | None) -> str:
        if not api_key:
            return "anonymous"
        return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]

    def get(self, url: str, api_key: str | None, model_id: str) -> dict[str, Any] | None:
        with self._lock:
            cache = self._load()
            if not self._matches(cache, url, api_key):
                return None
            entry = cache.get("models", {}).get(model_id)
            return dict(entry) if isinstance(entry, dict) else None

    def get_catalog(self, url: str, api_key: str | None) -> dict[str, Any] | None:
        with self._lock:
            cache = self._load()
            if not self._matches(cache, url, api_key):
                return None
            catalog = cache.get("catalog")
            if not isinstance(catalog, dict) or not self.is_fresh(catalog) or not isinstance(catalog.get("models"), list):
                return None
            return {**catalog, "models": [dict(model) for model in catalog["models"] if isinstance(model, dict)]}

    def set_catalog(self, url: str, api_key: str | None, models: list[dict[str, Any]], source: str) -> None:
        now = self.clock()
        public_keys = {"id", "name", "category", "source", "supportsTools", "supportsVision", "supportsStructuredOutput", "contextWindow"}
        catalog = {"source": source, "models": [{key: value for key, value in model.items() if key in public_keys} for model in models], "checkedAtEpoch": now, "lastCheckedAt": self._iso(now)}
        with self._lock:
            cache = self._load()
            if not self._matches(cache, url, api_key):
                cache = {"version": HEALTH_CACHE_VERSION, "url": url, "keyFingerprint": self.key_fingerprint(api_key), "models": {}}
            cache["catalog"] = catalog
            cache["updatedAt"] = self._iso(now)
            self._write(cache)

    def is_fresh(self, entry: dict[str, Any]) -> bool:
        checked_at = entry.get("checkedAtEpoch")
        return isinstance(checked_at, (int, float)) and self.clock() - float(checked_at) < self.ttl_seconds

    def circuit_state(self, url: str, api_key: str | None, model_id: str) -> str:
        entry = self.get(url, api_key, model_id)
        if not entry or entry.get("circuitState") != "open":
            return "closed"
        retry_at = float(entry.get("nextRetryAtEpoch") or 0)
        return "open" if self.clock() < retry_at else "half_open"

    def should_probe(self, url: str, api_key: str | None, model_id: str, force: bool = False) -> bool:
        entry = self.get(url, api_key, model_id)
        if not entry:
            return True
        state = self.circuit_state(url, api_key, model_id)
        if state == "open":
            return False
        return force or state == "half_open" or not self.is_fresh(entry)

    def record_probe(self, url: str, api_key: str | None, model_id: str, probe: dict[str, Any]) -> dict[str, Any]:
        status = str(probe.get("status", "unknown"))
        if status in {"healthy", "degraded"}:
            return self.record_success(url, api_key, model_id, probe)
        return self.record_failure(url, api_key, model_id, str(probe.get("message") or "模型不可用"))

    def record_success(self, url: str, api_key: str | None, model_id: str, probe: dict[str, Any] | None = None) -> dict[str, Any]:
        now = self.clock()
        previous = self.get(url, api_key, model_id) or {}
        probe = probe or {}
        entry = {
            **previous,
            "health": str(probe.get("status") or previous.get("health") or "healthy"),
            "healthScore": probe.get("healthScore", previous.get("healthScore", 100)),
            "latencyMs": probe.get("latencyMs", previous.get("latencyMs")),
            "supportsTools": probe.get("supportsTools", previous.get("supportsTools", True)),
            "healthMessage": str(probe.get("message") or "连接正常，熔断器已关闭"),
            "checkedAtEpoch": now,
            "lastCheckedAt": self._iso(now),
            "failureCount": 0,
            "circuitState": "closed",
            "nextRetryAtEpoch": None,
            "nextRetryAt": None,
        }
        self._set(url, api_key, model_id, entry)
        return entry

    def record_failure(self, url: str, api_key: str | None, model_id: str, message: str = "模型不可用") -> dict[str, Any]:
        now = self.clock()
        previous = self.get(url, api_key, model_id) or {}
        failures = int(previous.get("failureCount") or 0) + 1
        is_open = failures >= CIRCUIT_FAILURE_THRESHOLD
        cooldown = min(CIRCUIT_BASE_COOLDOWN_SECONDS * (2 ** max(0, failures - CIRCUIT_FAILURE_THRESHOLD)), CIRCUIT_MAX_COOLDOWN_SECONDS) if is_open else 0
        retry_at = now + cooldown if is_open else None
        entry = {
            **previous,
            "health": "unavailable",
            "healthScore": 0,
            "healthMessage": message[:160],
            "checkedAtEpoch": now,
            "lastCheckedAt": self._iso(now),
            "failureCount": failures,
            "circuitState": "open" if is_open else "closed",
            "nextRetryAtEpoch": retry_at,
            "nextRetryAt": self._iso(retry_at) if retry_at else None,
        }
        self._set(url, api_key, model_id, entry)
        return entry

    def public_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        return {key: entry.get(key) for key in ("health", "healthScore", "latencyMs", "supportsTools", "healthMessage", "lastCheckedAt", "failureCount", "circuitState", "nextRetryAt")}

    def _set(self, url: str, api_key: str | None, model_id: str, entry: dict[str, Any]) -> None:
        with self._lock:
            cache = self._load()
            if not self._matches(cache, url, api_key):
                cache = {"version": HEALTH_CACHE_VERSION, "url": url, "keyFingerprint": self.key_fingerprint(api_key), "models": {}}
            cache.setdefault("models", {})[model_id] = entry
            cache["updatedAt"] = self._iso(self.clock())
            self._write(cache)

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _write(self, value: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)

    def _matches(self, cache: dict[str, Any], url: str, api_key: str | None) -> bool:
        return cache.get("version") == HEALTH_CACHE_VERSION and cache.get("url") == url and cache.get("keyFingerprint") == self.key_fingerprint(api_key)

    @staticmethod
    def _iso(timestamp: float | None) -> str | None:
        return datetime.fromtimestamp(timestamp, timezone.utc).isoformat() if timestamp is not None else None
