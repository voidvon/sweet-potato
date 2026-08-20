package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
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
		if path == "/api/discover/items" && !strings.Contains(response.Body.String(), `"items":[]`) {
			t.Fatalf("%s returned a non-array empty collection: %s", path, response.Body.String())
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

func TestPublicRouteTreeNeverReturnsAdminResources(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	request := httptest.NewRequest(http.MethodGet, "/api/route-resources/public-tree?platform=admin", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"platform":"admin"`) {
		t.Fatal("public route tree exposed admin resources")
	}
}

func TestPublicRouteTreeLocalizesNamesFromAcceptLanguage(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	request := httptest.NewRequest(http.MethodGet, "/api/route-resources/public-tree", nil)
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"name":"Discover"`) {
		t.Fatalf("English route name missing: %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"name":"Image"`) {
		t.Fatalf("updated image route name missing: %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"name":"Video"`) {
		t.Fatalf("updated video route name missing: %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"nameEn"`) {
		t.Fatalf("public route response exposed translation storage: %s", response.Body.String())
	}
	if response.Header().Get("Content-Language") != languageEnglish {
		t.Fatalf("Content-Language = %q", response.Header().Get("Content-Language"))
	}
	if !strings.Contains(response.Header().Get("Vary"), "Accept-Language") {
		t.Fatalf("Vary = %q", response.Header().Get("Vary"))
	}
}

func TestPublicDiscoverCategoriesLocalizeAndFallbackToChinese(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	if _, err := server.store.SaveDiscoverCategory("", map[string]any{"name": "推荐", "nameEn": "Featured"}); err != nil {
		t.Fatalf("create translated category: %v", err)
	}
	if _, err := server.store.SaveDiscoverCategory("", map[string]any{"name": "灵感"}); err != nil {
		t.Fatalf("create fallback category: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/discover/categories", nil)
	request.Header.Set("Accept-Language", "en")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, `"name":"Featured"`) || !strings.Contains(body, `"name":"灵感"`) {
		t.Fatalf("category localization or fallback missing: %s", body)
	}
	if strings.Contains(body, `"nameEn"`) {
		t.Fatalf("public category response exposed translation storage: %s", body)
	}
}
