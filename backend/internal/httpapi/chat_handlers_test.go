package httpapi

import (
	"strings"
	"testing"

	"sweet-potato-go/internal/imagegen"
)

func TestImageDecisionFallbackOnlyMatchesExplicitGenerationRefusal(t *testing.T) {
	cases := []struct {
		content string
		answer  string
		want    bool
	}{
		{"请生成一张橘猫坐在窗台上的图片", "当前对话无法直接输出图片文件，请使用任意图像生成工具", true},
		{"请生成一张橘猫坐在窗台上的图片", "这张图适合暖色调摄影风格。", false},
		{"这张图片应该用什么尺寸？", "当前对话无法直接输出图片文件", false},
	}
	for _, test := range cases {
		got := explicitImageIntent(test.content) && imageDecisionNeedsFallback(test.answer)
		if got != test.want {
			t.Errorf("content=%q answer=%q got=%v want=%v", test.content, test.answer, got, test.want)
		}
	}
}

func TestResponsesOutputTextUsesMessageOutputText(t *testing.T) {
	result := responsesResult{Output: []responsesOutputItem{{Type: "message", Content: []responsesOutputContent{{Type: "output_text", Text: "生成完成"}}}}}
	if got := responseOutputText(result); got != "生成完成" {
		t.Fatalf("output text = %q", got)
	}
}

func TestImageGenerationToolUsesSupportedBackgroundValues(t *testing.T) {
	tool := imageGenerationTool()
	parameters := tool["parameters"].(map[string]any)
	properties := parameters["properties"].(map[string]any)
	background := properties["background"].(map[string]any)
	enum := background["enum"].([]string)
	want := []string{"transparent", "opaque", "auto"}
	if len(enum) != len(want) {
		t.Fatalf("background enum = %#v, want %#v", enum, want)
	}
	for index := range want {
		if enum[index] != want[index] {
			t.Fatalf("background enum = %#v, want %#v", enum, want)
		}
	}
}

func TestImageGenerationPromptFallsBackToModeHint(t *testing.T) {
	server := &Server{}
	contextValue := map[string]any{
		"imageGeneration": map[string]any{
			"modeKey":    "cutout",
			"promptText": "",
			"promptHint": "把 图1 的背景去掉，按所选底色输出。",
		},
	}
	if got := server.imageGenerationPrompt("", contextValue, nil); got != "把 图1 的背景去掉，按所选底色输出。" {
		t.Fatalf("prompt = %q", got)
	}
}

func TestPrepareCutoutGenerationUsesOpaqueGreenScreen(t *testing.T) {
	prompt, options, applyChromaKey := prepareCutoutGeneration("移除背景", "cutout", imagegen.GenerateInput{Background: "transparent"})
	if !applyChromaKey {
		t.Fatal("expected chroma key processing")
	}
	if options.Background != "opaque" || options.OutputFormat != "png" {
		t.Fatalf("options = %+v", options)
	}
	if !strings.Contains(prompt, "#00FF00") || !strings.Contains(prompt, "不透明图片") {
		t.Fatalf("prompt = %q", prompt)
	}
}

func TestPrepareCutoutGenerationLeavesOpaqueOutputUnchanged(t *testing.T) {
	prompt, options, applyChromaKey := prepareCutoutGeneration("移除背景", "cutout", imagegen.GenerateInput{Background: "opaque"})
	if applyChromaKey {
		t.Fatal("opaque output must not use chroma key processing")
	}
	if prompt != "移除背景" || options.Background != "opaque" || options.OutputFormat != "" {
		t.Fatalf("prompt = %q, options = %+v", prompt, options)
	}
}
