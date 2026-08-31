package httpapi

import (
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestSelectPresetAudioModelSkipsMiMoVoiceCloneDefault(t *testing.T) {
	models := []store.ModelConfig{
		{
			ID: "clone", Type: "audio", Provider: "mimo-tts", Model: "mimo-v2.5-tts-voiceclone", IsDefault: true,
		},
		{
			ID: "tts", Type: "audio", Provider: "mimo-tts", Model: "mimo-v2.5-tts",
		},
	}

	selected, found := selectPresetAudioModel(models)
	if !found || selected.ID != "tts" {
		t.Fatalf("selected model = %#v, found=%v; want the preset-voice TTS model", selected, found)
	}
}

func TestResolveAudioModelConfigFallsBackFromRequestedVoiceClone(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	user, err := server.store.CreateUser("narration-model-user", "password123", "Narration Model")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	for _, model := range []store.ModelConfig{
		{ID: "clone", Type: "audio", Name: "MiMo Clone", Provider: "mimo-tts", Model: "mimo-v2.5-tts-voiceclone", APIKey: "test-key", BaseURL: "https://api.xiaomimimo.com/v1", IsDefault: true},
		{ID: "tts", Type: "audio", Name: "MiMo TTS", Provider: "mimo-tts", Model: "mimo-v2.5-tts", APIKey: "test-key", BaseURL: "https://api.xiaomimimo.com/v1"},
	} {
		if _, err := server.store.SaveModelConfig(model, true); err != nil {
			t.Fatalf("save model %s: %v", model.ID, err)
		}
	}

	selected, err := server.resolveAudioModelConfig(user.ID, "clone")
	if err != nil {
		t.Fatalf("resolve audio model: %v", err)
	}
	if selected.ID != "tts" || selected.Model != "mimo-v2.5-tts" {
		t.Fatalf("selected model = %#v; want tts config", selected)
	}
}

func TestAudioModelSupportsPresetVoiceRejectsMiMoSpecializedModels(t *testing.T) {
	for _, modelID := range []string{"mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign"} {
		if audioModelSupportsPresetVoice(store.ModelConfig{Provider: "mimo-tts", Model: modelID}) {
			t.Fatalf("model %q unexpectedly supports preset voices", modelID)
		}
	}
	if !audioModelSupportsPresetVoice(store.ModelConfig{Provider: "mimo-tts", Model: "mimo-v2.5-tts"}) {
		t.Fatal("mimo-v2.5-tts should support preset voices")
	}
}
