package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"sweet-potato-go/internal/store"
)

type llmBillingProfile struct {
	Multiplier              float64
	InputCreditsPer1M       float64
	OutputCreditsPer1M      float64
	CachedInputCreditsPer1M float64
	MaxOutputCreditsReserve float64
}

func (s *Server) llmBillingProfile(model store.ModelConfig) (llmBillingProfile, error) {
	profile := llmBillingProfile{Multiplier: 1}
	billing := objectValue(model.Settings["billing"])
	profile.Multiplier = toNumber(billing["multiplier"], 1)
	profile.InputCreditsPer1M = toNumber(billing["inputCreditsPer1M"], toNumber(billing["inputUsdPer1M"], 0))
	profile.OutputCreditsPer1M = toNumber(billing["outputCreditsPer1M"], toNumber(billing["outputUsdPer1M"], 0))
	profile.CachedInputCreditsPer1M = toNumber(billing["cachedInputCreditsPer1M"], toNumber(billing["cachedInputUsdPer1M"], 0))
	profile.MaxOutputCreditsReserve = toNumber(billing["maxOutputCreditsForReserve"], toNumber(billing["maxOutputTokensForReserve"], 0))
	if profile.InputCreditsPer1M == 0 && profile.OutputCreditsPer1M == 0 && profile.CachedInputCreditsPer1M == 0 {
		pricing, found, err := s.store.FindPricing(model.Provider, model.Model)
		if err != nil {
			return profile, err
		}
		if found {
			profile.InputCreditsPer1M = pricing.InputPricePer1M
			profile.OutputCreditsPer1M = pricing.OutputPricePer1M
			profile.CachedInputCreditsPer1M = pricing.CachedInputPricePer1M
		}
	}
	if profile.Multiplier < 0 || profile.InputCreditsPer1M < 0 || profile.OutputCreditsPer1M < 0 || profile.CachedInputCreditsPer1M < 0 || profile.MaxOutputCreditsReserve < 0 {
		return profile, errors.New("LLM 计费配置不能为负数")
	}
	return profile, nil
}

func (profile llmBillingProfile) cost(usage responsesUsage) float64 {
	inputTokens := usage.InputTokens - usage.CachedInputTokens
	if inputTokens < 0 {
		inputTokens = 0
	}
	base := float64(inputTokens)*profile.InputCreditsPer1M/1_000_000 +
		float64(usage.CachedInputTokens)*profile.CachedInputCreditsPer1M/1_000_000 +
		float64(usage.OutputTokens)*profile.OutputCreditsPer1M/1_000_000
	if base < 0 {
		return 0
	}
	return base * profile.Multiplier
}

func (s *Server) callBillableResponses(ctx context.Context, userID, sourceType, sourceID string, model store.ModelConfig, input []map[string]any, tools []map[string]any) (responsesResult, error) {
	// Internal protocol tests may construct a Server without an authenticated
	// store user; retain the raw transport behavior for those callers.
	if strings.TrimSpace(userID) == "" {
		return callResponsesContext(ctx, model, input, tools)
	}
	if _, found, err := s.store.FindUserByID(userID); err != nil || !found {
		return callResponsesContext(ctx, model, input, tools)
	}
	settings, err := s.store.GetBillingSettings()
	if err != nil {
		return responsesResult{}, fmt.Errorf("读取计费设置失败: %w", err)
	}
	if !settings.Enabled {
		return callResponsesContext(ctx, model, input, tools)
	}
	if strings.TrimSpace(sourceType) == "" {
		sourceType = "chat_llm"
	}
	profile, err := s.llmBillingProfile(model)
	if err != nil {
		return responsesResult{}, err
	}
	snapshot := map[string]any{
		"modelConfigId":              model.ID,
		"provider":                   model.Provider,
		"model":                      model.Model,
		"multiplier":                 profile.Multiplier,
		"inputCreditsPer1M":          profile.InputCreditsPer1M,
		"outputCreditsPer1M":         profile.OutputCreditsPer1M,
		"cachedInputCreditsPer1M":    profile.CachedInputCreditsPer1M,
		"maxOutputCreditsForReserve": profile.MaxOutputCreditsReserve,
	}
	reservationID, err := s.store.ReserveCredits(userID, sourceType, sourceID, profile.MaxOutputCreditsReserve, snapshot)
	if err != nil {
		return responsesResult{}, err
	}
	result, err := callResponsesContext(ctx, model, input, tools)
	if err != nil {
		_ = s.store.ReleaseCredits(reservationID, userID)
		return responsesResult{}, fmt.Errorf("调用模型失败: %w", err)
	}
	if reservationID != "" {
		usage := store.LLMUsageSettlement{
			ModelConfigID: model.ID, SourceType: sourceType, SourceID: sourceID,
			PromptTokens: result.Usage.InputTokens, CompletionTokens: result.Usage.OutputTokens,
			CachedPromptTokens: result.Usage.CachedInputTokens,
			UsageRaw:           map[string]any{"inputTokens": result.Usage.InputTokens, "outputTokens": result.Usage.OutputTokens, "totalTokens": result.Usage.TotalTokens, "estimated": result.Usage.Estimated},
			BillingSnapshot:    snapshot,
		}
		if err := s.store.SettleLLMReservation(reservationID, userID, profile.cost(result.Usage), usage); err != nil {
			return responsesResult{}, fmt.Errorf("结算模型调用费用失败: %w", err)
		}
	}
	return result, nil
}

func modelSourceID(id string) string {
	if strings.TrimSpace(id) == "" {
		return "chat-llm"
	}
	return id
}
