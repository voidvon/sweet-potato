package httpapi

import (
	"testing"

	"sweet-potato-go/internal/store"
)

func TestParseResponsesSSECapturesTokenUsage(t *testing.T) {
	raw := []byte("event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"ok\",\"output\":[{\"type\":\"message\"}],\"usage\":{\"input_tokens\":1200,\"input_tokens_details\":{\"cached_tokens\":400},\"output_tokens\":80,\"output_tokens_details\":{\"reasoning_tokens\":25},\"total_tokens\":1280}}}\n\n")
	result, err := parseResponsesSSE(raw)
	if err != nil {
		t.Fatalf("parse SSE: %v", err)
	}
	if result.Usage.InputTokens != 1200 || result.Usage.CachedInputTokens != 400 || result.Usage.OutputTokens != 80 || result.Usage.ReasoningTokens != 25 || result.Usage.TotalTokens != 1280 {
		t.Fatalf("usage = %#v", result.Usage)
	}
}

func TestImageDialogContextUsageCalculatesCatalogWindow(t *testing.T) {
	model := store.ModelConfig{
		ID:    "llm-1",
		Model: "example-model",
	}
	capacity := resolveModelContextCapacity(&store.LlmModelPricing{ContextWindowTokens: 128000, EffectiveWindowPercent: 95})
	usage := buildImageDialogContextUsage(model, responsesUsage{InputTokens: 30000, OutputTokens: 2000, TotalTokens: 32000}, capacity)
	if got, _ := usage["contextWindow"].(int64); got != 121600 {
		t.Fatalf("context window = %d", got)
	}
	if got := int(numberValue(usage["usedPercent"], 0)); got != 26 {
		t.Fatalf("used percent = %d", got)
	}
	if got := int(numberValue(usage["remainingPercent"], 0)); got != 74 {
		t.Fatalf("remaining percent = %d", got)
	}
}

func TestImageDialogContextUsageKeepsTokenCountWithoutWindow(t *testing.T) {
	usage := buildImageDialogContextUsage(store.ModelConfig{ID: "llm-1"}, responsesUsage{TotalTokens: 1234}, modelContextCapacity{})
	if got, _ := usage["usedTokens"].(int64); got != 1234 {
		t.Fatalf("used tokens = %d", got)
	}
	if _, ok := usage["usedPercent"]; ok {
		t.Fatalf("usage unexpectedly contains percentage: %#v", usage)
	}
}

func TestResolveModelContextCapacityUsesCatalog(t *testing.T) {
	pricing := &store.LlmModelPricing{ContextWindowTokens: 200000, EffectiveWindowPercent: 90}
	catalogCapacity := resolveModelContextCapacity(pricing)
	if catalogCapacity.RawTokens != 200000 || catalogCapacity.EffectiveTokens != 180000 || catalogCapacity.Source != "catalog" {
		t.Fatalf("catalog capacity = %#v", catalogCapacity)
	}
	defaultPercentCapacity := resolveModelContextCapacity(&store.LlmModelPricing{ContextWindowTokens: 100000})
	if defaultPercentCapacity.EffectiveTokens != 95000 || defaultPercentCapacity.EffectivePercent != 95 {
		t.Fatalf("default percent capacity = %#v", defaultPercentCapacity)
	}
}

func TestEstimateResponsesUsageDiscountsInlineImagePayload(t *testing.T) {
	imageData := "data:image/jpeg;base64," + string(make([]byte, 200000))
	usage := estimateResponsesUsage(
		[]map[string]any{{"role": "user", "content": []any{map[string]any{"type": "input_image", "image_url": imageData}}}},
		nil,
		responsesResult{OutputText: "ok"},
	)
	if !usage.Estimated {
		t.Fatal("usage must be marked as estimated")
	}
	if usage.InputTokens < 1800 || usage.InputTokens > 2200 {
		t.Fatalf("input tokens = %d, want resized-image estimate", usage.InputTokens)
	}
}
