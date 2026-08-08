# Hikari Crash Collector

Self-hosted crash report receiver for Hikari Studio. Reports remain local in the editor until the user reviews the redacted payload and explicitly confirms upload.

```powershell
Copy-Item .env.example .env
docker compose up --build -d
Invoke-RestMethod http://127.0.0.1:8080/health
```

Set `HIKARI_CRASH_REPORT_URL=https://your-host/v1/crash-reports` in the editor deployment environment. Do not expose MinIO or PostgreSQL directly to the internet. Replace every example secret before deployment and terminate TLS at a reverse proxy.

Administrative metadata is available at `GET /v1/admin/crash-reports` with `Authorization: Bearer <ADMIN_TOKEN>`. Report bodies remain in the private S3-compatible bucket.

