package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const maxReportBytes = 1024 * 1024

var (
	authorizationPattern = regexp.MustCompile(`(?i)authorization[[:space:]]*[:=][[:space:]]*(bearer[[:space:]]+)?([^[:space:]]+)`)
	apiKeyPattern        = regexp.MustCompile(`(?i)\bsk-[A-Za-z0-9_-]{12,}\b`)
	lowerHex32Pattern    = regexp.MustCompile(`^[0-9a-f]{32}$`)
	lowerHex20Pattern    = regexp.MustCompile(`^[0-9a-f]{20}$`)
)

type appDescriptor struct {
	Name    *string `json:"name"`
	Version *string `json:"version"`
}

type systemDescriptor struct {
	Platform     *string `json:"platform"`
	Release      *string `json:"release"`
	Architecture *string `json:"architecture"`
}

type crashReport struct {
	SchemaVersion  *int              `json:"schemaVersion"`
	ID             *string           `json:"id"`
	Fingerprint    *string           `json:"fingerprint"`
	CreatedAt      *string           `json:"createdAt"`
	CreatedAtEpoch *float64          `json:"createdAtEpoch"`
	App            *appDescriptor    `json:"app"`
	System         *systemDescriptor `json:"system"`
	Source         *string           `json:"source"`
	Kind           *string           `json:"kind"`
	Message        *string           `json:"message"`
	Stack          *string           `json:"stack"`
	Context        *map[string]any   `json:"context"`
}

type server struct {
	settings   settings
	repository repository
	store      objectStore
	now        func() time.Time
}

func newServer(settings settings, repository repository, store objectStore) http.Handler {
	return &server{
		settings:   settings,
		repository: repository,
		store:      store,
		now:        time.Now,
	}
}

func (s *server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	switch request.URL.Path {
	case "/health":
		if request.Method != http.MethodGet {
			writeError(response, http.StatusMethodNotAllowed, "Method Not Allowed")
			return
		}
		s.health(response, request)
	case "/v1/crash-reports":
		if request.Method != http.MethodPost {
			writeError(response, http.StatusMethodNotAllowed, "Method Not Allowed")
			return
		}
		s.createReport(response, request)
	case "/v1/admin/crash-reports":
		if request.Method != http.MethodGet {
			writeError(response, http.StatusMethodNotAllowed, "Method Not Allowed")
			return
		}
		s.listReports(response, request)
	default:
		writeError(response, http.StatusNotFound, "Not Found")
	}
}

func (s *server) health(response http.ResponseWriter, request *http.Request) {
	if err := s.repository.Health(request.Context()); err != nil {
		slog.Warn("crash collector health check failed", "error", err)
		writeError(response, http.StatusServiceUnavailable, "storage unavailable")
		return
	}
	if err := s.store.Health(request.Context()); err != nil {
		slog.Warn("crash collector health check failed", "error", err)
		writeError(response, http.StatusServiceUnavailable, "storage unavailable")
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) createReport(response http.ResponseWriter, request *http.Request) {
	if contentLength := request.Header.Get("Content-Length"); contentLength != "" {
		parsed, err := strconv.ParseInt(contentLength, 10, 64)
		if err != nil || parsed < 0 {
			writeError(response, http.StatusBadRequest, "invalid content length")
			return
		}
		if parsed > maxReportBytes {
			writeError(response, http.StatusRequestEntityTooLarge, "report exceeds 1 MB")
			return
		}
	} else if request.ContentLength > maxReportBytes {
		writeError(response, http.StatusRequestEntityTooLarge, "report exceeds 1 MB")
		return
	}

	body, err := io.ReadAll(io.LimitReader(request.Body, maxReportBytes+1))
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(body) > maxReportBytes {
		writeError(response, http.StatusRequestEntityTooLarge, "report exceeds 1 MB")
		return
	}
	if !utf8.Valid(body) {
		writeError(response, http.StatusUnprocessableEntity, "invalid crash report")
		return
	}
	if containsUnredactedCredential(body) {
		writeError(response, http.StatusUnprocessableEntity, "report contains unredacted credentials")
		return
	}

	report, err := decodeCrashReport(body)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "invalid crash report")
		return
	}

	ipHash := sha256.Sum256([]byte(s.settings.ipHashSalt + ":" + clientIP(request)))
	rateLimited, err := s.repository.IsRateLimited(request.Context(), hex.EncodeToString(ipHash[:]))
	if err != nil {
		slog.Error("could not check crash report rate limit", "error", err)
		writeError(response, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if rateLimited {
		response.Header().Set("Retry-After", "3600")
		writeError(response, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	objectKey := fmt.Sprintf("reports/%s/%s.json", s.now().UTC().Format("2006/01/02"), *report.ID)
	metadata := reportMetadata{
		ID:              *report.ID,
		Fingerprint:     *report.Fingerprint,
		AppVersion:      *report.App.Version,
		Source:          *report.Source,
		Kind:            *report.Kind,
		Message:         truncateRunes(*report.Message, 500),
		ObjectKey:       objectKey,
		SizeBytes:       len(body),
		IPHash:          hex.EncodeToString(ipHash[:]),
		ClientCreatedAt: *report.CreatedAt,
	}
	reportID, created, stored, err := s.repository.Reserve(request.Context(), metadata)
	if err != nil {
		slog.Error("could not reserve crash report", "error", err)
		writeError(response, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if !created {
		if !stored {
			writeError(response, http.StatusServiceUnavailable, "report storage in progress")
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{"id": reportID, "duplicate": true})
		return
	}

	if err := s.store.Put(request.Context(), objectKey, body); err != nil {
		s.cleanupReservation(request.Context(), reportID, err)
		writeError(response, http.StatusServiceUnavailable, "report storage failed")
		return
	}
	if err := s.repository.MarkStored(request.Context(), reportID); err != nil {
		s.cleanupReservation(request.Context(), reportID, err)
		writeError(response, http.StatusServiceUnavailable, "report storage failed")
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{"id": reportID, "duplicate": false})
}

func (s *server) cleanupReservation(ctx context.Context, reportID string, storageErr error) {
	slog.Error("could not store crash report", "report_id", reportID, "error", storageErr)
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.repository.Delete(cleanupCtx, reportID); err != nil {
		slog.Error("could not clean up crash report reservation", "report_id", reportID, "error", err)
	}
}

func (s *server) listReports(response http.ResponseWriter, request *http.Request) {
	expected := []byte("Bearer " + s.settings.adminToken)
	provided := []byte(request.Header.Get("Authorization"))
	if subtle.ConstantTimeCompare(provided, expected) != 1 {
		writeError(response, http.StatusUnauthorized, "invalid admin token")
		return
	}

	limit := 100
	if rawLimit := request.URL.Query().Get("limit"); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			writeError(response, http.StatusUnprocessableEntity, "invalid limit")
			return
		}
		limit = parsed
	}
	limit = max(1, min(limit, 500))

	reports, err := s.repository.ListReports(request.Context(), limit)
	if err != nil {
		slog.Error("could not list crash reports", "error", err)
		writeError(response, http.StatusInternalServerError, "Internal Server Error")
		return
	}

	serialized := make([]map[string]any, 0, len(reports))
	for _, report := range reports {
		serialized = append(serialized, map[string]any{
			"id":                report.ID,
			"fingerprint":       report.Fingerprint,
			"app_version":       report.AppVersion,
			"source":            report.Source,
			"kind":              report.Kind,
			"message":           report.Message,
			"object_key":        report.ObjectKey,
			"size_bytes":        report.SizeBytes,
			"client_created_at": formatDatabaseTime(report.ClientCreatedAt),
			"received_at":       formatDatabaseTime(report.ReceivedAt),
		})
	}
	writeJSON(response, http.StatusOK, map[string]any{"reports": serialized})
}

func decodeCrashReport(body []byte) (*crashReport, error) {
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	var report crashReport
	if err := decoder.Decode(&report); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("request contains trailing JSON")
	}
	if err := report.Validate(); err != nil {
		return nil, err
	}
	return &report, nil
}

func (r *crashReport) Validate() error {
	if r.SchemaVersion == nil || *r.SchemaVersion != 1 || r.ID == nil || !lowerHex32Pattern.MatchString(*r.ID) || r.Fingerprint == nil || !lowerHex20Pattern.MatchString(*r.Fingerprint) {
		return errors.New("invalid report identity")
	}
	if r.CreatedAt == nil || runeLength(*r.CreatedAt) > 64 || r.CreatedAtEpoch == nil {
		return errors.New("invalid report timestamp")
	}
	if r.App == nil || r.App.Name == nil || runeLength(*r.App.Name) > 80 || r.App.Version == nil || runeLength(*r.App.Version) > 48 {
		return errors.New("invalid app descriptor")
	}
	if r.System == nil || r.System.Platform == nil || runeLength(*r.System.Platform) > 48 || r.System.Release == nil || runeLength(*r.System.Release) > 120 || r.System.Architecture == nil || runeLength(*r.System.Architecture) > 48 {
		return errors.New("invalid system descriptor")
	}
	if r.Source == nil || runeLength(*r.Source) > 80 || r.Kind == nil || runeLength(*r.Kind) > 120 || r.Message == nil || runeLength(*r.Message) > 24_000 || r.Stack == nil || runeLength(*r.Stack) > 24_000 || r.Context == nil {
		return errors.New("invalid report content")
	}
	return nil
}

func containsUnredactedCredential(body []byte) bool {
	text := string(body)
	if containsCredentialText(text) {
		return true
	}

	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return false
	}
	return containsCredentialValue(value)
}

func containsCredentialValue(value any) bool {
	switch typed := value.(type) {
	case string:
		return containsCredentialText(typed)
	case []any:
		for _, item := range typed {
			if containsCredentialValue(item) {
				return true
			}
		}
	case map[string]any:
		for key, item := range typed {
			if containsCredentialText(key) || containsCredentialValue(item) {
				return true
			}
		}
	}
	return false
}

func containsCredentialText(text string) bool {
	if apiKeyPattern.MatchString(text) {
		return true
	}
	for _, match := range authorizationPattern.FindAllStringSubmatch(text, -1) {
		if len(match) == 3 && !hasRedactedPrefix(match[2]) {
			return true
		}
	}
	return false
}

func hasRedactedPrefix(value string) bool {
	const redacted = "[REDACTED]"
	return len(value) >= len(redacted) && strings.EqualFold(value[:len(redacted)], redacted)
}

func clientIP(request *http.Request) string {
	if forwarded := request.Header.Get("X-Forwarded-For"); forwarded != "" {
		if first, _, ok := strings.Cut(forwarded, ","); ok {
			return strings.TrimSpace(first)
		}
		return strings.TrimSpace(forwarded)
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	if request.RemoteAddr != "" {
		return request.RemoteAddr
	}
	return "unknown"
}

func runeLength(value string) int {
	return utf8.RuneCountInString(value)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func formatDatabaseTime(value time.Time) string {
	value = value.UTC()
	formatted := value.Format("2006-01-02T15:04:05")
	if value.Nanosecond() != 0 {
		formatted += fmt.Sprintf(".%06d", value.Nanosecond()/1000)
	}
	return formatted + "+00:00"
}

func writeError(response http.ResponseWriter, status int, detail string) {
	writeJSON(response, status, map[string]string{"detail": detail})
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	if err := json.NewEncoder(response).Encode(payload); err != nil {
		slog.Error("could not write JSON response", "error", err)
	}
}
