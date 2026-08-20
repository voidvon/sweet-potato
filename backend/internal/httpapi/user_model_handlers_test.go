package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestUserImageModelsArePrivateAndFree(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	owner, err := server.store.CreateUser("personal-model-owner", "password123", "Owner")
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	other, err := server.store.CreateUser("personal-model-other", "password123", "Other")
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	ownerToken := server.tokens.Create(owner.ID, owner.Role, owner.AuthVersion)
	otherToken := server.tokens.Create(other.ID, other.Role, other.AuthVersion)

	createResponse := requestJSONWithHeaders(t, server, http.MethodPost, "/api/user-model-configs", map[string]any{
		"type": "image", "name": "Owner Seedream", "provider": "volcengine-seedream",
		"model": "doubao-seedream-test", "apiKey": "owner-secret-key",
		"baseUrl": "https://image-proxy.example.com/v1", "isDefault": true,
		"settings": map[string]any{"billing": map[string]any{"creditsPerRequest": 999}},
	}, ownerToken)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", createResponse.Code, createResponse.Body.String())
	}
	if strings.Contains(createResponse.Body.String(), "owner-secret-key") || !strings.Contains(createResponse.Body.String(), `"creditsPerRequest":0`) {
		t.Fatalf("create response did not redact key or force free billing: %s", createResponse.Body.String())
	}
	var created struct {
		ID    string `json:"id"`
		Scope string `json:"scope"`
	}
	decodeJSON(t, createResponse, &created)
	if created.ID == "" || created.Scope != "personal" {
		t.Fatalf("unexpected created model: %+v", created)
	}
	storedCustomURL, found, err := server.store.FindUserModelConfig(owner.ID, created.ID)
	if err != nil || !found || storedCustomURL.BaseURL != "https://image-proxy.example.com/v1" {
		t.Fatalf("custom base URL was not stored: found=%v url=%q err=%v", found, storedCustomURL.BaseURL, err)
	}

	otherList := requestJSONWithHeaders(t, server, http.MethodGet, "/api/user-model-configs?type=image", nil, otherToken)
	if otherList.Code != http.StatusOK || strings.Contains(otherList.Body.String(), created.ID) {
		t.Fatalf("other user can list owner model: %d %s", otherList.Code, otherList.Body.String())
	}
	foreignDelete := requestJSONWithHeaders(t, server, http.MethodDelete, "/api/user-model-configs/"+created.ID, nil, otherToken)
	if foreignDelete.Code != http.StatusNotFound {
		t.Fatalf("foreign delete status = %d, want 404: %s", foreignDelete.Code, foreignDelete.Body.String())
	}
	if _, err := server.resolveImageModelConfig(other.ID, created.ID); err == nil {
		t.Fatal("other user resolved the owner's personal model")
	}
	resolved, err := server.resolveImageModelConfig(owner.ID, created.ID)
	if err != nil {
		t.Fatalf("owner resolve model: %v", err)
	}
	if resolved.OwnerUserID != owner.ID || resolved.APIKey != "owner-secret-key" {
		t.Fatalf("resolved owner model mismatch: owner=%q key=%q", resolved.OwnerUserID, resolved.APIKey)
	}
	cost, err := server.batchEstimatedCredits(owner.ID, "image", map[string]any{"modelConfigId": created.ID, "outputCount": 4})
	if err != nil || cost != 0 {
		t.Fatalf("personal model batch cost = %v, err = %v", cost, err)
	}

	stored, found, err := server.store.FindUserModelConfig(owner.ID, created.ID)
	if err != nil || !found {
		t.Fatalf("find stored model: found=%v err=%v", found, err)
	}
	billing, _ := stored.Settings["billing"].(map[string]any)
	if billing["creditsPerRequest"] != float64(0) {
		t.Fatalf("stored personal billing is not free: %#v", billing)
	}
}

func TestUserImageModelDefaultsArePerUser(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	first, _ := server.store.CreateUser("default-model-first", "password123", "First")
	second, _ := server.store.CreateUser("default-model-second", "password123", "Second")
	for _, item := range []struct {
		user store.User
		name string
	}{
		{user: first, name: "First default"},
		{user: second, name: "Second default"},
	} {
		_, err := server.store.SaveUserModelConfig(item.user.ID, store.ModelConfig{
			Type: "image", Name: item.name, Provider: "openai-images", Model: "gpt-image-1",
			APIKey: "secret", BaseURL: "https://api.openai.com/v1", IsDefault: true,
			Settings: map[string]any{"billing": map[string]any{"creditsPerRequest": 0}},
		}, true)
		if err != nil {
			t.Fatalf("save %s: %v", item.name, err)
		}
	}
	firstDefault, err := server.resolveImageModelConfig(first.ID, "")
	if err != nil || firstDefault.Name != "First default" {
		t.Fatalf("first default = %q, err=%v", firstDefault.Name, err)
	}
	secondDefault, err := server.resolveImageModelConfig(second.ID, "")
	if err != nil || secondDefault.Name != "Second default" {
		t.Fatalf("second default = %q, err=%v", secondDefault.Name, err)
	}
}

func TestUserImageModelAllowsCustomProvider(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, _ := server.store.CreateUser("custom-image-provider", "password123", "Custom Provider")
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)

	response := requestJSONWithHeaders(t, server, http.MethodPost, "/api/user-model-configs", map[string]any{
		"type": "image", "name": "Compatible Image", "provider": "openai-compatible",
		"model": "custom-image-model", "apiKey": "personal-secret",
		"baseUrl": "https://models.example.com/v1",
	}, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("create custom provider status = %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"provider":"openai-compatible"`) {
		t.Fatalf("custom provider was not preserved: %s", response.Body.String())
	}
}

func TestUserLLMModelsArePrivateFreeAndPreferred(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	owner, _ := server.store.CreateUser("personal-llm-owner", "password123", "Owner")
	other, _ := server.store.CreateUser("personal-llm-other", "password123", "Other")
	ownerToken := server.tokens.Create(owner.ID, owner.Role, owner.AuthVersion)

	response := requestJSONWithHeaders(t, server, http.MethodPost, "/api/user-model-configs", map[string]any{
		"type": "llm", "name": "Owner LLM", "provider": "openai-compatible",
		"model": "custom-chat", "apiKey": "personal-llm-secret",
		"baseUrl": "https://llm-proxy.example.com/v1", "temperature": 0.3, "isDefault": true,
		"settings": map[string]any{"billing": map[string]any{"multiplier": 99}},
	}, ownerToken)
	if response.Code != http.StatusCreated {
		t.Fatalf("create LLM status = %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "personal-llm-secret") || !strings.Contains(response.Body.String(), `"multiplier":0`) {
		t.Fatalf("LLM response did not redact key or force free billing: %s", response.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	decodeJSON(t, response, &created)

	resolved, err := server.resolveLLMModelConfig(owner.ID, "", "")
	if err != nil || resolved.ID != created.ID || resolved.OwnerUserID != owner.ID {
		t.Fatalf("owner default LLM mismatch: id=%q owner=%q err=%v", resolved.ID, resolved.OwnerUserID, err)
	}
	if _, err := server.resolveLLMModelConfig(other.ID, created.ID, ""); err == nil {
		t.Fatal("other user resolved the owner's personal LLM")
	}
	otherDefault, err := server.resolveLLMModelConfig(other.ID, "", "")
	if err != nil {
		t.Fatalf("resolve other default LLM: %v", err)
	}
	if otherDefault.OwnerUserID != "" || otherDefault.ID == created.ID {
		t.Fatalf("owner LLM leaked into other default: %+v", otherDefault)
	}
}
