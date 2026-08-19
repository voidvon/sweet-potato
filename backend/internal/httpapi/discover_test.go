package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"ai-marketing-go/internal/config"
)

func TestDiscoverPublicEndpointsAllowAnonymousAccess(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	for _, path := range []string{"/api/discover/categories", "/api/discover/items"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d: %s", path, response.Code, http.StatusOK, response.Body.String())
		}
	}
}

func TestDiscoverCountersAllowAnonymousAccess(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	for _, path := range []string{"/api/discover/items/missing/like", "/api/discover/items/missing/view"} {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want %d: %s", path, response.Code, http.StatusNotFound, response.Body.String())
		}
	}
}

func TestAdminDiscoverEndpointsStillRequireAuthentication(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	request := httptest.NewRequest(http.MethodGet, "/api/admin/discover/categories", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
}
