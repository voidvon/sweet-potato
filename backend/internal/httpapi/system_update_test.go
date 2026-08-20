package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/selfupdate"
)

func TestSystemUpdateCheckRequiresSettingsAccess(t *testing.T) {
	github := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v0.1.55",
			"html_url": "https://github.com/voidvon/sweet-potato/releases/tag/v0.1.55",
			"assets": []map[string]string{
				{"name": "sweet-potato-v0.1.55-linux-amd64.tar.gz", "browser_download_url": githubAssetURLPlaceholder},
				{"name": "SHA256SUMS.txt", "browser_download_url": githubAssetURLPlaceholder},
			},
		})
	}))
	defer github.Close()

	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	server.updater = &selfupdate.Manager{
		CurrentVersion: "0.1.54", Repository: selfupdate.DefaultRepository, APIBaseURL: github.URL,
		Client: github.Client(), GOOS: "linux", GOARCH: "amd64",
	}

	request := httptest.NewRequest(http.MethodGet, "/api/system/update", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d, want %d", response.Code, http.StatusUnauthorized)
	}

	admin, err := server.store.CreateUser("update-admin", "password123", "Update Admin")
	if err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/system/update", nil)
	request.Header.Set("Authorization", "Bearer "+server.tokens.Create(admin.ID, admin.Role, admin.AuthVersion))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("admin status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
}

func TestSystemUpdateRejectsNonAdminMutation(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if _, err := server.store.CreateUser("primary-admin", "password123", "Primary Admin"); err != nil {
		t.Fatal(err)
	}
	user, err := server.store.CreateUser("update-user", "password123", "Update User")
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/system/update", nil)
	request.Header.Set("Authorization", "Bearer "+server.tokens.Create(user.ID, user.Role, user.AuthVersion))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-admin status = %d, want %d: %s", response.Code, http.StatusForbidden, response.Body.String())
	}
}

const githubAssetURLPlaceholder = "https://example.invalid/asset"
