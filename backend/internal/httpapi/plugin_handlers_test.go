package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"sweet-potato-go/internal/config"
)

func TestPluginManagementPersistsSettingsAndTestsRenderService(t *testing.T) {
	t.Setenv("REMOTION_PLUGIN_DIR", t.TempDir())
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "plugin-test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	admin, err := server.store.CreateUser("plugin-admin", "password123", "Plugin Admin")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	token := server.tokens.Create(admin.ID, admin.Role, admin.AuthVersion)

	update := requestJSONWithHeaders(t, server, http.MethodPut, "/api/admin/plugins/lightweight-marketing-video", map[string]any{
		"enabled":         false,
		"sortOrder":       20,
		"timeoutSeconds":  30,
		"maxConcurrency":  2,
		"templateVersion": "1.1",
	}, token)
	if update.Code != http.StatusOK {
		t.Fatalf("update status = %d, want 200: %s", update.Code, update.Body.String())
	}
	listRequest := httptest.NewRequest(http.MethodGet, "/api/admin/plugins", nil)
	listRequest.Header.Set("Authorization", "Bearer "+token)
	listResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200: %s", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		Plugins []struct {
			Key            string `json:"key"`
			MaxConcurrency int    `json:"maxConcurrency"`
			Runtime        struct {
				Installed bool   `json:"installed"`
				State     string `json:"state"`
			} `json:"runtime"`
		} `json:"plugins"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("decode plugins: %v", err)
	}
	if len(listed.Plugins) != 1 || listed.Plugins[0].Key != "lightweight-marketing-video" || listed.Plugins[0].MaxConcurrency != 2 || listed.Plugins[0].Runtime.Installed || listed.Plugins[0].Runtime.State != "not_installed" {
		t.Fatalf("unexpected plugins: %+v", listed.Plugins)
	}
}

func TestPluginManagementRejectsEnableWhenRuntimeIsNotInstalled(t *testing.T) {
	t.Setenv("REMOTION_PLUGIN_DIR", t.TempDir())
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "plugin-test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	admin, err := server.store.CreateUser("plugin-admin", "password123", "Plugin Admin")
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	token := server.tokens.Create(admin.ID, admin.Role, admin.AuthVersion)
	response := requestJSONWithHeaders(t, server, http.MethodPut, "/api/admin/plugins/lightweight-marketing-video", map[string]any{
		"enabled":         true,
		"sortOrder":       10,
		"timeoutSeconds":  30,
		"maxConcurrency":  1,
		"templateVersion": "1.1",
	}, token)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", response.Code, response.Body.String())
	}
}
