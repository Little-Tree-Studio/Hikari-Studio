# Slide Crash Collector

Self-hosted crash report receiver for Slide Studio. Reports remain local in the editor until the user reviews the redacted payload and explicitly confirms upload.

The collector is implemented in Go and requires Go 1.26 for local development. Export the variables from `.env.example` with deployment-safe values before running the service:

```powershell
go test ./...
go run .
```

```powershell
Copy-Item .env.example .env
docker compose up --build -d
Invoke-RestMethod http://127.0.0.1:8080/health
```

Set `SLIDE_CRASH_REPORT_URL=https://your-host/v1/crash-reports` in the editor deployment environment. Do not expose MinIO or PostgreSQL directly to the internet. Replace every example secret before deployment and terminate TLS at a reverse proxy.

`S3_SERVER_SIDE_ENCRYPTION` defaults to `AES256` for S3 backends with SSE-S3 configured. The bundled MinIO Compose stack sets it to `none` because it does not include a KMS; protect its data volumes with host-level encryption in production.

Administrative metadata is available at `GET /v1/admin/crash-reports?limit=100&offset=0` with `Authorization: Bearer <ADMIN_TOKEN>` (response includes `total` for pagination). Report bodies remain in the private S3-compatible bucket.

Expired reports (default retention 180 days, override with `RETENTION_DAYS`) are removed automatically at startup; operators can also trigger cleanup manually:

```powershell
Invoke-RestMethod -Method Post `
  -Headers @{ Authorization = "Bearer <ADMIN_TOKEN>" } `
  "http://127.0.0.1:8080/v1/admin/crash-reports/cleanup?olderThanDays=30"
```

