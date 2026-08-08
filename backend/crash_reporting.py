from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import sys
import threading
import time
import traceback
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .version import APP_VERSION


REPORT_SCHEMA_VERSION = 1
MAX_REPORT_BYTES = 1024 * 1024
MAX_TEXT_LENGTH = 24_000
SENSITIVE_KEYS = {
    "apikey", "api_key", "authorization", "credential", "credentials", "password", "secret", "token",
    "project", "projectcontent", "project_content", "scripts", "blocks", "assets", "assetcontent", "asset_content",
    "prompt", "rawprompt", "raw_prompt", "instruction", "messages",
}
AUTH_PATTERN = re.compile(r"(?i)\b(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+")
KEY_PATTERN = re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b")
WINDOWS_USER_PATTERN = re.compile(r"(?i)\b[A-Z]:\\Users\\[^\\\s]+")


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def redact_text(value: str) -> str:
    text = value.replace(str(Path.home()), "%USERPROFILE%")
    text = WINDOWS_USER_PATTERN.sub("%USERPROFILE%", text)
    text = AUTH_PATTERN.sub(r"\1[REDACTED]", text)
    text = KEY_PATTERN.sub("[REDACTED_API_KEY]", text)
    return text[:MAX_TEXT_LENGTH]


def redact_payload(value: Any, *, key: str = "", depth: int = 0) -> Any:
    if depth > 8:
        return "[TRUNCATED]"
    normalized_key = key.replace("-", "_").lower()
    if normalized_key in SENSITIVE_KEYS or any(word in normalized_key for word in ("authorization", "credential", "api_key", "apikey", "password", "secret", "token", "project", "prompt")):
        return "[REDACTED]"
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {str(child_key)[:120]: redact_payload(child, key=str(child_key), depth=depth + 1) for child_key, child in list(value.items())[:200]}
    if isinstance(value, (list, tuple)):
        return [redact_payload(child, key=key, depth=depth + 1) for child in list(value)[:200]]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return redact_text(repr(value))


class CrashReporter:
    def __init__(
        self,
        state_dir: Path,
        *,
        endpoint: str | None = None,
        clock: Callable[[], float] = time.time,
        uploader: Callable[[str, bytes], dict[str, Any]] | None = None,
    ) -> None:
        self.root = state_dir.resolve() / "crash-reports"
        self.pending_dir = self.root / "pending"
        self.sent_dir = self.root / "sent"
        self.endpoint = (endpoint if endpoint is not None else os.getenv("HIKARI_CRASH_REPORT_URL", "")).strip()
        self.clock = clock
        self._uploader = uploader or self._upload
        self._previous_sys_hook: Any = None
        self._previous_thread_hook: Any = None

    def install_global_handlers(self) -> None:
        if self._previous_sys_hook is not None:
            return
        self._previous_sys_hook = sys.excepthook
        self._previous_thread_hook = getattr(threading, "excepthook", None)

        def sys_hook(exc_type: type[BaseException], exc: BaseException, exc_traceback: Any) -> None:
            if not issubclass(exc_type, KeyboardInterrupt):
                self.queue_exception("python", exc_type, exc, exc_traceback)
            self._previous_sys_hook(exc_type, exc, exc_traceback)

        def thread_hook(args: Any) -> None:
            self.queue_exception("python-thread", args.exc_type, args.exc_value, args.exc_traceback, {"thread": getattr(args.thread, "name", "unknown")})
            if self._previous_thread_hook:
                self._previous_thread_hook(args)

        sys.excepthook = sys_hook
        if hasattr(threading, "excepthook"):
            threading.excepthook = thread_hook

    def restore_global_handlers(self) -> None:
        if self._previous_sys_hook is None:
            return
        sys.excepthook = self._previous_sys_hook
        if self._previous_thread_hook is not None and hasattr(threading, "excepthook"):
            threading.excepthook = self._previous_thread_hook
        self._previous_sys_hook = None
        self._previous_thread_hook = None

    def queue_exception(
        self,
        source: str,
        exc_type: type[BaseException],
        exc: BaseException,
        exc_traceback: Any,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._queue({
            "source": source,
            "kind": exc_type.__name__,
            "message": str(exc),
            "stack": "".join(traceback.format_exception(exc_type, exc, exc_traceback)),
            "context": context or {},
        })

    def queue_frontend(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._queue({
            "source": str(payload.get("source") or "react"),
            "kind": str(payload.get("kind") or "FrontendError"),
            "message": str(payload.get("message") or "Unknown frontend error"),
            "stack": str(payload.get("stack") or ""),
            "context": payload.get("context") if isinstance(payload.get("context"), dict) else {},
        })

    def list_reports(self) -> dict[str, Any]:
        reports: list[dict[str, Any]] = []
        for path in sorted(self.pending_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True) if self.pending_dir.is_dir() else []:
            try:
                report = json.loads(path.read_text(encoding="utf-8"))
                reports.append(self._summary(report))
            except (OSError, json.JSONDecodeError):
                continue
        return {"uploadConfigured": self.endpoint.startswith("https://") or self.endpoint.startswith("http://127.0.0.1"), "reports": reports}

    def get_report(self, report_id: str) -> dict[str, Any]:
        path = self._report_path(report_id)
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise ValueError("Crash report was not found") from exc
        if not isinstance(value, dict) or value.get("schemaVersion") != REPORT_SCHEMA_VERSION:
            raise ValueError("Crash report is invalid")
        return value

    def delete_report(self, report_id: str) -> bool:
        self._report_path(report_id).unlink(missing_ok=True)
        return True

    def submit(self, report_id: str, *, confirmed: bool) -> dict[str, Any]:
        if not confirmed:
            return {"ok": False, "error": {"code": "CRASH_CONSENT_REQUIRED", "message": "发送崩溃报告前需要用户确认"}}
        if not (self.endpoint.startswith("https://") or self.endpoint.startswith("http://127.0.0.1")):
            return {"ok": False, "error": {"code": "CRASH_UPLOAD_NOT_CONFIGURED", "message": "崩溃报告服务尚未配置"}}
        report = self.get_report(report_id)
        encoded = json.dumps(report, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_REPORT_BYTES:
            raise ValueError("Crash report exceeds the 1 MB limit")
        result = self._uploader(self.endpoint, encoded)
        self.sent_dir.mkdir(parents=True, exist_ok=True)
        source = self._report_path(report_id)
        destination = self.sent_dir / source.name
        os.replace(source, destination)
        self._retain_sent_reports(20)
        return {"ok": True, "reportId": report_id, "remoteId": result.get("id") if isinstance(result, dict) else None}

    def _queue(self, raw: dict[str, Any]) -> dict[str, Any]:
        now = self.clock()
        sanitized = redact_payload(raw)
        fingerprint_source = f"{sanitized.get('source')}\n{sanitized.get('kind')}\n{sanitized.get('message')}\n{sanitized.get('stack')}"
        fingerprint = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()[:20]
        duplicate = self._recent_duplicate(fingerprint, now)
        if duplicate:
            return duplicate
        report_id = uuid.uuid4().hex
        report = {
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "id": report_id,
            "fingerprint": fingerprint,
            "createdAt": _iso(now),
            "createdAtEpoch": now,
            "app": {"name": "Hikari Studio", "version": APP_VERSION},
            "system": {"platform": platform.system(), "release": platform.release(), "architecture": platform.machine()},
            **sanitized,
        }
        encoded = json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8")
        if len(encoded) > MAX_REPORT_BYTES:
            report["stack"] = redact_text(str(report.get("stack") or ""))[:8_000]
            report["context"] = {"note": "Context removed to keep the report below 1 MB"}
            encoded = json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8")
        self.pending_dir.mkdir(parents=True, exist_ok=True)
        path = self.pending_dir / f"{report_id}.json"
        temporary = path.with_suffix(".json.tmp")
        temporary.write_bytes(encoded)
        os.replace(temporary, path)
        return self._summary(report)

    def _recent_duplicate(self, fingerprint: str, now: float) -> dict[str, Any] | None:
        if not self.pending_dir.is_dir():
            return None
        for path in sorted(self.pending_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[:10]:
            try:
                report = json.loads(path.read_text(encoding="utf-8"))
                if report.get("fingerprint") == fingerprint and now - float(report.get("createdAtEpoch") or 0) < 30:
                    return self._summary(report)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
        return None

    def _report_path(self, report_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", report_id):
            raise ValueError("Crash report id is invalid")
        return self.pending_dir / f"{report_id}.json"

    @staticmethod
    def _summary(report: dict[str, Any]) -> dict[str, Any]:
        return {key: report.get(key) for key in ("id", "createdAt", "source", "kind", "message", "fingerprint")}

    @staticmethod
    def _upload(endpoint: str, encoded: bytes) -> dict[str, Any]:
        request = urllib.request.Request(endpoint, data=encoded, method="POST", headers={"Content-Type": "application/json", "User-Agent": f"Hikari-Studio/{APP_VERSION}"})
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = response.read(MAX_REPORT_BYTES + 1)
            return json.loads(payload.decode("utf-8")) if payload else {}

    def _retain_sent_reports(self, count: int) -> None:
        paths = sorted(self.sent_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        for path in paths[count:]:
            path.unlink(missing_ok=True)
