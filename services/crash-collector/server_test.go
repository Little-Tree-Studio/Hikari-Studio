package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeRepository struct {
	mu          sync.Mutex
	reports     map[string]fakeReport
	rateLimited bool
	healthErr   error
	reserveID   string
	reserveBusy bool
}

type fakeReport struct {
	metadata reportMetadata
	stored   bool
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{reports: make(map[string]fakeReport)}
}

func (r *fakeRepository) Health(context.Context) error {
	return r.healthErr
}

func (r *fakeRepository) IsRateLimited(context.Context, string) (bool, error) {
	return r.rateLimited, nil
}

func (r *fakeRepository) Reserve(_ context.Context, metadata reportMetadata) (string, bool, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.reserveBusy {
		return r.reserveID, false, false, nil
	}
	for _, report := range r.reports {
		if report.metadata.Fingerprint == metadata.Fingerprint {
			return report.metadata.ID, false, report.stored, nil
		}
	}
	r.reports[metadata.ID] = fakeReport{metadata: metadata}
	return metadata.ID, true, false, nil
}

func (r *fakeRepository) MarkStored(_ context.Context, reportID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	report := r.reports[reportID]
	report.stored = true
	r.reports[reportID] = report
	return nil
}

func (r *fakeRepository) Delete(_ context.Context, reportID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.reports, reportID)
	return nil
}

func (r *fakeRepository) ListReports(_ context.Context, limit int, offset int) ([]storedReport, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	stored := make([]storedReport, 0)
	for _, report := range r.reports {
		if !report.stored {
			continue
		}
		stored = append(stored, storedReport{
			ID:              report.metadata.ID,
			Fingerprint:     report.metadata.Fingerprint,
			AppVersion:      report.metadata.AppVersion,
			Source:          report.metadata.Source,
			Kind:            report.metadata.Kind,
			Message:         report.metadata.Message,
			ObjectKey:       report.metadata.ObjectKey,
			SizeBytes:       report.metadata.SizeBytes,
			ClientCreatedAt: time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC),
			ReceivedAt:      time.Date(2026, 7, 30, 0, 1, 0, 0, time.UTC),
		})
	}
	if offset >= len(stored) {
		return []storedReport{}, nil
	}
	end := offset + limit
	if end > len(stored) {
		end = len(stored)
	}
	return stored[offset:end], nil
}

func (r *fakeRepository) CountReports(_ context.Context) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, report := range r.reports {
		if report.stored {
			count++
		}
	}
	return count, nil
}

func (r *fakeRepository) CleanupExpired(_ context.Context, before time.Time) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	keys := make([]string, 0)
	for id, report := range r.reports {
		if report.metadata.ClientCreatedAt < before.Format(time.RFC3339) {
			keys = append(keys, report.metadata.ObjectKey)
			delete(r.reports, id)
		}
	}
	return keys, nil
}

type fakeStore struct {
	objects   map[string][]byte
	fail      bool
	healthErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{objects: make(map[string][]byte)}
}

func (s *fakeStore) Health(context.Context) error {
	return s.healthErr
}

func (s *fakeStore) Put(_ context.Context, key string, body []byte) error {
	if s.fail {
		return errors.New("storage down")
	}
	s.objects[key] = bytes.Clone(body)
	return nil
}

func (s *fakeStore) DeleteMany(_ context.Context, keys []string) error {
	for _, key := range keys {
		delete(s.objects, key)
	}
	return nil
}

func validReport() map[string]any {
	return map[string]any{
		"schemaVersion":  1,
		"id":             strings.Repeat("a", 32),
		"fingerprint":    strings.Repeat("b", 20),
		"createdAt":      "2026-07-30T00:00:00+00:00",
		"createdAtEpoch": 1.0,
		"app":            map[string]any{"name": "Slide Studio", "version": "0.4.0-beta.1"},
		"system":         map[string]any{"platform": "Windows", "release": "11", "architecture": "AMD64"},
		"source":         "react",
		"kind":           "RenderError",
		"message":        "redacted failure",
		"stack":          "stack",
		"context":        map[string]any{},
	}
}

func testServer() (http.Handler, *fakeRepository, *fakeStore) {
	repository := newFakeRepository()
	store := newFakeStore()
	handler := newServer(settings{adminToken: "admin-secret", ipHashSalt: "salt", retentionDays: 180}, repository, store)
	return handler, repository, store
}

func requestJSON(t *testing.T, handler http.Handler, method, path string, payload any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	if payload != nil {
		if err := json.NewEncoder(&body).Encode(payload); err != nil {
			t.Fatal(err)
		}
	}
	request := httptest.NewRequest(method, path, &body)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestHealthAndValidReport(t *testing.T) {
	handler, _, store := testServer()
	health := requestJSON(t, handler, http.MethodGet, "/health", nil, nil)
	if health.Code != http.StatusOK {
		t.Fatalf("health status = %d, body = %s", health.Code, health.Body.String())
	}

	response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", validReport(), nil)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", response.Code, response.Body.String())
	}
	if len(store.objects) != 1 {
		t.Fatalf("stored objects = %d, want 1", len(store.objects))
	}
	for key := range store.objects {
		if !strings.HasSuffix(key, "/"+strings.Repeat("a", 32)+".json") {
			t.Fatalf("unexpected object key %q", key)
		}
	}
}

func TestDuplicateReportIsCoalesced(t *testing.T) {
	handler, _, store := testServer()
	if response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", validReport(), nil); response.Code != http.StatusCreated {
		t.Fatalf("first create status = %d", response.Code)
	}
	response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", validReport(), nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"duplicate":true`) {
		t.Fatalf("duplicate response = %d %s", response.Code, response.Body.String())
	}
	if len(store.objects) != 1 {
		t.Fatalf("stored objects = %d, want 1", len(store.objects))
	}
}

func TestReportValidationAndLimits(t *testing.T) {
	handler, repository, store := testServer()

	secret := validReport()
	secret["message"] = "sk-abcdefghijklmnop"
	if response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", secret, nil); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("secret status = %d", response.Code)
	}
	escapedBody := strings.Replace(mustJSON(t, validReport()), "redacted failure", `sk-\u0061bcdefghijklmnop`, 1)
	escapedRequest := httptest.NewRequest(http.MethodPost, "/v1/crash-reports", strings.NewReader(escapedBody))
	escapedResponse := httptest.NewRecorder()
	handler.ServeHTTP(escapedResponse, escapedRequest)
	if escapedResponse.Code != http.StatusUnprocessableEntity {
		t.Fatalf("escaped secret status = %d", escapedResponse.Code)
	}
	redacted := validReport()
	redacted["message"] = "Authorization: [REDACTED]"
	if response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", redacted, nil); response.Code != http.StatusCreated {
		t.Fatalf("redacted credential status = %d, body = %s", response.Code, response.Body.String())
	}

	handler, repository, store = testServer()

	unknown := validReport()
	unknown["unexpected"] = true
	if response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", unknown, nil); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown field status = %d", response.Code)
	}

	oversized := httptest.NewRequest(http.MethodPost, "/v1/crash-reports", strings.NewReader(strings.Repeat("x", maxReportBytes+1)))
	oversized.Header.Del("Content-Length")
	oversized.ContentLength = -1
	oversizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(oversizedResponse, oversized)
	if oversizedResponse.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("streamed oversize status = %d", oversizedResponse.Code)
	}

	repository.rateLimited = true
	rateLimited := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", validReport(), nil)
	if rateLimited.Code != http.StatusTooManyRequests || rateLimited.Header().Get("Retry-After") != "3600" {
		t.Fatalf("rate limit response = %d, Retry-After = %q", rateLimited.Code, rateLimited.Header().Get("Retry-After"))
	}
	repository.rateLimited = false
	store.fail = true
	if response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", validReport(), nil); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("storage failure status = %d", response.Code)
	}
	if len(repository.reports) != 0 {
		t.Fatalf("reservations after failure = %d, want 0", len(repository.reports))
	}
}

func TestPendingDuplicateIsRetryable(t *testing.T) {
	handler, repository, _ := testServer()
	repository.reserveBusy = true
	repository.reserveID = strings.Repeat("c", 32)
	response := requestJSON(t, handler, http.MethodPost, "/v1/crash-reports", validReport(), nil)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "storage in progress") {
		t.Fatalf("pending duplicate response = %d %s", response.Code, response.Body.String())
	}
}

func TestInvalidUTF8IsRejected(t *testing.T) {
	handler, _, _ := testServer()
	body := []byte(mustJSON(t, validReport()))
	body = bytes.Replace(body, []byte("redacted failure"), []byte{'b', 'a', 'd', 0xff}, 1)
	request := httptest.NewRequest(http.MethodPost, "/v1/crash-reports", bytes.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid UTF-8 status = %d", response.Code)
	}
}

func TestAdminRequiresBearerTokenAndClampsLimit(t *testing.T) {
	handler, _, _ := testServer()
	if response := requestJSON(t, handler, http.MethodGet, "/v1/admin/crash-reports", nil, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", response.Code)
	}
	response := requestJSON(t, handler, http.MethodGet, "/v1/admin/crash-reports?limit=999", nil, map[string]string{"Authorization": "Bearer admin-secret"})
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"reports"`) {
		t.Fatalf("admin response = %d %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"total"`) {
		t.Fatalf("admin response missing total: %s", response.Body.String())
	}
}

func TestAdminListSupportsOffsetAndTotal(t *testing.T) {
	handler, repository, _ := testServer()
	for index := 0; index < 3; index++ {
		metadata := reportMetadata{
			ID:              strings.Repeat(string(rune('a'+index)), 32),
			Fingerprint:     strings.Repeat(string(rune('b'+index)), 20),
			AppVersion:      "0.4.0-beta.1",
			Source:          "react",
			Kind:            "RenderError",
			Message:         "redacted failure",
			ObjectKey:       "reports/report.json",
			SizeBytes:       100,
			IPHash:          "hash",
			ClientCreatedAt: "2026-07-30T00:00:00+00:00",
		}
		repository.mu.Lock()
		repository.reports[metadata.ID] = fakeReport{metadata: metadata, stored: true}
		repository.mu.Unlock()
	}
	response := requestJSON(t, handler, http.MethodGet, "/v1/admin/crash-reports?limit=2&offset=1", nil, map[string]string{"Authorization": "Bearer admin-secret"})
	if response.Code != http.StatusOK {
		t.Fatalf("admin response = %d", response.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode admin response: %v", err)
	}
	if int(payload["total"].(float64)) != 3 || int(payload["offset"].(float64)) != 1 || len(payload["reports"].([]any)) != 2 {
		t.Fatalf("unexpected pagination payload: %v", payload)
	}
}

func TestAdminCleanupRemovesExpiredReportsAndObjects(t *testing.T) {
	handler, repository, store := testServer()
	metadata := reportMetadata{
		ID:              strings.Repeat("e", 32),
		Fingerprint:     strings.Repeat("f", 20),
		AppVersion:      "0.4.0-beta.1",
		Source:          "react",
		Kind:            "RenderError",
		Message:         "redacted failure",
		ObjectKey:       "reports/old.json",
		SizeBytes:       100,
		IPHash:          "hash",
		ClientCreatedAt: "2020-01-01T00:00:00+00:00",
	}
	repository.mu.Lock()
	repository.reports[metadata.ID] = fakeReport{metadata: metadata, stored: true}
	repository.mu.Unlock()
	store.objects[metadata.ObjectKey] = []byte("{}")

	response := requestJSON(t, handler, http.MethodPost, "/v1/admin/crash-reports/cleanup?olderThanDays=30", nil, map[string]string{"Authorization": "Bearer admin-secret"})
	if response.Code != http.StatusOK {
		t.Fatalf("cleanup response = %d %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode cleanup response: %v", err)
	}
	if int(payload["removed"].(float64)) != 1 {
		t.Fatalf("cleanup removed = %v", payload["removed"])
	}
	if _, exists := store.objects[metadata.ObjectKey]; exists {
		t.Fatalf("expired object was not deleted")
	}
}

func TestCleanupRequiresAdminToken(t *testing.T) {
	handler, _, _ := testServer()
	if response := requestJSON(t, handler, http.MethodPost, "/v1/admin/crash-reports/cleanup", nil, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized cleanup status = %d", response.Code)
	}
}

func TestHealthFailure(t *testing.T) {
	handler, repository, _ := testServer()
	repository.healthErr = errors.New("database down")
	response := requestJSON(t, handler, http.MethodGet, "/health", nil, nil)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "storage unavailable") {
		t.Fatalf("health failure response = %d %s", response.Code, response.Body.String())
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
