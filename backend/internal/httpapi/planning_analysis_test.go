package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestPlanningAnalysisUsesVisionModelAndPersistsStructuredResult(t *testing.T) {
	arguments := `{"materialCaptions":[{"assetId":"asset-product","label":"产品正面","description":"白色便携设备，正面有圆形控制区。"}],"productInsights":{"productName":"便携设备","productCategory":"消费电子","productFeatures":["便携"],"coreSellingPoints":["简洁易用"],"targetAudience":["通勤用户"],"useScenarios":["差旅"]},"campaignPlan":{"visualStyle":"明亮、简洁的产品摄影","scenes":[{"id":"opening","title":"轻装出发","subtitle":"通勤更轻松","voiceover":"便携设备让出行更从容","cta":"","purpose":"开场展示","durationInSeconds":4,"assetIds":["asset-product","invented"],"imagePrompt":"便携设备置于明亮通勤场景中，产品特写"},{"id":"closing","title":"即刻体验","subtitle":"简洁易用","voiceover":"现在开始体验","cta":"了解更多","purpose":"行动引导","durationInSeconds":4,"assetIds":["asset-product"],"imagePrompt":"便携设备英雄镜头，背景干净并预留文案区域"}]},"referenceBreakdown":null,"notes":["具体续航参数未提供"]}`
	inputImageCount := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		inputImageCount = countPlanningInputImages(payload)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"name\":\"submit_content_analysis\",\"arguments\":\"\"}}\n\n" +
			"event: response.function_call_arguments.done\ndata: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"fc_1\",\"arguments\":" + strconv.Quote(arguments) + "}\n\n" +
			"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[],\"usage\":{\"input_tokens\":100,\"output_tokens\":50,\"total_tokens\":150}}}\n\n"))
	}))
	defer upstream.Close()

	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("planning-ai-user", "password123", "Planning AI")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := server.store.AdjustCredits(user.ID, user.ID, 10); err != nil {
		t.Fatalf("add credits: %v", err)
	}
	if _, err := server.store.SaveModelConfig(store.ModelConfig{ID: "planning-ai-model", Type: "llm", Name: "Planning AI", Provider: "test", Model: "vision-test", APIKey: "test", BaseURL: upstream.URL, IsDefault: true}, true); err != nil {
		t.Fatalf("save model: %v", err)
	}
	asset := createTestImageReferenceAsset(t, server.store, server.config.DataDir, user.ID, "asset-product", "product.png", 160, 120)
	session, err := server.store.CreatePlanningSession(user.ID, "create_video", "制作一条通勤场景宣传视频", "")
	if err != nil {
		t.Fatalf("create planning session: %v", err)
	}
	queued, err := server.queuePlanningAnalysis(session, map[string]any{"media": []any{map[string]any{"assetId": asset.ID, "kind": "image"}}})
	if err != nil {
		t.Fatalf("queue analysis: %v", err)
	}
	if queued.Status != "analyzing" || queued.JobStage != "analyzing_materials" {
		t.Fatalf("queued state = %s/%s", queued.Status, queued.JobStage)
	}
	server.executePlanningAnalysis(session.ID, "")

	completed, found, err := server.store.FindPlanningSession(session.ID)
	if err != nil || !found {
		t.Fatalf("find completed session: found=%v err=%v", found, err)
	}
	if completed.Status != "confirming" || completed.JobStage != "completed" {
		t.Fatalf("completed state = %s/%s, error=%s", completed.Status, completed.JobStage, completed.ErrorMessage)
	}
	insights := objectValue(completed.Analysis["productInsights"])
	if stringValue(insights, "productCategory") != "消费电子" {
		t.Fatalf("product insights = %#v", insights)
	}
	plan := objectValue(completed.Analysis["campaignPlan"])
	scenes := anySlice(plan["scenes"])
	if len(scenes) != 2 || len(stringSlice(objectValue(scenes[0])["assetIds"])) != 1 {
		t.Fatalf("campaign plan = %#v", plan)
	}
	if inputImageCount != 1 {
		t.Fatalf("input image count = %d, want 1", inputImageCount)
	}
	updatedUser, _, _ := server.store.FindUserByID(user.ID)
	if updatedUser.CreditBalance != 8 {
		t.Fatalf("credit balance = %v, want 8", updatedUser.CreditBalance)
	}
}

func TestNormalizePlanningAnalysisDropsUnknownAssetIDs(t *testing.T) {
	result := normalizePlanningAnalysis(map[string]any{
		"materialCaptions": []any{
			map[string]any{"assetId": "known", "label": "有效", "description": "有效描述"},
			map[string]any{"assetId": "invented", "label": "伪造", "description": "不应保留"},
		},
		"productInsights": map[string]any{"productName": "产品", "productFeatures": []any{"功能"}},
		"notes":           []any{"待确认"},
	}, planningAnalysisContext{assetRefs: map[string]map[string]any{"known": {"assetId": "known", "fileUrl": "/files/known.png"}}})
	captions := anySlice(result["materialCaptions"])
	if len(captions) != 1 || stringValue(objectValue(captions[0]), "assetId") != "known" {
		t.Fatalf("captions = %#v", captions)
	}
	plan := objectValue(result["campaignPlan"])
	if len(anySlice(plan["scenes"])) < 2 {
		t.Fatalf("fallback campaign plan = %#v", plan)
	}
}

func TestNormalizePlanningCampaignPlanUsesEveryAvailableImage(t *testing.T) {
	images := make([]store.ContentAsset, 0, 20)
	for index := 0; index < 20; index++ {
		images = append(images, store.ContentAsset{ID: fmt.Sprintf("asset-%02d", index+1)})
	}
	plan := objectValue(normalizePlanningCampaignPlan(map[string]any{
		"visualStyle": "统一产品摄影",
		"scenes": []any{
			map[string]any{"id": "opening", "title": "开场", "assetIds": []any{"asset-01"}, "imagePrompt": "产品开场"},
			map[string]any{"id": "closing", "title": "收束", "assetIds": []any{"asset-01"}, "imagePrompt": "产品收束"},
		},
	}, planningAnalysisContext{images: images}))
	scenes := anySlice(plan["scenes"])
	used := map[string]bool{}
	for _, value := range scenes {
		assetIDs := stringSlice(objectValue(value)["assetIds"])
		if len(assetIDs) > planningCampaignMaxReferences {
			t.Fatalf("scene has too many references: %#v", value)
		}
		for _, assetID := range assetIDs {
			used[assetID] = true
		}
	}
	if len(used) != len(images) {
		t.Fatalf("used assets = %d, want %d; plan=%#v", len(used), len(images), plan)
	}
}

func countPlanningInputImages(payload map[string]any) int {
	count := 0
	for _, messageValue := range anySlice(payload["input"]) {
		message := objectValue(messageValue)
		for _, contentValue := range anySlice(message["content"]) {
			if stringValue(objectValue(contentValue), "type") == "input_image" {
				count++
			}
		}
	}
	return count
}
