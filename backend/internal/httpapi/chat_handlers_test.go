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
