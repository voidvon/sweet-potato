package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"sweet-potato-go/internal/config"
)

func TestRemotionPresetsAndGenerationRequireRunningPlugin(t *testing.T) {
	t.Setenv("REMOTION_PLUGIN_DIR", t.TempDir())
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("remotion-json-user", "password123", "Remotion JSON User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)

	presetsResponse := authenticatedWorkflowRequest(t, server, token, http.MethodGet, "/api/content-planning/remotion-presets", nil)
	if presetsResponse.Code != http.StatusOK {
		t.Fatalf("presets status = %d body=%s", presetsResponse.Code, presetsResponse.Body.String())
	}
	var presets struct {
		Presets []map[string]any `json:"presets"`
		Runtime map[string]any   `json:"runtime"`
	}
	if err := json.NewDecoder(presetsResponse.Body).Decode(&presets); err != nil || len(presets.Presets) != 3 || presets.Runtime["state"] != "not_installed" {
		t.Fatalf("presets = %#v err=%v", presets, err)
	}

	session, err := server.store.CreatePlanningSession(user.ID, "create_video", "test", "product")
	if err != nil {
		t.Fatalf("create planning session: %v", err)
	}
	session.Analysis = completedRemotionPrerequisites()
	session.Status = "confirming"
	session, err = server.store.UpdatePlanningSession(session)
	if err != nil {
		t.Fatalf("prepare planning session: %v", err)
	}
	response := authenticatedWorkflowRequest(t, server, token, http.MethodPost, "/api/content-planning/sessions/"+session.ID+"/remotion-json", map[string]any{"presetId": "clean-marketing"})
	if response.Code != http.StatusConflict {
		t.Fatalf("generate status = %d body=%s", response.Code, response.Body.String())
	}
	updated, found, err := server.store.FindPlanningSession(session.ID)
	if err != nil || !found {
		t.Fatalf("find planning session: found=%v err=%v", found, err)
	}
	generation := objectValue(updated.Analysis["remotionGeneration"])
	if stringValue(generation, "status") != "failed" || stringValue(generation, "presetId") != "clean-marketing" {
		t.Fatalf("generation = %#v", generation)
	}
}

func completedRemotionPrerequisites() map[string]any {
	return map[string]any{
		"campaignPlan": map[string]any{"visualStyle": "clean", "scenes": []any{
			map[string]any{"id": "scene-1", "title": "Title", "durationInSeconds": 2.0},
		}},
		"campaignImageGeneration": map[string]any{"status": "completed", "images": []any{
			map[string]any{"sceneId": "scene-1", "assetId": "image-1", "fileUrl": "/files/image.png"},
		}},
		"narrationGeneration": map[string]any{"status": "completed", "scenes": []any{
			map[string]any{"sceneId": "scene-1", "assetId": "audio-1", "fileUrl": "/files/audio.mp3", "durationMs": 2000.0, "startMs": 0.0, "captions": []any{}},
		}},
		"productInsights": map[string]any{}, "materialCaptions": []any{}, "confirmed": false, "notes": []any{},
	}
}
