package httpapi

import (
	"log/slog"
	"math"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
)

type modelContextCapacity struct {
	RawTokens        int64
	EffectiveTokens  int64
	EffectivePercent int
	Source           string
}

func (s *Server) imageDialogContextUsage(model store.ModelConfig, usage responsesUsage) map[string]any {
	if usage.TotalTokens <= 0 {
		return nil
	}
	var pricing *store.LlmModelPricing
	if item, found, err := s.store.FindPricing(model.Provider, model.Model); err != nil {
		slog.Warn("failed to resolve model context metadata", "provider", model.Provider, "model", model.Model, "error", err)
	} else if found {
		pricing = &item
	}
	return buildImageDialogContextUsage(model, usage, resolveModelContextCapacity(pricing))
}

func buildImageDialogContextUsage(model store.ModelConfig, usage responsesUsage, capacity modelContextCapacity) map[string]any {
	if usage.TotalTokens <= 0 {
		return nil
	}
	result := map[string]any{
		"modelConfigId":     model.ID,
		"model":             model.Model,
		"inputTokens":       usage.InputTokens,
		"cachedInputTokens": usage.CachedInputTokens,
		"outputTokens":      usage.OutputTokens,
		"reasoningTokens":   usage.ReasoningTokens,
		"usedTokens":        usage.TotalTokens,
		"estimated":         usage.Estimated,
		"updatedAt":         time.Now().UTC().Format(time.RFC3339Nano),
	}
	if capacity.EffectiveTokens > 0 {
		usedPercent := int(math.Round(float64(usage.TotalTokens) / float64(capacity.EffectiveTokens) * 100))
		if usedPercent < 0 {
			usedPercent = 0
		}
		if usedPercent > 100 {
			usedPercent = 100
		}
		result["contextWindow"] = capacity.EffectiveTokens
		result["maxContextWindow"] = capacity.RawTokens
		result["effectiveContextWindowPercent"] = capacity.EffectivePercent
		result["contextWindowSource"] = capacity.Source
		result["usedPercent"] = usedPercent
		result["remainingPercent"] = 100 - usedPercent
	}
	return result
}

func resolveModelContextCapacity(pricing *store.LlmModelPricing) modelContextCapacity {
	if pricing == nil || pricing.ContextWindowTokens <= 0 {
		return modelContextCapacity{}
	}
	effectivePercent := pricing.EffectiveWindowPercent
	if effectivePercent <= 0 {
		effectivePercent = 95
	}
	if effectivePercent > 100 {
		effectivePercent = 100
	}
	return modelContextCapacity{
		RawTokens:        pricing.ContextWindowTokens,
		EffectiveTokens:  pricing.ContextWindowTokens * int64(effectivePercent) / 100,
		EffectivePercent: effectivePercent,
		Source:           "catalog",
	}
}

func isImageAgentContext(contextValue map[string]any) bool {
	generation := objectValue(contextValue["imageGeneration"])
	modeKey := strings.ToLower(strings.TrimSpace(stringValue(generation, "modeKey")))
	return modeKey == "dialog" || modeKey == "detail" || modeKey == "main"
}
