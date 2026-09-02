package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"sweet-potato-go/internal/store"
)

func (s *Server) organizeRemotionScenes(ctx context.Context, session store.ContentPlanningSession, model store.ModelConfig, capabilities map[string]any) (map[string]any, error) {
	images := anySlice(objectValue(session.Analysis["campaignImageGeneration"])["images"])
	inputJSON, err := json.Marshal(map[string]any{
		"campaignPlan": objectValue(session.Analysis["campaignPlan"]),
		"images":       images,
		"capabilities": capabilities,
	})
	if err != nil {
		return nil, err
	}
	parts := []map[string]any{{"type": "input_text", "text": string(inputJSON)}}
	for _, value := range images {
		image := objectValue(value)
		assetID := stringValue(image, "assetId")
		asset, found, assetErr := s.store.FindContentAsset(assetID)
		if assetErr != nil || !found || asset.UserID != session.UserID || !strings.HasPrefix(strings.ToLower(asset.MimeType), "image/") {
			continue
		}
		thumbnail, thumbnailErr := imageDecisionThumbnailDataURL(asset.FilePath, 768)
		if thumbnailErr != nil {
			continue
		}
		parts = append(parts,
			map[string]any{"type": "input_text", "text": fmt.Sprintf("以下图片对应 scene_id=%s、asset_id=%s。请根据图片主体、明暗和留白选择该场景文案的位置与颜色。", stringValue(image, "sceneId"), assetID)},
			map[string]any{"type": "input_image", "image_url": thumbnail, "detail": "low"},
		)
	}
	input := []map[string]any{
		{"role": "system", "content": "你是专业的营销视频分镜与视觉设计导演。只使用插件 capabilities 中声明的分类动效，不创建能力 ID，不改变文案事实，不遗漏已生成图片。必须调用 submit_motion_plan。你会收到每张成片图片的视觉预览；必须结合图片主体、留白、局部明暗和文案长度，为每个场景选择主副标题组成的统一文案块位置与高对比度的六位十六进制颜色，避开人物、产品和视觉焦点。titlePosition 与 subtitlePosition 必须选择相同位置，保持主副标题层级紧凑，不得将副标题单独放到画面另一处。不得依赖遮罩、色块或统一固定颜色解决可读性。继续编排文字入场与强调、图片持续运动与图片切换、场景转场和字幕动效。相邻场景应有节奏变化，副标题和字幕保持克制。"},
		{"role": "user", "content": parts},
	}
	tool, err := remotionMotionPlanTool(capabilities)
	if err != nil {
		return nil, err
	}
	result, err := s.callRemotionOrganizerResponses(ctx, session, model, input, tool)
	if err != nil {
		return nil, err
	}
	for _, item := range result.Output {
		if item.Type != "function_call" || item.Name != "submit_motion_plan" || strings.TrimSpace(item.Arguments) == "" {
			continue
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(item.Arguments), &raw); err != nil {
			return nil, fmt.Errorf("解析 AI 动效编排: %w", err)
		}
		if len(anySlice(raw["scenes"])) == 0 {
			return nil, errors.New("AI 动效编排没有返回场景")
		}
		return raw, nil
	}
	return nil, errors.New("AI 动效编排没有返回有效结果")
}

func (s *Server) callRemotionOrganizerResponses(ctx context.Context, session store.ContentPlanningSession, model store.ModelConfig, input []map[string]any, tool map[string]any) (responsesResult, error) {
	settings, err := s.store.GetBillingSettings()
	if err != nil {
		return responsesResult{}, fmt.Errorf("读取分镜编排计费设置: %w", err)
	}
	tools := []map[string]any{tool}
	if !settings.Enabled || settings.ContentPlanningAnalysisCredits <= 0 {
		return callResponsesContext(ctx, model, input, tools)
	}
	cost := settings.ContentPlanningAnalysisCredits
	snapshot := map[string]any{"modelConfigId": model.ID, "provider": model.Provider, "model": model.Model, "creditsPerRequest": cost}
	reservationID, err := s.store.ReserveCredits(session.UserID, "content_planning_remotion_arrangement", session.ID, cost, snapshot)
	if err != nil {
		return responsesResult{}, err
	}
	result, err := callResponsesContext(ctx, model, input, tools)
	if err != nil {
		_ = s.store.ReleaseCredits(reservationID, session.UserID)
		return responsesResult{}, fmt.Errorf("调用分镜编排模型: %w", err)
	}
	usage := store.LLMUsageSettlement{ModelConfigID: model.ID, SourceType: "content_planning_remotion_arrangement", SourceID: session.ID, PromptTokens: result.Usage.InputTokens, CompletionTokens: result.Usage.OutputTokens, CachedPromptTokens: result.Usage.CachedInputTokens, UsageRaw: map[string]any{"inputTokens": result.Usage.InputTokens, "outputTokens": result.Usage.OutputTokens, "totalTokens": result.Usage.TotalTokens, "estimated": result.Usage.Estimated}, BillingSnapshot: snapshot}
	if err := s.store.SettleLLMReservation(reservationID, session.UserID, cost, usage); err != nil {
		return responsesResult{}, fmt.Errorf("结算分镜编排费用: %w", err)
	}
	return result, nil
}

func remotionMotionPlanTool(capabilities map[string]any) (map[string]any, error) {
	enum := func(category string) ([]string, error) {
		values := remotionCapabilityIDs(capabilities, category)
		if len(values) == 0 {
			return nil, fmt.Errorf("Remotion 插件未声明 %s 能力", category)
		}
		return values, nil
	}
	textEntrance, err := enum("textEntrance")
	if err != nil {
		return nil, err
	}
	textEmphasis, err := enum("textEmphasis")
	if err != nil {
		return nil, err
	}
	imageMotion, err := enum("imageMotion")
	if err != nil {
		return nil, err
	}
	imageTransition, err := enum("imageTransition")
	if err != nil {
		return nil, err
	}
	sceneTransition, err := enum("sceneTransition")
	if err != nil {
		return nil, err
	}
	captionAnimation, err := enum("captionAnimation")
	if err != nil {
		return nil, err
	}
	positions := stringSlice(capabilities["textPositions"])
	if len(positions) == 0 {
		return nil, errors.New("Remotion 插件未声明文字位置")
	}
	stringEnum := func(values []string) map[string]any { return map[string]any{"type": "string", "enum": values} }
	stringArray := map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
	scene := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"sceneId", "imageAssetIds", "layout", "text", "image", "scene", "caption"},
		"properties": map[string]any{
			"sceneId": map[string]any{"type": "string"}, "imageAssetIds": stringArray,
			"layout":  map[string]any{"type": "object", "additionalProperties": false, "required": []string{"titlePosition", "subtitlePosition"}, "properties": map[string]any{"titlePosition": stringEnum(positions), "subtitlePosition": stringEnum(positions)}},
			"text":    map[string]any{"type": "object", "additionalProperties": false, "required": []string{"titleEntrance", "subtitleEntrance", "emphasis", "titleColor", "subtitleColor"}, "properties": map[string]any{"titleEntrance": stringEnum(textEntrance), "subtitleEntrance": stringEnum(textEntrance), "emphasis": stringEnum(textEmphasis), "titleColor": map[string]any{"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"}, "subtitleColor": map[string]any{"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"}}},
			"image":   map[string]any{"type": "object", "additionalProperties": false, "required": []string{"motion", "transition"}, "properties": map[string]any{"motion": stringEnum(imageMotion), "transition": stringEnum(imageTransition)}},
			"scene":   map[string]any{"type": "object", "additionalProperties": false, "required": []string{"transition"}, "properties": map[string]any{"transition": stringEnum(sceneTransition)}},
			"caption": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"animation"}, "properties": map[string]any{"animation": stringEnum(captionAnimation)}},
		},
	}
	return map[string]any{"type": "function", "name": "submit_motion_plan", "description": "提交分类化视频动效编排", "strict": true, "parameters": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"scenes"}, "properties": map[string]any{"scenes": map[string]any{"type": "array", "items": scene}}}}, nil
}

func remotionCapabilityIDs(capabilities map[string]any, category string) []string {
	result := []string{}
	for _, value := range anySlice(objectValue(capabilities["motion"])[category]) {
		if id := stringValue(objectValue(value), "id"); id != "" {
			result = append(result, id)
		}
	}
	return result
}
