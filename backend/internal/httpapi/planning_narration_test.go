package httpapi

import (
	"testing"
	"unicode/utf8"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestNarrationCaptionsSplitLongCopyIntoSingleLineSegments(t *testing.T) {
	captions := narrationCaptions("这是一段明显超过单行字幕长度的营销旁白文案，需要自动拆分并保持时间连续。", 1000, 4000)
	if len(captions) < 2 {
		t.Fatalf("captions = %#v; want multiple short segments", captions)
	}
	previousEnd := 1000
	for index, value := range captions {
		caption := objectValue(value)
		if count := utf8.RuneCountInString(stringValue(caption, "text")); count > planningCaptionMaxRunes {
			t.Fatalf("caption %d contains %d runes", index, count)
		}
		start := int(numberValue(caption["startMs"], 0))
		end := int(numberValue(caption["endMs"], 0))
		if start != previousEnd || end <= start {
			t.Fatalf("caption %d timing = %d-%d, previous end = %d", index, start, end, previousEnd)
		}
		previousEnd = end
	}
	if previousEnd != 5000 {
		t.Fatalf("last caption end = %d, want 5000", previousEnd)
	}
}

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
