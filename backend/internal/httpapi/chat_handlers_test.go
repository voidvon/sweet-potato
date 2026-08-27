package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"sweet-potato-go/internal/imagegen"
	"sweet-potato-go/internal/store"
)

func TestChatTurnInterruptCancelsActiveContext(t *testing.T) {
	serverConnection, clientConnection := net.Pipe()
	defer serverConnection.Close()
	defer clientConnection.Close()
	ctx, cancel := context.WithCancel(context.Background())
	session := &chatWebSocketSession{connection: serverConnection, active: &activeChatTurn{id: "turn-1", cancel: cancel}}
	response := make(chan map[string]any, 1)
	go func() {
		payload, _, err := readWebSocketFrame(clientConnection)
		if err != nil {
			response <- map[string]any{"readError": err.Error()}
			return
		}
		var value map[string]any
		_ = json.Unmarshal(payload, &value)
		response <- value
	}()
	if err := session.interruptTurn(chatTurnCommand{ID: "interrupt-1", Params: json.RawMessage(`{"turnId":"turn-1"}`)}); err != nil {
		t.Fatalf("interrupt turn: %v", err)
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("active turn context was not canceled")
	}
	select {
	case value := <-response:
		if value["id"] != "interrupt-1" || value["error"] != nil {
			t.Fatalf("response = %#v", value)
		}
	case <-time.After(time.Second):
		t.Fatal("interrupt response was not written")
	}
}

func TestCallResponsesContextCancelsUpstreamRequest(t *testing.T) {
	requestStarted := make(chan struct{})
	requestCanceled := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
		close(requestCanceled)
	}))
	defer upstream.Close()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := callResponsesContext(ctx, store.ModelConfig{Provider: "test", Model: "test", APIKey: "test", BaseURL: upstream.URL}, []map[string]any{{"role": "user", "content": "hello"}}, nil)
		done <- err
	}()
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("upstream request did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want context canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("callResponsesContext did not stop after cancellation")
	}
	select {
	case <-requestCanceled:
	case <-time.After(time.Second):
		t.Fatal("upstream request context was not canceled")
	}
}

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

func TestParseResponsesSSEReturnsCompletedResponse(t *testing.T) {
	raw := []byte("event: response.created\ndata: {\"type\":\"response.created\"}\n\n" +
		"event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"生成\"}\n\n" +
		"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"生成完成\",\"output\":[{\"type\":\"message\"}]}}\n\n")
	result, err := parseResponsesSSE(raw)
	if err != nil {
		t.Fatalf("parse SSE: %v", err)
	}
	if result.OutputText != "生成完成" || len(result.Output) != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestParseResponsesSSEReconstructsFunctionCallFromStream(t *testing.T) {
	raw := []byte("event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"name\":\"image_generation\",\"arguments\":\"\"}}\n\n" +
		"event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"delta\":\"{\\\"prompt\\\":\\\"cat\\\"}\"}\n\n" +
		"event: response.function_call_arguments.done\ndata: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"fc_1\",\"arguments\":\"{\\\"prompt\\\":\\\"cat\\\"}\"}\n\n" +
		"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n")
	result, err := parseResponsesSSE(raw)
	if err != nil {
		t.Fatalf("parse SSE: %v", err)
	}
	if len(result.Output) != 1 || result.Output[0].Type != "function_call" || result.Output[0].Name != "image_generation" || result.Output[0].Arguments != `{"prompt":"cat"}` {
		t.Fatalf("result = %#v", result)
	}
}

func TestParseResponsesSSEReturnsProviderFailure(t *testing.T) {
	_, err := parseResponsesSSE([]byte("event: response.failed\ndata: {\"type\":\"response.failed\",\"error\":{\"message\":\"quota exceeded\"}}\n\n"))
	if err == nil || !strings.Contains(err.Error(), "quota exceeded") {
		t.Fatalf("error = %v", err)
	}
}

func TestResponsesSSEDiagnosticsSummarizesProviderStream(t *testing.T) {
	raw := []byte("event: response.created\ndata: {\"type\":\"response.created\"}\n\n" +
		"data: [DONE]\n\n")
	diagnostics := responsesSSEDiagnostics(raw)
	if diagnostics["hasDone"] != true || diagnostics["hasCompleted"] != false {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	events, ok := diagnostics["events"].([]string)
	if !ok || len(events) != 1 || events[0] != "response.created" {
		t.Fatalf("events = %#v", diagnostics["events"])
	}
}

func TestImageGenerationToolUsesSupportedBackgroundValues(t *testing.T) {
	tool := imageGenerationTool()
	parameters := tool["parameters"].(map[string]any)
	properties := parameters["properties"].(map[string]any)
	count := properties["count"].(map[string]any)
	if got := int(numberValue(count["maximum"], 0)); got != 12 {
		t.Fatalf("count maximum = %d, want 12", got)
	}
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

func TestApplyImageToolArgumentsPreservesSelectedOutputCount(t *testing.T) {
	contextValue := map[string]any{"imageGeneration": map[string]any{"outputCount": 8}}
	result := applyImageToolArguments(contextValue, map[string]any{"count": 3})
	if got := int(numberValue(objectValue(result["imageGeneration"])["outputCount"], 0)); got != 8 {
		t.Fatalf("output count = %d, want selected count 8", got)
	}

	autoResult := applyImageToolArguments(
		map[string]any{"imageGeneration": map[string]any{}},
		map[string]any{"count": 6},
	)
	if got := int(numberValue(objectValue(autoResult["imageGeneration"])["outputCount"], 0)); got != 6 {
		t.Fatalf("automatic output count = %d, want tool count 6", got)
	}
	chapterPrompts := []any{"章节一", "章节二"}
	chapterReferenceIDs := []any{[]any{"asset-1"}, []any{"asset-2", "asset-1"}}
	detailResult := applyImageToolArguments(
		map[string]any{"imageGeneration": map[string]any{"modeKey": "detail"}},
		map[string]any{"count": 2, "chapter_prompts": chapterPrompts, "chapter_reference_asset_ids": chapterReferenceIDs},
	)
	storedPrompts := objectValue(detailResult["imageGeneration"])["chapterPrompts"].([]any)
	if len(storedPrompts) != 2 || storedPrompts[1] != "章节二" {
		t.Fatalf("chapter prompts = %#v", storedPrompts)
	}
	storedReferenceIDs := nestedStringSlices(objectValue(detailResult["imageGeneration"])["chapterReferenceAssetIds"])
	if len(storedReferenceIDs) != 2 || len(storedReferenceIDs[1]) != 2 || storedReferenceIDs[1][0] != "asset-2" {
		t.Fatalf("chapter reference IDs = %#v", storedReferenceIDs)
	}
}

func TestDetailImagePromptsRequiresOnePromptPerImage(t *testing.T) {
	generation := map[string]any{
		"modeKey":        "detail",
		"chapterPrompts": []any{" 产品全景 ", "材质细节"},
	}
	prompts, err := detailImagePrompts(generation, "总体规划", 2)
	if err != nil {
		t.Fatalf("detail prompts: %v", err)
	}
	if len(prompts) != 2 || !strings.HasPrefix(prompts[0], "产品全景\n\n公共约束") || !strings.HasPrefix(prompts[1], "材质细节\n\n公共约束") {
		t.Fatalf("detail prompts = %#v", prompts)
	}
	if _, err := detailImagePrompts(generation, "总体规划", 3); err == nil || !strings.Contains(err.Error(), "数量") {
		t.Fatalf("mismatched detail prompts error = %v", err)
	}

	normalPrompts, err := detailImagePrompts(map[string]any{"modeKey": "dialog"}, "普通提示词", 3)
	if err != nil || len(normalPrompts) != 1 || normalPrompts[0] != "普通提示词" {
		t.Fatalf("normal prompts = %#v, err = %v", normalPrompts, err)
	}
}

func TestDetailImageReferenceSetsPreservePerChapterPrimaryOrder(t *testing.T) {
	assets := []store.ContentAsset{{ID: "asset-1"}, {ID: "asset-2"}, {ID: "asset-3"}}
	generation := map[string]any{
		"modeKey": "detail",
		"chapterReferenceAssetIds": []any{
			[]any{"asset-2", "asset-1"},
			[]any{"asset-3"},
		},
	}
	sets, err := detailImageReferenceSets(generation, 2, assets)
	if err != nil {
		t.Fatalf("detail reference sets: %v", err)
	}
	if len(sets) != 2 || len(sets[0]) != 2 || sets[0][0].ID != "asset-2" || sets[1][0].ID != "asset-3" {
		t.Fatalf("detail reference sets = %#v", sets)
	}
	if _, err := detailImageReferenceSets(generation, 3, assets); err == nil || !strings.Contains(err.Error(), "数量") {
		t.Fatalf("mismatched reference sets error = %v", err)
	}
}

func TestImageGenerationResultContextRecordsResolvedInputAndReferences(t *testing.T) {
	references := []store.ContentAsset{{
		ID:               "reference-2",
		OriginalFileName: "figure-2.png",
		MimeType:         "image/png",
		FileSize:         128,
		FileURL:          "/files/figure-2.png",
	}}
	contextValue := imageGenerationResultContext(
		map[string]any{"modeKey": "dialog", "modeTitle": "对话生图"},
		"参考图2重新生成",
		"仅以第二张图为视觉参考",
		references,
	)
	generation := objectValue(contextValue["imageGeneration"])
	if got := stringValue(generation, "resolvedPrompt"); got != "仅以第二张图为视觉参考" {
		t.Fatalf("resolved prompt = %q", got)
	}
	if got := stringValue(generation, "requestMode"); got != "edit" {
		t.Fatalf("request mode = %q, want edit", got)
	}
	if got := int(numberValue(generation["referenceCount"], 0)); got != 1 {
		t.Fatalf("reference count = %d, want 1", got)
	}
	attachments, ok := generation["referenceAttachments"].([]any)
	if !ok || len(attachments) != 1 || stringValue(objectValue(attachments[0]), "assetId") != "reference-2" {
		t.Fatalf("reference attachments = %#v", generation["referenceAttachments"])
	}
	output := chatGeneratedImageAttachmentPayload(store.ContentAsset{
		ID:               "output-1",
		OriginalFileName: "detail-1.png",
		MimeType:         "image/png",
		FileURL:          "/files/detail-1.png",
	}, 1, "仅生成材质细节章节", references)
	if got := int(numberValue(output["imageGenerationSlotIndex"], -1)); got != 1 {
		t.Fatalf("output slot = %d", got)
	}
	if got := stringValue(output, "imageGenerationPrompt"); got != "仅生成材质细节章节" {
		t.Fatalf("output prompt = %q", got)
	}
	outputReferences, ok := output["imageGenerationReferenceAttachments"].([]any)
	if !ok || len(outputReferences) != 1 || stringValue(objectValue(outputReferences[0]), "assetId") != "reference-2" {
		t.Fatalf("output references = %#v", output["imageGenerationReferenceAttachments"])
	}
}

func TestAgentResponsesToolsIncludesHostedWebSearchWhenEnabled(t *testing.T) {
	tools := agentResponsesTools(store.Agent{WebSearchEnabled: true}, imageGenerationTool())
	if len(tools) != 2 {
		t.Fatalf("tools = %#v", tools)
	}
	if tools[0]["name"] != "image_generation" || tools[1]["type"] != "web_search" {
		t.Fatalf("tools = %#v", tools)
	}
}

func TestAgentResponsesToolsOmitsWebSearchWhenDisabled(t *testing.T) {
	if tools := agentResponsesTools(store.Agent{}); len(tools) != 0 {
		t.Fatalf("tools = %#v", tools)
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

func TestDetailImageGenerationSystemPromptUsesWorkspaceSelections(t *testing.T) {
	prompt := detailImageGenerationSystemPrompt(map[string]any{
		"imageGeneration": map[string]any{
			"modeKey":     "detail",
			"aspectRatio": "16:9",
			"resolution":  "4K",
			"outputCount": 6,
		},
	})
	for _, want := range []string{"淘宝宝贝详情图生成", "严格保持该比例", "16:9", "4K", "生成 6 张", "PDF", "850px", "移动端", "不得猜测", "chapter_prompts", "chapter_reference_asset_ids", "插图方案", "实拍照片是唯一的实体产品事实来源", "允许某章完全不携带实拍产品图", "禁止幻想新的角度、铭牌"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("detail prompt missing %q: %s", want, prompt)
		}
	}

	automaticPrompt := detailImageGenerationSystemPrompt(map[string]any{
		"imageGeneration": map[string]any{"modeKey": "detail", "aspectRatio": "auto"},
	})
	if !strings.Contains(automaticPrompt, "默认优先使用 3:4") || !strings.Contains(automaticPrompt, "在 1 到 12 个章节内选择数量") {
		t.Fatalf("automatic detail prompt = %s", automaticPrompt)
	}
	if got := detailImageGenerationSystemPrompt(map[string]any{"imageGeneration": map[string]any{"modeKey": "dialog"}}); got != "" {
		t.Fatalf("dialog mode unexpectedly received detail prompt: %s", got)
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
