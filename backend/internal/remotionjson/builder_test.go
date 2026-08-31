package remotionjson

import (
	"strings"
	"testing"

	"sweet-potato-go/internal/store"
)

func TestBuildCreatesValidatedShapeAndRelativeCaptions(t *testing.T) {
	session := store.ContentPlanningSession{Analysis: map[string]any{
		"campaignPlan": map[string]any{"visualStyle": "clean", "scenes": []any{
			map[string]any{"id": "scene-1", "title": "核心卖点", "subtitle": "更轻、更快", "durationInSeconds": 4.0},
			map[string]any{"id": "scene-2", "title": "立即体验", "durationInSeconds": 3.0},
		}},
		"campaignImageGeneration": map[string]any{"status": "completed", "images": []any{
			map[string]any{"sceneId": "scene-1", "assetId": "image-1", "fileUrl": "/files/image-1.png"},
			map[string]any{"sceneId": "scene-2", "assetId": "image-2", "fileUrl": "/files/image-2.png"},
		}},
		"narrationGeneration": map[string]any{"status": "completed", "scenes": []any{
			map[string]any{"sceneId": "scene-1", "assetId": "audio-1", "fileUrl": "/files/audio-1.mp3", "durationMs": 4000.0, "startMs": 0.0, "captions": []any{map[string]any{"text": "第一幕", "startMs": 0.0, "endMs": 1500.0}}},
			map[string]any{"sceneId": "scene-2", "assetId": "audio-2", "fileUrl": "/files/audio-2.mp3", "durationMs": 3000.0, "startMs": 4000.0, "captions": []any{map[string]any{"text": "第二幕", "startMs": 4000.0, "endMs": 6500.0}}},
		}},
	}}
	result, err := Build(session, BuildOptions{PresetID: "clean-marketing", ResolveURL: func(value string) (string, error) {
		return "http://127.0.0.1:7072" + value, nil
	}})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	input := result.RenderRequest["inputProps"].(map[string]any)
	if input["version"] != SchemaVersion || input["video"].(map[string]any)["durationInFrames"] != 198 {
		t.Fatalf("input props = %#v", input)
	}
	scenes := input["scenes"].([]any)
	secondElements := scenes[1].(map[string]any)["elements"].([]any)
	var caption map[string]any
	for _, raw := range secondElements {
		item := raw.(map[string]any)
		if item["type"] == "captions" {
			caption = item["captions"].([]any)[0].(map[string]any)
		}
	}
	if caption == nil || caption["startMs"] != 0 || caption["endMs"] != 2500 {
		t.Fatalf("relative caption = %#v", caption)
	}
}

func TestBuildRequiresCompletedAssets(t *testing.T) {
	_, err := Build(store.ContentPlanningSession{Analysis: map[string]any{
		"campaignPlan": map[string]any{"scenes": []any{map[string]any{"id": "scene-1"}}},
	}}, BuildOptions{ResolveURL: func(value string) (string, error) { return value, nil }})
	if err == nil || !strings.Contains(err.Error(), "宣传图片") {
		t.Fatalf("error = %v", err)
	}
}
