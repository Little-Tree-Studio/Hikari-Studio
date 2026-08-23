package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type reportMetadata struct {
	ID              string
	Fingerprint     string
	AppVersion      string
	Source          string
	Kind            string
	Message         string
	ObjectKey       string
	SizeBytes       int
	IPHash          string
	ClientCreatedAt string
}

type storedReport struct {
	ID              string    `json:"id"`
	Fingerprint     string    `json:"fingerprint"`
	AppVersion      string    `json:"app_version"`
	Source          string    `json:"source"`
	Kind            string    `json:"kind"`
	Message         string    `json:"message"`
	ObjectKey       string    `json:"object_key"`
	SizeBytes       int       `json:"size_bytes"`
	ClientCreatedAt time.Time `json:"-"`
	ReceivedAt      time.Time `json:"-"`
}

type repository interface {
	Health(context.Context) error
	IsRateLimited(context.Context, string) (bool, error)
	Reserve(context.Context, reportMetadata) (string, bool, bool, error)
	MarkStored(context.Context, string) error
	Delete(context.Context, string) error
	ListReports(context.Context, int) ([]storedReport, error)
}

type postgresRepository struct {
	pool *pgxpool.Pool
}

func newPostgresRepository(ctx context.Context, databaseURL string) (*postgresRepository, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	return &postgresRepository{pool: pool}, nil
}

func (r *postgresRepository) Close() {
	r.pool.Close()
}

func (r *postgresRepository) Initialize(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `
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
	`)
	if err != nil {
		return fmt.Errorf("initialize crash_reports table: %w", err)
	}
	if _, err := r.pool.Exec(ctx, "CREATE INDEX IF NOT EXISTS crash_reports_ip_received_idx ON crash_reports (ip_hash, received_at DESC)"); err != nil {
		return fmt.Errorf("initialize crash report index: %w", err)
	}
	return nil
}

func (r *postgresRepository) Health(ctx context.Context) error {
	if err := r.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping PostgreSQL: %w", err)
	}
	return nil
}

func (r *postgresRepository) IsRateLimited(ctx context.Context, ipHash string) (bool, error) {
	var count int
	err := r.pool.QueryRow(ctx, "SELECT COUNT(*) FROM crash_reports WHERE ip_hash = $1 AND received_at >= NOW() - INTERVAL '1 hour'", ipHash).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check crash report rate limit: %w", err)
	}
	return count >= 5, nil
}

func (r *postgresRepository) Reserve(ctx context.Context, metadata reportMetadata) (string, bool, bool, error) {
	var reportID string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO crash_reports
			(id, fingerprint, app_version, source, kind, message, object_key, size_bytes, ip_hash, client_created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (fingerprint) DO NOTHING
		RETURNING id
	`, metadata.ID, metadata.Fingerprint, metadata.AppVersion, metadata.Source, metadata.Kind, metadata.Message, metadata.ObjectKey, metadata.SizeBytes, metadata.IPHash, metadata.ClientCreatedAt).Scan(&reportID)
	if err == nil {
		return reportID, true, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, false, fmt.Errorf("reserve crash report: %w", err)
	}

	var stored bool
	err = r.pool.QueryRow(ctx, "SELECT id, stored FROM crash_reports WHERE fingerprint = $1", metadata.Fingerprint).Scan(&reportID, &stored)
	if err != nil {
		return "", false, false, fmt.Errorf("reserve crash report: %w", err)
	}
	return reportID, false, stored, nil
}

func (r *postgresRepository) MarkStored(ctx context.Context, reportID string) error {
	if _, err := r.pool.Exec(ctx, "UPDATE crash_reports SET stored = TRUE WHERE id = $1", reportID); err != nil {
		return fmt.Errorf("mark crash report stored: %w", err)
	}
	return nil
}

func (r *postgresRepository) Delete(ctx context.Context, reportID string) error {
	if _, err := r.pool.Exec(ctx, "DELETE FROM crash_reports WHERE id = $1", reportID); err != nil {
		return fmt.Errorf("delete crash report reservation: %w", err)
	}
	return nil
}

func (r *postgresRepository) ListReports(ctx context.Context, limit int) ([]storedReport, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, fingerprint, app_version, source, kind, message, object_key, size_bytes, client_created_at, received_at
		FROM crash_reports
		WHERE stored = TRUE
		ORDER BY received_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list crash reports: %w", err)
	}
	defer rows.Close()

	reports := make([]storedReport, 0)
	for rows.Next() {
		var report storedReport
		if err := rows.Scan(&report.ID, &report.Fingerprint, &report.AppVersion, &report.Source, &report.Kind, &report.Message, &report.ObjectKey, &report.SizeBytes, &report.ClientCreatedAt, &report.ReceivedAt); err != nil {
			return nil, fmt.Errorf("scan crash report: %w", err)
		}
		reports = append(reports, report)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate crash reports: %w", err)
	}
	return reports, nil
}
