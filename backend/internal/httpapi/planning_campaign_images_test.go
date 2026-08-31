package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestPlanningCampaignImagesGeneratesAndPersistsAssets(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("campaign-image-user", "password123", "Campaign Image")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	reference := createTestImageReferenceAsset(t, server.store, server.config.DataDir, user.ID, "campaign-reference", "reference.png", 160, 90)
	imageBytes, err := os.ReadFile(reference.FilePath)
	if err != nil {
		t.Fatalf("read image fixture: %v", err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(imageBytes)}}})
	}))
	defer upstream.Close()
	if _, err := server.store.SaveModelConfig(store.ModelConfig{
		ID: "campaign-image-model", Type: "image", Name: "Campaign Image Model", Provider: "volcengine-seedream",
		Model: "seedream-test", APIKey: "test", BaseURL: upstream.URL, IsDefault: true,
	}, true); err != nil {
		t.Fatalf("save image model: %v", err)
	}
	session, err := server.store.CreatePlanningSession(user.ID, "create_video", "制作宣传视频", "测试产品")
	if err != nil {
		t.Fatalf("create planning session: %v", err)
	}
	session.Status = "confirming"
	session.MaterialBundle["imageMaterials"] = []any{planningAssetRef(reference, "image")}
	session.Analysis["campaignPlan"] = map[string]any{
		"visualStyle": "明亮简洁的产品摄影",
		"scenes": []any{map[string]any{
			"id": "scene-1", "title": "产品亮相", "imagePrompt": "产品置于明亮背景中",
			"assetIds": []any{reference.ID}, "durationInSeconds": 4,
		}},
	}
	session.Analysis["campaignImageGeneration"] = map[string]any{"status": "idle", "images": []any{}, "errorMessage": ""}
	if session, err = server.store.UpdatePlanningSession(session); err != nil {
		t.Fatalf("prepare planning session: %v", err)
	}
	queued, runID, err := server.queuePlanningCampaignImages(session)
	if err != nil || stringValue(objectValue(queued.Analysis["campaignImageGeneration"]), "status") != "generating" {
		t.Fatalf("queue campaign images: run=%s err=%v analysis=%#v", runID, err, queued.Analysis)
	}
	server.executePlanningCampaignImages(session.ID, runID, "")
	completed, found, err := server.store.FindPlanningSession(session.ID)
	if err != nil || !found {
		t.Fatalf("find planning session: found=%v err=%v", found, err)
	}
	generation := objectValue(completed.Analysis["campaignImageGeneration"])
	images := anySlice(generation["images"])
	if stringValue(generation, "status") != "completed" || len(images) != 2 {
		t.Fatalf("campaign image generation = %#v", generation)
	}
	assetID := stringValue(objectValue(images[0]), "assetId")
	asset, found, err := server.store.FindContentAsset(assetID)
	if err != nil || !found || asset.AssetKind != "generated_image" {
		t.Fatalf("generated asset = %#v found=%v err=%v", asset, found, err)
	}
}

func TestQueuePlanningCampaignImagesRepairsLegacyEmptyPlan(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("legacy-campaign-user", "password123", "Legacy Campaign")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	session, err := server.store.CreatePlanningSession(user.ID, "create_video", "制作宣传视频", "测试产品")
	if err != nil {
		t.Fatalf("create planning session: %v", err)
	}
	session.Status = "confirming"
	session.Analysis["campaignPlan"] = nil
	queued, _, err := server.queuePlanningCampaignImages(session)
	if err != nil {
		t.Fatalf("queue campaign images with empty legacy plan: %v", err)
	}
	plan := objectValue(queued.Analysis["campaignPlan"])
	if len(anySlice(plan["scenes"])) < 2 {
		t.Fatalf("repaired campaign plan = %#v", plan)
	}
}
