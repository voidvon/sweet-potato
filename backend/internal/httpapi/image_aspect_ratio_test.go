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

func TestResolveDetailAutomaticAspectRatioDoesNotInheritHistory(t *testing.T) {
	history := []store.ChatMessage{{
		Role:    "user",
		Content: "上一张详情图使用 16:9",
		CapabilityContext: map[string]any{"imageGeneration": map[string]any{
			"modeKey":     "detail",
			"aspectRatio": "16:9",
		}},
	}}
	contextValue := map[string]any{"imageGeneration": map[string]any{
		"modeKey":     "detail",
		"aspectRatio": "auto",
	}}

	resolved := resolveImageGenerationAspectRatio("按内容自适应比例", contextValue, history, "current")
	if got := stringValue(objectValue(resolved["imageGeneration"]), "aspectRatio"); got != "auto" {
		t.Fatalf("detail automatic aspect ratio = %q, want auto", got)
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

func TestImageGenerationOptionsUsesAdaptiveSizeForDetailAutoMode(t *testing.T) {
	server := &Server{}
	auto := server.imageGenerationOptions(map[string]any{"imageGeneration": map[string]any{
		"modeKey":     "detail",
		"aspectRatio": "auto",
		"outputSize":  "2048 x 2048",
		"resolution":  "2K",
	}}, nil)
	if auto.Size != "" || auto.Resolution != "2K" {
		t.Fatalf("automatic detail options = %+v, want adaptive size with 2K resolution", auto)
	}
	manual := server.imageGenerationOptions(map[string]any{"imageGeneration": map[string]any{
		"modeKey":     "detail",
		"aspectRatio": "3:4",
		"outputSize":  "1728 x 2304",
		"resolution":  "2K",
	}}, nil)
	if manual.Size != "1728 x 2304" || manual.AspectRatio != "3:4" {
		t.Fatalf("manual detail options = %+v, want fixed size and ratio", manual)
	}
}

func TestFitImageToAspectRatioPreservesRequestedRatio(t *testing.T) {
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

	processed, err := fitImageToAspectRatio(encoded.Bytes(), "image/png", "2.19:1")
	if err != nil {
		t.Fatalf("fit image: %v", err)
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

func TestFitImageToAspectRatioDoesNotCropEdgeContent(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 4, 2))
	source.Set(0, 0, color.RGBA{R: 255, A: 255})
	source.Set(3, 0, color.RGBA{G: 255, A: 255})
	source.Set(0, 1, color.RGBA{B: 255, A: 255})
	source.Set(3, 1, color.RGBA{R: 255, G: 255, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	processed, err := fitImageToAspectRatio(encoded.Bytes(), "image/png", "1:1")
	if err != nil {
		t.Fatalf("fit image: %v", err)
	}
	result, _, err := image.Decode(bytes.NewReader(processed))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if result.Bounds().Dx() != 4 || result.Bounds().Dy() != 4 {
		t.Fatalf("dimensions = %dx%d, want 4x4", result.Bounds().Dx(), result.Bounds().Dy())
	}
	for point, want := range map[image.Point]color.Color{
		{X: 0, Y: 1}: color.RGBA{R: 255, A: 255},
		{X: 3, Y: 1}: color.RGBA{G: 255, A: 255},
		{X: 0, Y: 2}: color.RGBA{B: 255, A: 255},
		{X: 3, Y: 2}: color.RGBA{R: 255, G: 255, A: 255},
	} {
		gotR, gotG, gotB, gotA := result.At(point.X, point.Y).RGBA()
		wantR, wantG, wantB, wantA := want.RGBA()
		if gotR != wantR || gotG != wantG || gotB != wantB || gotA != wantA {
			t.Fatalf("pixel %v = %#v, want %#v", point, result.At(point.X, point.Y), want)
		}
	}
}

func TestFitImageToAspectRatioUsesStrictCanvasRatioForSmallImages(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 4, 2))
	for y := 0; y < source.Bounds().Dy(); y++ {
		for x := 0; x < source.Bounds().Dx(); x++ {
			source.Set(x, y, color.RGBA{R: uint8(10 + x), G: uint8(20 + y), A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	processed, err := fitImageToAspectRatio(encoded.Bytes(), "image/png", "3:4")
	if err != nil {
		t.Fatalf("fit image: %v", err)
	}
	result, _, err := image.Decode(bytes.NewReader(processed))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if result.Bounds().Dx() != 6 || result.Bounds().Dy() != 8 {
		t.Fatalf("dimensions = %dx%d, want 6x8", result.Bounds().Dx(), result.Bounds().Dy())
	}
	if got := float64(result.Bounds().Dx()) / float64(result.Bounds().Dy()); got != 0.75 {
		t.Fatalf("aspect ratio = %.4f, want 0.75", got)
	}
	for point := range map[image.Point]struct{}{{X: 1, Y: 3}: {}, {X: 4, Y: 4}: {}} {
		gotR, gotG, gotB, gotA := result.At(point.X, point.Y).RGBA()
		wantR, wantG, wantB, wantA := source.At(point.X-1, point.Y-3).RGBA()
		if gotR != wantR || gotG != wantG || gotB != wantB || gotA != wantA {
			t.Fatalf("pixel %v = %#v, want %#v", point, result.At(point.X, point.Y), source.At(point.X-1, point.Y-3))
		}
	}
}
