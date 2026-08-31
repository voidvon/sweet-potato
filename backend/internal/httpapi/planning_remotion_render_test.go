package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestRewriteRemotionMediaURLsSignsOwnedNestedAssets(t *testing.T) {
	dataDir := t.TempDir()
	server, err := New(config.Config{Addr: "0.0.0.0:7072", DataDir: dataDir, AuthTokenSecret: "render-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("remotion-render-owner", "password123", "Render Owner")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	group, err := server.store.CreateContentGroup(user.ID, "other", "Render Files", "", nil)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	filePath := filepath.Join(dataDir, "files", "nested image.png")
	if err := os.WriteFile(filePath, []byte("image"), 0o600); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if _, err := server.store.CreateContentAsset(store.ContentAsset{
		UserID: user.ID, GroupID: group.ID, ResourceType: "other", Name: "Nested image",
		OriginalFileName: "nested image.png", StoredFileName: "nested image.png", MimeType: "image/png",
		FilePath: filePath, FileURL: "/files/nested%20image.png",
	}); err != nil {
		t.Fatalf("create asset: %v", err)
	}

	payload := map[string]any{
		"inputProps": map[string]any{"scenes": []any{
			map[string]any{"elements": []any{
				map[string]any{"src": "/files/nested%20image.png"},
				map[string]any{"src": "https://cdn.example.com/public.png"},
			}},
		}},
	}
	if err := server.rewriteRemotionMediaURLs(user.ID, payload); err != nil {
		t.Fatalf("rewrite media URLs: %v", err)
	}
	elements := payload["inputProps"].(map[string]any)["scenes"].([]any)[0].(map[string]any)["elements"].([]any)
	signed := elements[0].(map[string]any)["src"].(string)
	if !strings.HasPrefix(signed, "http://127.0.0.1:7072/files/nested%20image.png?render_token=") {
		t.Fatalf("signed URL = %q", signed)
	}
	if external := elements[1].(map[string]any)["src"].(string); external != "https://cdn.example.com/public.png" {
		t.Fatalf("external URL changed to %q", external)
	}

	parsed, err := url.Parse(signed)
	if err != nil {
		t.Fatalf("parse signed URL: %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, parsed.RequestURI(), nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "image" {
		t.Fatalf("signed asset response = %d %q", response.Code, response.Body.String())
	}
}

func TestRewriteRemotionMediaURLsRejectsAnotherUsersAsset(t *testing.T) {
	dataDir := t.TempDir()
	server, err := New(config.Config{DataDir: dataDir, AuthTokenSecret: "render-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	owner, err := server.store.CreateUser("remotion-asset-owner", "password123", "Asset Owner")
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	other, err := server.store.CreateUser("remotion-asset-other", "password123", "Asset Other")
	if err != nil {
		t.Fatalf("create other user: %v", err)
	}
	if _, err := server.store.CreateContentAsset(store.ContentAsset{
		UserID: owner.ID, OriginalFileName: "private.png", StoredFileName: "private.png", MimeType: "image/png",
	}); err != nil {
		t.Fatalf("create asset: %v", err)
	}
	payload := map[string]any{"src": "/files/private.png"}
	if err := server.rewriteRemotionMediaURLs(other.ID, payload); err == nil {
		t.Fatal("expected another user's asset to be rejected")
	}
}

func TestRemotionRenderResultMetadataUsesSavedJSON(t *testing.T) {
	session := store.ContentPlanningSession{Analysis: map[string]any{
		"remotionGeneration": map[string]any{"renderRequest": map[string]any{
			"inputProps": map[string]any{"video": map[string]any{
				"width": 1080.0, "height": 1920.0, "fps": 30.0, "durationInFrames": 465.0,
			}},
		}},
	}}
	if ratio := remotionRenderAspectRatio(session); ratio != "9:16" {
		t.Fatalf("aspect ratio = %q, want 9:16", ratio)
	}
	if duration := remotionRenderDuration(session); duration != "15.5秒" {
		t.Fatalf("duration = %q, want 15.5秒", duration)
	}
}
