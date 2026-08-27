package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sweet-potato-go/internal/store"
)

func TestImageReferenceCandidatesBuildLowDetailHistoryCatalog(t *testing.T) {
	dataDir := t.TempDir()
	dataStore, err := store.Open(dataDir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	first := createTestImageReferenceAsset(t, dataStore, dataDir, "user-1", "asset-1", "first.png", 1200, 300)
	second := createTestImageReferenceAsset(t, dataStore, dataDir, "user-1", "asset-2", "second.png", 300, 1200)
	server := &Server{store: dataStore}
	history := []store.ChatMessage{{
		ID:   "message-1",
		Role: "user",
		Attachments: []any{
			map[string]any{"assetId": first.ID, "type": "image/png"},
			map[string]any{"assetId": second.ID, "type": "image/png"},
		},
	}}

	candidates, err := server.imageReferenceCandidates("user-1", history, 8)
	if err != nil {
		t.Fatalf("collect candidates: %v", err)
	}
	if len(candidates) != 2 || candidates[0].Asset.ID != first.ID || candidates[1].Asset.ID != second.ID {
		t.Fatalf("candidates = %#v", candidateAssetIDs(candidates))
	}
	if candidates[1].AttachmentPosition != 2 {
		t.Fatalf("attachment position = %d, want 2", candidates[1].AttachmentPosition)
	}
	candidates = imageReferenceCandidatesWithThumbnails(candidates)
	for _, candidate := range candidates {
		thumbnail := decodeTestThumbnail(t, candidate.ThumbnailDataURL)
		if thumbnail.Bounds().Dx() > 512 || thumbnail.Bounds().Dy() > 512 {
			t.Fatalf("thumbnail dimensions = %dx%d", thumbnail.Bounds().Dx(), thumbnail.Bounds().Dy())
		}
	}

	messages := appendImageReferenceCandidates([]map[string]any{{"role": "user", "content": "use the second image"}}, candidates, true)
	if len(messages) != 1 {
		t.Fatalf("message count = %d, want catalog merged into current user message", len(messages))
	}
	parts, ok := messages[0]["content"].([]map[string]any)
	if !ok {
		t.Fatalf("content = %#v", messages[0]["content"])
	}
	imageParts := 0
	for _, part := range parts {
		if part["type"] == "input_image" {
			imageParts++
			if part["detail"] != "low" {
				t.Fatalf("image detail = %#v", part["detail"])
			}
		}
	}
	if imageParts != 2 {
		t.Fatalf("image parts = %d, want 2", imageParts)
	}
}

func TestSelectedImageReferenceAssetsOnlyAllowsConversationCandidates(t *testing.T) {
	candidates := []imageReferenceCandidate{
		{Asset: store.ContentAsset{ID: "asset-1"}},
		{Asset: store.ContentAsset{ID: "asset-2"}},
	}
	selected := selectedImageReferenceAssets(candidates, []string{"asset-2", "forged-asset", "asset-2"})
	if len(selected) != 1 || selected[0].ID != "asset-2" {
		t.Fatalf("selected = %#v", selected)
	}
}

func TestImageReferenceCandidatesForAssetsUsesActualSendOrder(t *testing.T) {
	candidates := []imageReferenceCandidate{
		{Asset: store.ContentAsset{ID: "asset-1"}},
		{Asset: store.ContentAsset{ID: "asset-2"}},
	}
	selected := imageReferenceCandidatesForAssets(candidates, []store.ContentAsset{{ID: "asset-2"}, {ID: "asset-1"}})
	if len(selected) != 2 || selected[0].Asset.ID != "asset-2" || selected[0].SelectedPosition != 1 || selected[1].SelectedPosition != 2 {
		t.Fatalf("selected candidates = %#v", selected)
	}
}

func TestImageGenerationToolRestrictsReferenceIDsToCandidates(t *testing.T) {
	tool := imageGenerationTool("asset-1", "asset-2")
	parameters := tool["parameters"].(map[string]any)
	properties := parameters["properties"].(map[string]any)
	references := properties["reference_asset_ids"].(map[string]any)
	items := references["items"].(map[string]any)
	enum := items["enum"].([]string)
	if len(enum) != 2 || enum[0] != "asset-1" || enum[1] != "asset-2" {
		t.Fatalf("reference enum = %#v", enum)
	}
	required := parameters["required"].([]string)
	if len(required) != 5 || required[1] != "chapter_prompts" || required[2] != "count" || required[3] != "reference_asset_ids" || required[4] != "inspect_reference_images" {
		t.Fatalf("required = %#v", required)
	}
}

func TestDecideImageGenerationSelectsHistoricalReferenceByAssetID(t *testing.T) {
	dataDir := t.TempDir()
	dataStore, err := store.Open(dataDir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	first := createTestImageReferenceAsset(t, dataStore, dataDir, "user-1", "asset-1", "first.png", 100, 100)
	second := createTestImageReferenceAsset(t, dataStore, dataDir, "user-1", "asset-2", "second.png", 100, 100)

	requestImageCounts := []int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var requestPayload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		requestImageCounts = append(requestImageCounts, countInputImageParts(requestPayload))
		arguments := `{"prompt":"Use Image 2 and avoid Image 1.","reference_asset_ids":["asset-2"],"inspect_reference_images":false}`
		if len(requestImageCounts) == 2 {
			arguments = `{"prompt":"Use the provided reference image and avoid the old globe outline.","reference_asset_ids":["asset-2"],"inspect_reference_images":false}`
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"name\":\"image_generation\",\"arguments\":\"\"}}\n\n" +
			"event: response.function_call_arguments.done\ndata: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"fc_1\",\"arguments\":" + string(mustJSONForTest(t, arguments)) + "}\n\n" +
			"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n"))
	}))
	defer upstream.Close()

	server := &Server{store: dataStore}
	history := []store.ChatMessage{
		{
			ID:      "message-1",
			Role:    "user",
			Content: "@Image 1 is the old icon. Redesign it using @Image 2.",
			Attachments: []any{
				map[string]any{"assetId": first.ID, "type": "image/png"},
				map[string]any{"assetId": second.ID, "type": "image/png"},
			},
		},
		{ID: "message-2", Role: "user", Content: "Use the second image instead."},
	}
	decision, err := server.decideImageGeneration(
		context.Background(),
		"user-1",
		"message-1",
		store.ModelConfig{Provider: "test", Model: "test", APIKey: "test", BaseURL: upstream.URL},
		store.Agent{SystemPrompt: "You are an image assistant."},
		history,
		nil,
	)
	if err != nil {
		t.Fatalf("decide image generation: %v", err)
	}
	if !decision.Generate || !decision.HasReferenceSelection {
		t.Fatalf("decision = %#v", decision)
	}
	if len(decision.ReferenceAssets) != 1 || decision.ReferenceAssets[0].ID != second.ID {
		t.Fatalf("selected references = %#v", decision.ReferenceAssets)
	}
	if len(requestImageCounts) != 2 || requestImageCounts[0] != 0 || requestImageCounts[1] != 1 {
		t.Fatalf("request image counts = %#v, want [0 1]", requestImageCounts)
	}
	if prompt := stringValue(decision.Arguments, "prompt"); strings.Contains(prompt, "Image 1") || strings.Contains(prompt, "Image 2") {
		t.Fatalf("final prompt contains dangling conversation image labels: %q", prompt)
	}
}

func TestDecideImageGenerationOnlySendsThumbnailsWhenVisionIsNeeded(t *testing.T) {
	dataDir := t.TempDir()
	dataStore, err := store.Open(dataDir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	asset := createTestImageReferenceAsset(t, dataStore, dataDir, "user-1", "asset-1", "reference.png", 800, 600)

	requestImageCounts := []int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		requestImageCounts = append(requestImageCounts, countInputImageParts(payload))
		arguments := `{"prompt":"match the visually newer reference","reference_asset_ids":[],"inspect_reference_images":true}`
		if len(requestImageCounts) == 2 {
			arguments = `{"prompt":"match the visually newer reference","reference_asset_ids":["asset-1"],"inspect_reference_images":false}`
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write(responsesFunctionCallSSE(t, arguments))
	}))
	defer upstream.Close()

	server := &Server{store: dataStore}
	decision, err := server.decideImageGeneration(
		context.Background(),
		"user-1",
		"message-1",
		store.ModelConfig{Provider: "test", Model: "test", APIKey: "test", BaseURL: upstream.URL},
		store.Agent{SystemPrompt: "You are an image assistant."},
		[]store.ChatMessage{{
			ID:          "message-1",
			Role:        "user",
			Content:     "Use whichever reference has the newer visual style.",
			Attachments: []any{map[string]any{"assetId": asset.ID, "type": "image/png"}},
		}},
		nil,
	)
	if err != nil {
		t.Fatalf("decide image generation: %v", err)
	}
	if len(requestImageCounts) != 2 || requestImageCounts[0] != 0 || requestImageCounts[1] != 1 {
		t.Fatalf("request image counts = %#v, want [0 1]", requestImageCounts)
	}
	if len(decision.ReferenceAssets) != 1 || decision.ReferenceAssets[0].ID != asset.ID {
		t.Fatalf("selected references = %#v", decision.ReferenceAssets)
	}
}

func createTestImageReferenceAsset(t *testing.T, dataStore *store.Store, dataDir, userID, assetID, name string, width, height int) store.ContentAsset {
	t.Helper()
	filePath := filepath.Join(dataDir, name)
	file, err := os.Create(filePath)
	if err != nil {
		t.Fatalf("create image: %v", err)
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			canvas.SetNRGBA(x, y, color.NRGBA{R: uint8(x % 255), G: uint8(y % 255), B: 80, A: 255})
		}
	}
	if err := png.Encode(file, canvas); err != nil {
		file.Close()
		t.Fatalf("encode image: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close image: %v", err)
	}
	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("stat image: %v", err)
	}
	asset, err := dataStore.CreateContentAsset(store.ContentAsset{
		ID:               assetID,
		GroupID:          "test-group",
		UserID:           userID,
		ResourceType:     "other",
		Name:             name,
		OriginalFileName: name,
		StoredFileName:   name,
		MimeType:         "image/png",
		FileSize:         info.Size(),
		Size:             info.Size(),
		FilePath:         filePath,
		FileURL:          "/files/" + name,
	})
	if err != nil {
		t.Fatalf("create asset: %v", err)
	}
	return asset
}

func decodeTestThumbnail(t *testing.T, dataURL string) image.Image {
	t.Helper()
	if !strings.HasPrefix(dataURL, "data:image/webp;base64,") {
		t.Fatalf("thumbnail URL prefix = %q", dataURL)
	}
	encoded := strings.TrimPrefix(dataURL, "data:image/webp;base64,")
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	thumbnail, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode thumbnail: %v", err)
	}
	return thumbnail
}

func mustJSONForTest(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode JSON: %v", err)
	}
	return encoded
}

func responsesFunctionCallSSE(t *testing.T, arguments string) []byte {
	t.Helper()
	return []byte("event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"name\":\"image_generation\",\"arguments\":\"\"}}\n\n" +
		"event: response.function_call_arguments.done\ndata: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"fc_1\",\"arguments\":" + string(mustJSONForTest(t, arguments)) + "}\n\n" +
		"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n")
}

func countInputImageParts(payload map[string]any) int {
	count := 0
	inputs, _ := payload["input"].([]any)
	for _, rawInput := range inputs {
		input, _ := rawInput.(map[string]any)
		parts, _ := input["content"].([]any)
		for _, rawPart := range parts {
			part, _ := rawPart.(map[string]any)
			if part["type"] == "input_image" && part["detail"] == "low" {
				count++
			}
		}
	}
	return count
}
