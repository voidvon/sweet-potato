package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestPlanningAnalysisUsesVisionModelAndPersistsStructuredResult(t *testing.T) {
	arguments := `{"materialCaptions":[{"assetId":"asset-product","label":"产品正面","description":"白色便携设备，正面有圆形控制区。"}],"productInsights":{"productName":"便携设备","productCategory":"消费电子","productFeatures":["便携"],"coreSellingPoints":["简洁易用"],"targetAudience":["通勤用户"],"useScenarios":["差旅"]},"referenceBreakdown":null,"notes":["具体续航参数未提供"]}`
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
