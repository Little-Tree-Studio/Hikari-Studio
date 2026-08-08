from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.crash_reporting import CrashReporter, redact_payload, redact_text


class CrashReportingTests(unittest.TestCase):
    def test_redaction_removes_keys_authorization_user_path_and_project_content(self) -> None:
        payload = redact_payload({
            "message": "Authorization: Bearer very-secret-token sk-abcdefghijklmnop at C:\\Users\\paulc\\project",
            "apiKey": "sk-should-never-exist",
            "accessToken": "session-token-value",
            "project": {"scripts": ["private dialogue"]},
            "projectState": {"variables": {"player_name": "private player name"}},
            "prompt": "private agent prompt",
            "safe": {"operation": "save"},
        })
        encoded = json.dumps(payload)
        self.assertNotIn("very-secret-token", encoded)
        self.assertNotIn("abcdefghijklmnop", encoded)
        self.assertNotIn("paulc", encoded.lower())
        self.assertNotIn("private dialogue", encoded)
        self.assertNotIn("private player name", encoded)
        self.assertNotIn("session-token-value", encoded)
        self.assertNotIn("private agent prompt", encoded)
        self.assertEqual(payload["safe"]["operation"], "save")
        self.assertIn("%USERPROFILE%", redact_text("C:\\Users\\someone\\project\\file.json"))

    def test_frontend_report_is_sanitized_before_disk_and_duplicate_is_coalesced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            now = [1000.0]
            reporter = CrashReporter(Path(directory), clock=lambda: now[0])
            first = reporter.queue_frontend({
                "source": "react",
                "kind": "RenderError",
                "message": "Failed with sk-abcdefghijklmnop",
                "stack": "C:\\Users\\paulc\\app.tsx:20",
                "context": {"project": {"scripts": ["private"]}, "component": "Preview"},
            })
            duplicate = reporter.queue_frontend({
                "source": "react",
                "kind": "RenderError",
                "message": "Failed with sk-abcdefghijklmnop",
                "stack": "C:\\Users\\paulc\\app.tsx:20",
                "context": {"project": {"scripts": ["private"]}, "component": "Preview"},
            })
            self.assertEqual(duplicate["id"], first["id"])
            self.assertEqual(len(reporter.list_reports()["reports"]), 1)
            report = reporter.get_report(first["id"])
            encoded = json.dumps(report)
            self.assertNotIn("abcdefghijklmnop", encoded)
            self.assertNotIn("paulc", encoded.lower())
            self.assertNotIn("private", encoded)
            self.assertEqual(report["context"]["component"], "Preview")

    def test_report_is_uploaded_only_after_consent_and_archived_on_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            uploads: list[bytes] = []

            def upload(_endpoint: str, encoded: bytes):
                uploads.append(encoded)
                return {"id": "remote-1"}

            reporter = CrashReporter(Path(directory), endpoint="https://errors.example.com/v1/crash-reports", uploader=upload)
            summary = reporter.queue_frontend({"message": "boom", "stack": "trace"})
            denied = reporter.submit(summary["id"], confirmed=False)
            self.assertFalse(denied["ok"])
            self.assertEqual(uploads, [])
            self.assertEqual(len(reporter.list_reports()["reports"]), 1)

            sent = reporter.submit(summary["id"], confirmed=True)
            self.assertTrue(sent["ok"])
            self.assertEqual(sent["remoteId"], "remote-1")
            self.assertEqual(len(uploads), 1)
            self.assertEqual(reporter.list_reports()["reports"], [])
            self.assertTrue((Path(directory) / "crash-reports" / "sent" / f"{summary['id']}.json").is_file())

    def test_upload_failure_keeps_local_report_for_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            reporter = CrashReporter(Path(directory), endpoint="https://errors.example.com/v1/crash-reports", uploader=lambda _endpoint, _encoded: (_ for _ in ()).throw(OSError("offline")))
            summary = reporter.queue_frontend({"message": "boom"})
            with self.assertRaisesRegex(OSError, "offline"):
                reporter.submit(summary["id"], confirmed=True)
            self.assertEqual(reporter.list_reports()["reports"][0]["id"], summary["id"])

    def test_delete_never_uploads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            reporter = CrashReporter(Path(directory))
            summary = reporter.queue_frontend({"message": "discard me"})
            self.assertTrue(reporter.delete_report(summary["id"]))
            self.assertEqual(reporter.list_reports()["reports"], [])


if __name__ == "__main__":
    unittest.main()
