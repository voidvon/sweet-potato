package httpapi

import "testing"

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
