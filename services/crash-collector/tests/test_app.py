from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "postgresql://unused")
os.environ.setdefault("S3_ENDPOINT", "http://unused")
os.environ.setdefault("S3_ACCESS_KEY", "unused")
os.environ.setdefault("S3_SECRET_KEY", "unused")
os.environ.setdefault("ADMIN_TOKEN", "admin-secret")
os.environ.setdefault("IP_HASH_SALT", "test-salt")

from fastapi.testclient import TestClient

from app import Settings, create_app


class FakeRepository:
    def __init__(self) -> None:
        self.reports: dict[str, dict] = {}
        self.rate_limited = False

    def initialize(self): pass
    def health(self): pass
    def is_rate_limited(self, _ip_hash): return self.rate_limited
    def reserve(self, metadata):
        existing = next((item for item in self.reports.values() if item["fingerprint"] == metadata["fingerprint"]), None)
        if existing: return existing["id"], False
        self.reports[metadata["id"]] = {**metadata, "stored": False}
        return metadata["id"], True
    def mark_stored(self, report_id): self.reports[report_id]["stored"] = True
    def delete(self, report_id): self.reports.pop(report_id, None)
    def list_reports(self, limit): return list(self.reports.values())[:limit]


class FakeStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail = False

    def initialize(self): pass
    def health(self): pass
    def put(self, key, body):
        if self.fail: raise OSError("storage down")
        self.objects[key] = body


def report() -> dict:
    return {
        "schemaVersion": 1,
        "id": "a" * 32,
        "fingerprint": "b" * 20,
        "createdAt": "2026-07-30T00:00:00+00:00",
        "createdAtEpoch": 1.0,
        "app": {"name": "Hikari Studio", "version": "0.4.0-beta.1"},
        "system": {"platform": "Windows", "release": "11", "architecture": "AMD64"},
        "source": "react",
        "kind": "RenderError",
        "message": "redacted failure",
        "stack": "stack",
        "context": {},
    }


class CrashCollectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = FakeRepository()
        self.store = FakeStore()
        settings = Settings("unused", "unused", "unused", "unused", "bucket", "admin-secret", "salt")
        self.client = TestClient(create_app(settings, self.repository, self.store))

    def test_health_and_valid_report(self):
        with self.client:
            self.assertEqual(self.client.get("/health").status_code, 200)
            response = self.client.post("/v1/crash-reports", json=report())
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["duplicate"])
        self.assertEqual(len(self.store.objects), 1)

    def test_duplicate_report_is_coalesced(self):
        with self.client:
            self.assertEqual(self.client.post("/v1/crash-reports", json=report()).status_code, 201)
            duplicate = self.client.post("/v1/crash-reports", json=report())
        self.assertEqual(duplicate.status_code, 200)
        self.assertTrue(duplicate.json()["duplicate"])
        self.assertEqual(len(self.store.objects), 1)

    def test_invalid_secret_oversize_rate_limit_and_storage_failure(self):
        secret = report(); secret["message"] = "sk-abcdefghijklmnop"
        with self.client:
            self.assertEqual(self.client.post("/v1/crash-reports", json=secret).status_code, 422)
            self.assertEqual(self.client.post("/v1/crash-reports", content=b"x" * (1024 * 1024 + 1)).status_code, 413)
            streamed = self.client.post("/v1/crash-reports", content=(b"x" * 524_289 for _ in range(2)))
            self.assertEqual(streamed.status_code, 413)
            self.repository.rate_limited = True
            self.assertEqual(self.client.post("/v1/crash-reports", json=report()).status_code, 429)
            self.repository.rate_limited = False
            self.store.fail = True
            self.assertEqual(self.client.post("/v1/crash-reports", json=report()).status_code, 503)
        self.assertEqual(self.repository.reports, {})

    def test_admin_requires_bearer_token(self):
        with self.client:
            self.assertEqual(self.client.get("/v1/admin/crash-reports").status_code, 401)
            response = self.client.get("/v1/admin/crash-reports", headers={"Authorization": "Bearer admin-secret"})
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
