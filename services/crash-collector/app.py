from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

import boto3
import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool


MAX_REPORT_BYTES = 1024 * 1024
SECRET_PATTERN = re.compile(r"(?i)(authorization\s*[:=]\s*(?:bearer\s+)?(?!\[REDACTED\])\S+|\bsk-[A-Za-z0-9_-]{12,}\b)")


@dataclass(frozen=True)
class Settings:
    database_url: str
    s3_endpoint: str
    s3_access_key: str
    s3_secret_key: str
    s3_bucket: str
    admin_token: str
    ip_hash_salt: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=os.environ["DATABASE_URL"],
            s3_endpoint=os.environ["S3_ENDPOINT"],
            s3_access_key=os.environ["S3_ACCESS_KEY"],
            s3_secret_key=os.environ["S3_SECRET_KEY"],
            s3_bucket=os.getenv("S3_BUCKET", "hikari-crash-reports"),
            admin_token=os.environ["ADMIN_TOKEN"],
            ip_hash_salt=os.environ["IP_HASH_SALT"],
        )


class AppDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=80)
    version: str = Field(max_length=48)


class SystemDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: str = Field(max_length=48)
    release: str = Field(max_length=120)
    architecture: str = Field(max_length=48)


class CrashReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: int = Field(ge=1, le=1)
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    fingerprint: str = Field(pattern=r"^[0-9a-f]{20}$")
    createdAt: str = Field(max_length=64)
    createdAtEpoch: float
    app: AppDescriptor
    system: SystemDescriptor
    source: str = Field(max_length=80)
    kind: str = Field(max_length=120)
    message: str = Field(max_length=24_000)
    stack: str = Field(max_length=24_000)
    context: dict[str, Any]


class Repository(Protocol):
    def initialize(self) -> None: ...
    def health(self) -> None: ...
    def is_rate_limited(self, ip_hash: str) -> bool: ...
    def reserve(self, metadata: dict[str, Any]) -> tuple[str, bool]: ...
    def mark_stored(self, report_id: str) -> None: ...
    def delete(self, report_id: str) -> None: ...
    def list_reports(self, limit: int) -> list[dict[str, Any]]: ...


class ObjectStore(Protocol):
    def initialize(self) -> None: ...
    def health(self) -> None: ...
    def put(self, key: str, body: bytes) -> None: ...


class PostgresRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def _connect(self):
        return psycopg.connect(self.database_url)

    def initialize(self) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS crash_reports (
                    id TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL UNIQUE,
                    app_version TEXT NOT NULL,
                    source TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    message TEXT NOT NULL,
                    object_key TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    ip_hash TEXT NOT NULL,
                    client_created_at TIMESTAMPTZ NOT NULL,
                    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    stored BOOLEAN NOT NULL DEFAULT FALSE
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS crash_reports_ip_received_idx ON crash_reports (ip_hash, received_at DESC)")

    def health(self) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()

    def is_rate_limited(self, ip_hash: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM crash_reports WHERE ip_hash = %s AND received_at >= NOW() - INTERVAL '1 hour'", (ip_hash,))
            return int(cursor.fetchone()[0]) >= 5

    def reserve(self, metadata: dict[str, Any]) -> tuple[str, bool]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO crash_reports
                    (id, fingerprint, app_version, source, kind, message, object_key, size_bytes, ip_hash, client_created_at)
                    VALUES (%(id)s, %(fingerprint)s, %(app_version)s, %(source)s, %(kind)s, %(message)s, %(object_key)s, %(size_bytes)s, %(ip_hash)s, %(client_created_at)s)
                    ON CONFLICT (fingerprint) DO NOTHING RETURNING id""",
                metadata,
            )
            created = cursor.fetchone()
            if created:
                return str(created[0]), True
            cursor.execute("SELECT id FROM crash_reports WHERE fingerprint = %s", (metadata["fingerprint"],))
            return str(cursor.fetchone()[0]), False

    def mark_stored(self, report_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("UPDATE crash_reports SET stored = TRUE WHERE id = %s", (report_id,))

    def delete(self, report_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM crash_reports WHERE id = %s", (report_id,))

    def list_reports(self, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, fingerprint, app_version, source, kind, message, object_key, size_bytes, client_created_at, received_at FROM crash_reports WHERE stored = TRUE ORDER BY received_at DESC LIMIT %s",
                (limit,),
            )
            columns = [item.name for item in cursor.description]
            return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


class S3ObjectStore:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name="us-east-1",
        )

    def initialize(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            self.client.create_bucket(Bucket=self.bucket)

    def health(self) -> None:
        self.client.head_bucket(Bucket=self.bucket)

    def put(self, key: str, body: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/json", ServerSideEncryption="AES256")


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return value


def create_app(settings: Settings | None = None, repository: Repository | None = None, object_store: ObjectStore | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_repository = repository or PostgresRepository(resolved_settings.database_url)
    resolved_store = object_store or S3ObjectStore(resolved_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await run_in_threadpool(resolved_repository.initialize)
        await run_in_threadpool(resolved_store.initialize)
        yield

    app = FastAPI(title="Hikari Crash Collector", version="1.0.0", lifespan=lifespan)

    @app.get("/health")
    async def health() -> dict[str, str]:
        try:
            await run_in_threadpool(resolved_repository.health)
            await run_in_threadpool(resolved_store.health)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="storage unavailable") from exc
        return {"status": "ok"}

    @app.post("/v1/crash-reports", status_code=201)
    async def create_report(request: Request) -> JSONResponse:
        try:
            content_length = int(request.headers.get("content-length") or 0)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid content length") from exc
        if content_length < 0:
            raise HTTPException(status_code=400, detail="invalid content length")
        if content_length > MAX_REPORT_BYTES:
            raise HTTPException(status_code=413, detail="report exceeds 1 MB")
        body_buffer = bytearray()
        async for chunk in request.stream():
            if len(body_buffer) + len(chunk) > MAX_REPORT_BYTES:
                raise HTTPException(status_code=413, detail="report exceeds 1 MB")
            body_buffer.extend(chunk)
        body = bytes(body_buffer)
        if SECRET_PATTERN.search(body.decode("utf-8", errors="ignore")):
            raise HTTPException(status_code=422, detail="report contains unredacted credentials")
        try:
            report = CrashReport.model_validate_json(body)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors(include_input=False)) from exc
        client_ip = request.client.host if request.client else "unknown"
        ip_hash = hashlib.sha256(f"{resolved_settings.ip_hash_salt}:{client_ip}".encode("utf-8")).hexdigest()
        if await run_in_threadpool(resolved_repository.is_rate_limited, ip_hash):
            raise HTTPException(status_code=429, detail="rate limit exceeded", headers={"Retry-After": "3600"})
        object_key = f"reports/{datetime.now(timezone.utc):%Y/%m/%d}/{report.id}.json"
        metadata = {
            "id": report.id,
            "fingerprint": report.fingerprint,
            "app_version": report.app.version,
            "source": report.source,
            "kind": report.kind,
            "message": report.message[:500],
            "object_key": object_key,
            "size_bytes": len(body),
            "ip_hash": ip_hash,
            "client_created_at": report.createdAt,
        }
        report_id, created = await run_in_threadpool(resolved_repository.reserve, metadata)
        if not created:
            return JSONResponse({"id": report_id, "duplicate": True}, status_code=200)
        try:
            await run_in_threadpool(resolved_store.put, object_key, body)
            await run_in_threadpool(resolved_repository.mark_stored, report_id)
        except Exception as exc:
            await run_in_threadpool(resolved_repository.delete, report_id)
            raise HTTPException(status_code=503, detail="report storage failed") from exc
        return JSONResponse({"id": report_id, "duplicate": False}, status_code=201)

    @app.get("/v1/admin/crash-reports")
    async def list_reports(request: Request, limit: int = 100) -> dict[str, Any]:
        authorization = request.headers.get("authorization", "")
        expected = f"Bearer {resolved_settings.admin_token}"
        if not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="invalid admin token")
        rows = await run_in_threadpool(resolved_repository.list_reports, max(1, min(limit, 500)))
        return {"reports": [{key: _json_value(value) for key, value in row.items()} for row in rows]}

    return app


app = create_app()
