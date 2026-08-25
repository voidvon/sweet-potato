package httpapi

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	"sweet-potato-go/internal/store"
)

func TestResolveImageGenerationAspectRatioInheritsExplicitRequirement(t *testing.T) {
	history := []store.ChatMessage{{
		ID:      "previous-user-message",
		Role:    "user",
		Content: "请生成横幅，图片比例为 2.19:1",
		CapabilityContext: map[string]any{"imageGeneration": map[string]any{
			"aspectRatio": "auto",
		}},
	}}
	contextValue := map[string]any{"imageGeneration": map[string]any{
		"aspectRatio": "auto",
		"promptText":  "帮我生成英文版本",
	}}

	resolved := resolveImageGenerationAspectRatio("帮我生成英文版本", contextValue, history, "current-user-message")
	generation := objectValue(resolved["imageGeneration"])
	if got := stringValue(generation, "aspectRatio"); got != "2.19:1" {
		t.Fatalf("aspect ratio = %q, want 2.19:1", got)
	}
}

func TestResolveImageGenerationAspectRatioPrefersCurrentRequirement(t *testing.T) {
	history := []store.ChatMessage{{Role: "user", Content: "图片比例为 2.19:1"}}
	contextValue := map[string]any{"imageGeneration": map[string]any{"aspectRatio": "auto"}}

	resolved := resolveImageGenerationAspectRatio("这次改为画面比例 1:1", contextValue, history, "current")
	if got := stringValue(objectValue(resolved["imageGeneration"]), "aspectRatio"); got != "1:1" {
		t.Fatalf("aspect ratio = %q, want 1:1", got)
	}
}

func TestApplyImageToolArgumentsPreservesResolvedAspectRatio(t *testing.T) {
	contextValue := map[string]any{"imageGeneration": map[string]any{"aspectRatio": "2.19:1"}}
	resolved := applyImageToolArguments(contextValue, map[string]any{"prompt": "English banner", "aspect_ratio": "21:9"})
	generation := objectValue(resolved["imageGeneration"])
	if got := stringValue(generation, "aspectRatio"); got != "2.19:1" {
		t.Fatalf("aspect ratio = %q, want 2.19:1", got)
	}
}

func TestCropImageToAspectRatio(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 1909, 824))
	for y := 0; y < source.Bounds().Dy(); y++ {
		for x := 0; x < source.Bounds().Dx(); x++ {
			source.Set(x, y, color.RGBA{R: 10, G: 20, B: 30, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	processed, err := cropImageToAspectRatio(encoded.Bytes(), "image/png", "2.19:1")
	if err != nil {
		t.Fatalf("crop image: %v", err)
	}
	result, _, err := image.Decode(bytes.NewReader(processed))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	got := float64(result.Bounds().Dx()) / float64(result.Bounds().Dy())
	if got < 2.185 || got > 2.195 {
		t.Fatalf("aspect ratio = %.4f, want approximately 2.19", got)
	}
}
