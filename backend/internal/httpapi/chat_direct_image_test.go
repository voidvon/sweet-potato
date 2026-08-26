package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"sweet-potato-go/internal/config"
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
