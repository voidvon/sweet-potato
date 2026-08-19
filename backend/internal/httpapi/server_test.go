package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"ai-marketing-go/internal/config"
	"ai-marketing-go/internal/store"
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

func TestEmbeddedStaticFallbackWithoutFrontendBundle(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	for _, path := range []string{"/", "/admin", "/admin/login", "/app/discover"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want %d", path, response.Code, http.StatusNotFound)
		}
		if !bytes.Contains(response.Body.Bytes(), []byte("静态资源未打包")) {
			t.Fatalf("%s does not report the missing frontend bundle", path)
		}
	}
}

func TestLocalFileManagementListsAndDeletesAssets(t *testing.T) {
	dataDir := t.TempDir()
	server, err := New(config.Config{DataDir: dataDir, AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	user, err := server.store.CreateUser("file-admin", "password123", "File Admin")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	group, err := server.store.CreateContentGroup(user.ID, "product", "Files", "", nil)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	filePath := filepath.Join(dataDir, "files", "managed.png")
	if err := os.WriteFile(filePath, []byte("local"), 0o644); err != nil {
		t.Fatalf("write managed file: %v", err)
	}
	asset, err := server.store.CreateContentAsset(store.ContentAsset{
		UserID: user.ID, GroupID: group.ID, ResourceType: "product", Name: "Managed image",
		OriginalFileName: "managed.png", StoredFileName: "managed.png", MimeType: "image/png",
		FileSize: 5, Size: 5, FilePath: filePath, FileURL: "/files/managed.png",
	})
	if err != nil {
		t.Fatalf("create asset: %v", err)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)

	request := httptest.NewRequest(http.MethodGet, "/api/file-management?page=1&pageSize=20&mediaType=image", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var listed struct {
		Items   []store.ManagedFile      `json:"items"`
		Total   int                      `json:"total"`
		Summary store.ManagedFileSummary `json:"summary"`
	}
	decodeJSON(t, response, &listed)
	if listed.Total != 1 || len(listed.Items) != 1 || listed.Items[0].StorageProvider != "local" || listed.Summary.LocalCount != 1 {
		t.Fatalf("unexpected file management response: %+v", listed)
	}

	deleteResponse := requestJSONWithHeaders(t, server, http.MethodPost, "/api/file-management/delete", map[string]string{"id": asset.ID}, token)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d: %s", deleteResponse.Code, http.StatusOK, deleteResponse.Body.String())
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("managed file still exists, stat error: %v", err)
	}
	if _, found, err := server.store.FindContentAsset(asset.ID); err != nil || found {
		t.Fatalf("managed asset still exists: found=%v err=%v", found, err)
	}
}

func requestJSONWithHeaders(t *testing.T, server *Server, method, path string, value any, token string) *httptest.ResponseRecorder {
	t.Helper()
	body := bytes.NewBuffer(nil)
	if err := json.NewEncoder(body).Encode(value); err != nil {
		t.Fatalf("encode request: %v", err)
	}
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}
