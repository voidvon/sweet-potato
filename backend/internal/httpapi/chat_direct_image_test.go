package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/imagegen"
	"sweet-potato-go/internal/store"
)

func TestDirectImageGenerationDoesNotRequireLLMModel(t *testing.T) {
	imageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated-image"))},
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated-image-2"))},
		}})
	}))
	defer imageServer.Close()

	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("direct-image-user", "password123", "Direct Image User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	imageModel, err := server.store.SaveModelConfig(store.ModelConfig{
		ID:       "direct-image-model",
		Type:     "image",
		Name:     "Direct image model",
		Provider: "openai-images",
		Model:    "compatible-image-model",
		APIKey:   "test-key",
		BaseURL:  imageServer.URL + "/v1",
	}, true)
	if err != nil {
		t.Fatalf("save image model: %v", err)
	}
	missingLLM := "missing-llm-model"
	type progressEvent struct {
		method string
		params map[string]any
	}
	progressEvents := []progressEvent{}
	ctx := context.WithValue(context.Background(), chatTurnEventEmitterContextKey{}, chatTurnEventEmitter(func(method string, params map[string]any) {
		progressEvents = append(progressEvents, progressEvent{method: method, params: params})
	}))
	result, err := server.createChatResponseContext(ctx, user, chatRequest{
		AgentID:               "quick-answer",
		Content:               "放大图片",
		ModelConfigID:         &missingLLM,
		ImageModelConfigID:    &imageModel.ID,
		RequestedCapabilities: []string{"image_generation"},
		CapabilityContext: map[string]any{"imageGeneration": map[string]any{
			"modeKey":     "upscale",
			"modeTitle":   "高清放大",
			"outputCount": 2,
			"promptText":  "放大图片",
		}},
	})
	if err != nil {
		t.Fatalf("direct image generation: %v", err)
	}
	if len(progressEvents) != 3 || progressEvents[0].method != "item/imageGeneration/started" {
		t.Fatalf("progress events = %#v", progressEvents)
	}
	if got := int(numberValue(progressEvents[0].params["expectedCount"], 0)); got != 2 {
		t.Fatalf("expected count = %d, want 2", got)
	}
	for index, event := range progressEvents[1:] {
		if event.method != "item/imageGeneration/output" || int(numberValue(event.params["slotIndex"], -1)) != index {
			t.Fatalf("output event %d = %#v", index, event)
		}
	}
	conversation := result["conversation"].(store.ChatConversation)
	if conversation.ModelConfigID != nil {
		t.Fatalf("conversation LLM model = %q, want nil", *conversation.ModelConfigID)
	}
	messages, err := server.store.ListChatMessages(conversation.ID)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	for _, message := range messages {
		if message.ModelConfigID != nil {
			t.Fatalf("%s message LLM model = %q, want nil", message.Role, *message.ModelConfigID)
		}
	}
}

func TestRegenerateChatImageReplacesOnlyRequestedSlot(t *testing.T) {
	var receivedPrompt string
	imageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode image request: %v", err)
		}
		receivedPrompt = stringValue(body, "prompt")
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("regenerated-image"))},
		}})
	}))
	defer imageServer.Close()

	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("regenerate-slot-user", "password123", "Regenerate Slot User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	model, err := server.store.SaveModelConfig(store.ModelConfig{
		ID:       "regenerate-slot-model",
		Type:     "image",
		Name:     "Regenerate slot model",
		Provider: "openai-images",
		Model:    "compatible-image-model",
		APIKey:   "test-key",
		BaseURL:  imageServer.URL + "/v1",
	}, true)
	if err != nil {
		t.Fatalf("save image model: %v", err)
	}
	conversation, err := server.store.SaveChatConversation(store.ChatConversation{
		UserID:  user.ID,
		Title:   "多图生成",
		AgentID: "quick-answer",
	}, true)
	if err != nil {
		t.Fatalf("save conversation: %v", err)
	}
	message, err := server.store.SaveChatMessage(store.ChatMessage{
		ConversationID:     conversation.ID,
		Role:               "assistant",
		AgentID:            "quick-answer",
		ImageModelConfigID: &model.ID,
		IsCompleted:        true,
		CapabilityContext: map[string]any{"imageGeneration": map[string]any{
			"modeKey":   "dialog",
			"modeTitle": "对话生图",
		}},
		Attachments: []any{
			map[string]any{"id": "old-0", "kind": "image", "imageGenerationSlotIndex": 0, "imageGenerationPrompt": "第一张提示词"},
			map[string]any{"id": "old-1", "kind": "image", "imageGenerationSlotIndex": 1, "imageGenerationPrompt": "第二张提示词"},
		},
	})
	if err != nil {
		t.Fatalf("save assistant message: %v", err)
	}

	updated, err := server.regenerateChatImage(t.Context(), user.ID, conversation.ID, message.ID, 1, "让光线更柔和")
	if err != nil {
		t.Fatalf("regenerate image: %v", err)
	}
	if receivedPrompt != "第二张提示词\n\n补充要求：让光线更柔和" {
		t.Fatalf("prompt = %q", receivedPrompt)
	}
	if got := stringValue(objectValue(updated.Attachments[0]), "id"); got != "old-0" {
		t.Fatalf("unselected attachment changed: %q", got)
	}
	replacement := objectValue(updated.Attachments[1])
	if got := int(numberValue(replacement["imageGenerationSlotIndex"], -1)); got != 1 {
		t.Fatalf("replacement slot = %d", got)
	}
	if got := stringValue(replacement, "imageGenerationPrompt"); got != receivedPrompt {
		t.Fatalf("replacement prompt = %q", got)
	}
}

func TestGenerateImageAssetsWithProgressPreservesCompletedImagesOnLaterFailure(t *testing.T) {
	var requestCount atomic.Int32
	imageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if requestCount.Add(1) == 1 {
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
				map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated-image"))},
			}})
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusGatewayTimeout)
		_ = json.NewEncoder(writer).Encode(map[string]any{"error": map[string]any{"message": "upstream timeout"}})
	}))
	defer imageServer.Close()

	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("partial-image-user", "password123", "Partial Image User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	referencePath := filepath.Join(t.TempDir(), "reference.png")
	if err := os.WriteFile(referencePath, []byte("reference"), 0o644); err != nil {
		t.Fatalf("write reference: %v", err)
	}
	model := store.ModelConfig{
		ID:       "partial-image-model",
		Type:     "image",
		Provider: "openai-images",
		Model:    "gpt-image-2",
		APIKey:   "test-key",
		BaseURL:  imageServer.URL + "/v1",
	}
	callbackCount := 0
	assets, generateErr := server.generateImageAssetsContextWithProgress(
		t.Context(),
		user.ID,
		model,
		"product details",
		2,
		[]store.ContentAsset{{ID: "reference-1", OriginalFileName: "reference.png", FilePath: referencePath, MimeType: "image/png"}},
		imagegen.GenerateInput{},
		"detail",
		"详情图生成",
		nil,
		func(_ store.ContentAsset, slotIndex int) {
			callbackCount++
			if slotIndex != 0 {
				t.Errorf("slot index = %d, want 0", slotIndex)
			}
		},
	)
	if generateErr == nil || !strings.Contains(generateErr.Error(), "upstream timeout") {
		t.Fatalf("generation error = %v", generateErr)
	}
	if len(assets) != 1 || callbackCount != 1 {
		t.Fatalf("assets = %d, callbacks = %d", len(assets), callbackCount)
	}
	if _, found, findErr := server.store.FindContentAsset(assets[0].ID); findErr != nil || !found {
		t.Fatalf("completed asset was not preserved: found=%v err=%v", found, findErr)
	}
}

func TestGenerateImageAssetsForPromptsHonorsModelConcurrency(t *testing.T) {
	var active atomic.Int32
	var peak atomic.Int32
	imageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		current := active.Add(1)
		defer active.Add(-1)
		for current > peak.Load() && !peak.CompareAndSwap(peak.Load(), current) {
		}
		time.Sleep(40 * time.Millisecond)
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated-image"))},
		}})
	}))
	defer imageServer.Close()

	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("concurrent-image-user", "password123", "Concurrent Image User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	model := store.ModelConfig{
		ID:       "concurrent-image-model",
		Type:     "image",
		Provider: "openai-images",
		Model:    "gpt-image-2",
		APIKey:   "test-key",
		BaseURL:  imageServer.URL + "/v1",
		Settings: map[string]any{"imageGeneration": map[string]any{"maxConcurrency": 2}},
	}
	prompts := []string{"chapter-1", "chapter-2", "chapter-3", "chapter-4"}
	assets, generateErr := server.generateImageAssetsForPromptsContextWithProgress(
		t.Context(), user.ID, model, prompts, len(prompts), nil, imagegen.GenerateInput{}, "detail", "详情图生成", nil, nil,
	)
	if generateErr != nil {
		t.Fatalf("generate images: %v", generateErr)
	}
	if len(assets) != len(prompts) {
		t.Fatalf("asset count = %d, want %d", len(assets), len(prompts))
	}
	if got := peak.Load(); got != 2 {
		t.Fatalf("peak concurrency = %d, want 2", got)
	}
	for index, asset := range assets {
		if got := stringValue(asset.Metadata, "prompt"); got != prompts[index] {
			t.Fatalf("asset %d prompt = %q, want %q", index, got, prompts[index])
		}
	}
}

func TestImageModelMaxConcurrencyDefaultsToThree(t *testing.T) {
	if got := imageModelMaxConcurrency(store.ModelConfig{}); got != 3 {
		t.Fatalf("default concurrency = %d, want 3", got)
	}
	if got := imageModelMaxConcurrency(store.ModelConfig{Settings: map[string]any{"imageGeneration": map[string]any{"maxConcurrency": 5}}}); got != 5 {
		t.Fatalf("configured concurrency = %d, want 5", got)
	}
}
