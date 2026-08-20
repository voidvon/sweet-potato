package httpapi

import (
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
	result, err := server.createChatResponse(user, chatRequest{
		AgentID:               "quick-answer",
		Content:               "放大图片",
		ModelConfigID:         &missingLLM,
		ImageModelConfigID:    &imageModel.ID,
		RequestedCapabilities: []string{"image_generation"},
		CapabilityContext: map[string]any{"imageGeneration": map[string]any{
			"modeKey":    "upscale",
			"modeTitle":  "高清放大",
			"promptText": "放大图片",
		}},
	})
	if err != nil {
		t.Fatalf("direct image generation: %v", err)
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
