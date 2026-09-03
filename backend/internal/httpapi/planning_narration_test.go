package httpapi

import (
	"encoding/json"
	"testing"
	"unicode/utf8"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestNumberValueReadsDecodedJSONNumber(t *testing.T) {
	if got := numberValue(json.Number("2"), 1); got != 2 {
		t.Fatalf("integer JSON speed = %v, want 2", got)
	}
	if got := numberValue(json.Number("1.5"), 1); got != 1.5 {
		t.Fatalf("decimal JSON speed = %v, want 1.5", got)
	}
}

func TestNarrationCaptionsSplitLongCopyIntoSingleLineSegments(t *testing.T) {
	captions := narrationCaptions("，这是一段明显超过单行字幕长度的营销旁白文案，，需要自动拆分并保持时间连续。", 1000, 4000)
	if len(captions) < 2 {
		t.Fatalf("captions = %#v; want multiple short segments", captions)
	}
	previousEnd := 1000
	for index, value := range captions {
		caption := objectValue(value)
		if count := utf8.RuneCountInString(stringValue(caption, "text")); count > planningCaptionMaxRunes {
			t.Fatalf("caption %d contains %d runes", index, count)
		}
		if text := stringValue(caption, "text"); text == "" || trimLeadingCaptionPunctuation(text) != text {
			t.Fatalf("caption %d starts with punctuation: %q", index, text)
		}
		if text := stringValue(caption, "text"); trimCaptionBoundaryPunctuation(text) != text {
			t.Fatalf("caption %d ends with punctuation: %q", index, text)
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

func TestNarrationCaptionsKeepOnlyInternalPunctuation(t *testing.T) {
	captions := narrationCaptions("方案兼顾阻燃、强度和韧性，成本更低。", 0, 3000)
	want := []string{"方案兼顾阻燃、强度和韧性", "成本更低"}
	if len(captions) != len(want) {
		t.Fatalf("captions = %#v; want %d segments", captions, len(want))
	}
	for index, value := range captions {
		if got := stringValue(objectValue(value), "text"); got != want[index] {
			t.Fatalf("caption %d = %q, want %q", index, got, want[index])
		}
	}
}

func TestDecodePlanningNarrationCopyPreservesSceneOrder(t *testing.T) {
	result := responsesResult{Output: []responsesOutputItem{{
		Type: "function_call", Name: "submit_narration_copy",
		Arguments: `{"scenes":[{"sceneId":"closing","text":"欢迎各位老板合作共赢。"},{"sceneId":"opening","text":"你是不是在找一款更高效的产品？"}]}`,
	}}}
	rewritten, err := decodePlanningNarrationCopy(result, []planningNarrationScene{
		{ID: "opening", Text: "旧开场"},
		{ID: "closing", Text: "旧结尾"},
	})
	if err != nil {
		t.Fatalf("decode narration copy: %v", err)
	}
	if len(rewritten) != 2 || rewritten[0].ID != "opening" || rewritten[0].Text == "旧开场" || rewritten[1].ID != "closing" {
		t.Fatalf("rewritten scenes = %#v", rewritten)
	}
}

func TestPlanningNarrationPlaybackTimingAppliesMiMoSpeed(t *testing.T) {
	duration, playbackRate := planningNarrationPlaybackTiming(10000, 1.25, false)
	if duration != 8000 || playbackRate != 1.25 {
		t.Fatalf("MiMo timing = %dms at %.2fx", duration, playbackRate)
	}
	duration, playbackRate = planningNarrationPlaybackTiming(8000, 1.25, true)
	if duration != 8000 || playbackRate != 1 {
		t.Fatalf("provider-applied timing = %dms at %.2fx", duration, playbackRate)
	}
}

func TestCombinedPlanningNarrationUsesOneContinuousParagraphSequence(t *testing.T) {
	scenes := []planningNarrationScene{{ID: "one", Text: "第一段"}, {ID: "two", Text: "第二段！"}}
	if got, want := combinedPlanningNarrationText(scenes), "第一段。\n第二段！"; got != want {
		t.Fatalf("combined narration = %q, want %q", got, want)
	}
	durations := planningNarrationSceneDurations(scenes, 5000)
	if len(durations) != 2 || durations[0]+durations[1] != 5000 || durations[0] <= 0 || durations[1] <= 0 {
		t.Fatalf("scene durations = %#v", durations)
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
