package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ai-marketing-go/internal/config"
)

func TestHealthEndpointPreservesContract(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("missing CORS header")
	}

	var payload struct {
		OK      bool   `json:"ok"`
		Service string `json:"service"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK || payload.Service != "ai-marketing-desktop-server" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestFilesEndpointServesDataDirectory(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/files/missing.txt", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
}
