package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestHealthEndpointPreservesContract(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "http://localhost:9527")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:9527" || response.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("missing CORS header")
	}

	var payload struct {
		OK      bool   `json:"ok"`
		Service string `json:"service"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK || payload.Service != "sweet-potato-server" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestCORSRejectsUnexpectedLocalFrontendPort(t *testing.T) {
	t.Setenv("FRONTEND_PORT", "9527")
	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "http://localhost:9528")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unexpected CORS origin: %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCookieSessionRejectsUnexpectedWriteOrigin(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("csrf-user", "password123", "CSRF User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)
	request := httptest.NewRequest(http.MethodPut, "/api/users/"+user.ID+"/profile", bytes.NewBufferString(`{"displayName":"Updated"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cookie", (&http.Cookie{Name: authCookieName, Value: token}).String())
	request.Header.Set("Origin", "http://localhost:9528")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("unexpected-origin write status = %d, want %d: %s", response.Code, http.StatusForbidden, response.Body.String())
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

func TestConfiguredRateLimitIsAppliedAtHTTPBoundary(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	if _, err := server.store.ReplaceRateLimitRules([]store.RateLimitRule{{URLPattern: `^/api/health$`, MaxRequests: 1, IntervalSeconds: 60, TargetUser: "anonymous"}}); err != nil {
		t.Fatalf("save rate rule: %v", err)
	}
	for index, want := range []int{http.StatusOK, http.StatusTooManyRequests} {
		request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("request %d status = %d, want %d", index+1, response.Code, want)
		}
	}
}

func TestOwnedFilesRequireMatchingSession(t *testing.T) {
	dataDir := t.TempDir()
	server, err := New(config.Config{DataDir: dataDir, AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("file-user", "password123", "File User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	group, err := server.store.CreateContentGroup(user.ID, "product", "Files", "", nil)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	filePath := filepath.Join(dataDir, "files", "owned.txt")
	if err := os.WriteFile(filePath, []byte("private"), 0o600); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if _, err := server.store.CreateContentAsset(store.ContentAsset{UserID: user.ID, GroupID: group.ID, ResourceType: "product", Name: "Private", OriginalFileName: "owned.txt", StoredFileName: "owned.txt", MimeType: "text/plain", FilePath: filePath, FileURL: "/files/owned.txt"}); err != nil {
		t.Fatalf("create asset: %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/files/owned.txt", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("anonymous file status = %d, want %d", response.Code, http.StatusForbidden)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)
	request = httptest.NewRequest(http.MethodGet, "/files/owned.txt", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "private" {
		t.Fatalf("owned file response = %d %q", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("private file cache policy = %q", got)
	}
}

func TestDirectUploadRequiresOwningSession(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	owner, err := server.store.CreateUser("upload-owner", "password123", "Upload Owner")
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	other, err := server.store.CreateUser("upload-other", "password123", "Upload Other")
	if err != nil {
		t.Fatalf("create other user: %v", err)
	}
	intent, err := server.store.CreateFileUploadIntent(store.FileUploadIntent{
		UserID: owner.ID, OriginalFileName: "asset.png", StoredFileName: "upload-asset.png",
		MimeType: "image/png", FileSize: 4, ExpiresAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("create upload intent: %v", err)
	}

	request := httptest.NewRequest(http.MethodPut, "/api/content/assets/direct-upload/upload/"+intent.ID, bytes.NewBufferString("data"))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous upload status = %d, want %d", response.Code, http.StatusUnauthorized)
	}

	request = httptest.NewRequest(http.MethodPut, "/api/content/assets/direct-upload/upload/"+intent.ID, bytes.NewBufferString("data"))
	request.Header.Set("Authorization", "Bearer "+server.tokens.Create(other.ID, other.Role, other.AuthVersion))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign upload status = %d, want %d: %s", response.Code, http.StatusNotFound, response.Body.String())
	}
}

func TestReferenceVideoDeleteRequiresAssetOwnership(t *testing.T) {
	dataDir := t.TempDir()
	server, err := New(config.Config{DataDir: dataDir, AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	owner, err := server.store.CreateUser("reference-owner", "password123", "Reference Owner")
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	other, err := server.store.CreateUser("reference-other", "password123", "Reference Other")
	if err != nil {
		t.Fatalf("create other user: %v", err)
	}
	group, err := server.store.CreateContentGroup(owner.ID, "other", "References", "", nil)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	filePath := filepath.Join(dataDir, "files", "reference.mp4")
	if err := os.WriteFile(filePath, []byte("video"), 0o600); err != nil {
		t.Fatalf("write reference: %v", err)
	}
	asset, err := server.store.CreateContentAsset(store.ContentAsset{
		UserID: owner.ID, GroupID: group.ID, ResourceType: "other", Name: "Reference",
		OriginalFileName: "reference.mp4", StoredFileName: "reference.mp4", MimeType: "video/mp4",
		FilePath: filePath, FileURL: "/files/reference.mp4", LifecycleStatus: "temporary",
	})
	if err != nil {
		t.Fatalf("create reference asset: %v", err)
	}
	path := "/api/content/reference-video"
	otherToken := server.tokens.Create(other.ID, other.Role, other.AuthVersion)
	response := requestJSONWithHeaders(t, server, http.MethodDelete, path, map[string]string{"storedFileName": asset.StoredFileName}, otherToken)
	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign delete status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("foreign delete removed file: %v", err)
	}

	ownerToken := server.tokens.Create(owner.ID, owner.Role, owner.AuthVersion)
	response = requestJSONWithHeaders(t, server, http.MethodDelete, path, map[string]string{"assetId": asset.ID}, ownerToken)
	if response.Code != http.StatusOK {
		t.Fatalf("owner delete status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("owner delete left file, stat error: %v", err)
	}
}

func TestModelConfigResponsesDoNotExposeAPIKeys(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("model-admin", "password123", "Model Admin")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	_, err = server.store.SaveModelConfig(store.ModelConfig{
		ID: "llm-secret", Type: "llm", Name: "Secret model", Provider: "openai",
		Model: "gpt-test", APIKey: "super-secret-key", BaseURL: "https://example.com/v1",
	}, true)
	if err != nil {
		t.Fatalf("save model config: %v", err)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)

	for _, path := range []string{"/api/model-configs?type=llm", "/api/model-configs/llm-secret/default"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		if strings.HasSuffix(path, "/default") {
			request = httptest.NewRequest(http.MethodPut, path, nil)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d: %s", path, response.Code, http.StatusOK, response.Body.String())
		}
		if strings.Contains(response.Body.String(), "super-secret-key") {
			t.Fatalf("%s exposed the model API key: %s", path, response.Body.String())
		}
	}
}

func TestAuthenticatedUsersCanReadLLMConfigs(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	// The first account is the administrator; the second receives the normal
	// onboarding role with no business-module permissions. Reading available
	// models is a global runtime capability and only requires authentication.
	if _, err := server.store.CreateUser("model-admin", "password123", "Model Admin"); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	user, err := server.store.CreateUser("image-user", "password123", "Image User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)
	request := httptest.NewRequest(http.MethodGet, "/api/model-configs?type=llm", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
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
