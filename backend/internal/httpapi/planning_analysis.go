package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"sweet-potato-go/internal/assetextract"
	"sweet-potato-go/internal/store"
)

const (
	planningAnalysisMaxImages = 16
	planningAnalysisMaxText   = 60000
)

type planningAnalysisContext struct {
	text       string
	images     []store.ContentAsset
	assetRefs  map[string]map[string]any
	warnings   []string
	sourceInfo []string
}

func (s *Server) queuePlanningAnalysis(session store.ContentPlanningSession, input map[string]any) (store.ContentPlanningSession, error) {
	if session.Status == "analyzing" {
		return session, errors.New("当前策划会话正在分析")
	}
	media := planningAnalysisMedia(input)
	imageMaterials := []any{}
	documentMaterials := []any{}
	var referenceVideo, referenceAudio any
	seen := map[string]bool{}
	for _, item := range media {
		assetID := strings.TrimSpace(fmt.Sprint(item["assetId"]))
		if assetID == "" || seen[assetID] {
			continue
		}
		asset, found, err := s.store.FindContentAsset(assetID)
		if err != nil {
			return session, fmt.Errorf("读取附件 %s: %w", assetID, err)
		}
		if !found || asset.UserID != session.UserID {
			return session, fmt.Errorf("附件 %s 不存在或无权访问", assetID)
		}
		seen[assetID] = true
		kind := planningAnalysisAssetKind(asset, strings.TrimSpace(fmt.Sprint(item["kind"])))
		ref := planningAssetRef(asset, kind)
		switch kind {
		case "image":
			imageMaterials = append(imageMaterials, ref)
		case "video":
			if referenceVideo == nil {
				referenceVideo = ref
			}
		case "audio":
			if referenceAudio == nil {
				referenceAudio = ref
			}
		case "document":
			documentMaterials = append(documentMaterials, ref)
		default:
			return session, fmt.Errorf("附件 %s 的格式暂不支持内容分析", asset.OriginalFileName)
		}
	}

	material := session.MaterialBundle
	if material == nil {
		material = map[string]any{}
	}
	prompt := strings.TrimSpace(stringValue(input, "prompt"))
	if prompt == "" {
		prompt = strings.TrimSpace(stringValue(material, "prompt"))
	}
	productName := strings.TrimSpace(stringValue(input, "productName"))
	if productName == "" {
		productName = strings.TrimSpace(stringValue(material, "productName"))
	}
	if len(seen) == 0 && prompt == "" && productName == "" {
		return session, errors.New("请填写营销需求或至少上传一个参考附件")
	}
	material["prompt"] = prompt
	material["productName"] = productName
	material["imageMaterials"] = imageMaterials
	material["documentMaterials"] = documentMaterials
	material["referenceVideo"] = referenceVideo
	material["referenceAudio"] = referenceAudio
	session.MaterialBundle = material
	session.Analysis = defaultAnalysisHTTP()
	session.Generation = defaultPlanningGenerationHTTP()
	session.Status, session.UIStep, session.JobStage = "analyzing", "step1", "analyzing_materials"
	session.ErrorMessage = ""
	return s.store.UpdatePlanningSession(session)
}

func planningAnalysisMedia(input map[string]any) []map[string]any {
	result := []map[string]any{}
	if values, ok := input["media"].([]any); ok {
		for _, value := range values {
			if item := objectValue(value); len(item) > 0 {
				result = append(result, item)
			}
		}
	}
	for _, value := range stringSlice(input["imageAssetIds"]) {
		result = append(result, map[string]any{"assetId": value, "kind": "image"})
	}
	if value := stringValue(input, "referenceVideoAssetId"); value != "" {
		result = append(result, map[string]any{"assetId": value, "kind": "video"})
	}
	if value := stringValue(input, "referenceAudioAssetId"); value != "" {
		result = append(result, map[string]any{"assetId": value, "kind": "audio"})
	}
	return result
}

func planningAnalysisAssetKind(asset store.ContentAsset, requested string) string {
	mimeType := strings.ToLower(strings.TrimSpace(asset.MimeType))
	extension := strings.ToLower(filepath.Ext(asset.OriginalFileName))
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	case mimeType == "application/pdf" || extension == ".pdf" || extension == ".pptx" || strings.Contains(mimeType, "presentationml"):
		return "document"
	}
	switch requested {
	case "image", "video", "audio", "document", "presentation", "pdf":
		if requested == "presentation" || requested == "pdf" {
			return "document"
		}
		return requested
	default:
		return ""
	}
}

func planningAssetRef(asset store.ContentAsset, kind string) map[string]any {
	return map[string]any{
		"assetId": asset.ID, "kind": kind, "name": asset.Name, "fileUrl": asset.FileURL,
		"mimeType": asset.MimeType, "originalFileName": asset.OriginalFileName, "storedFileName": asset.StoredFileName,
	}
}

func (s *Server) executePlanningAnalysis(sessionID, requestedModelID string) {
	session, found, err := s.store.FindPlanningSession(sessionID)
	if err != nil || !found || session.Status != "analyzing" {
		return
	}
	ctx, cancel := context.WithTimeout(s.taskContext(), 4*time.Minute)
	defer cancel()
	analysisContext, err := s.buildPlanningAnalysisContext(ctx, session)
	if err != nil {
		s.failPlanningAnalysis(session, err)
		return
	}
	model, err := s.resolveLLMModelConfig(session.UserID, requestedModelID, "")
	if err != nil {
		s.failPlanningAnalysis(session, err)
		return
	}
	input := planningAnalysisModelInput(session, analysisContext)
	result, err := s.callPlanningAnalysisResponses(ctx, session, model, input)
	if err != nil {
		s.failPlanningAnalysis(session, err)
		return
	}
	raw, err := decodePlanningAnalysisResult(result)
	if err != nil {
		s.failPlanningAnalysis(session, err)
		return
	}
	session.Analysis = normalizePlanningAnalysis(raw, analysisContext)
	session.Status, session.UIStep, session.JobStage = "confirming", "step2", "completed"
	session.ErrorMessage = ""
	if _, err := s.store.UpdatePlanningSession(session); err != nil {
		s.failPlanningAnalysis(session, err)
	}
}

func (s *Server) callPlanningAnalysisResponses(ctx context.Context, session store.ContentPlanningSession, model store.ModelConfig, input []map[string]any) (responsesResult, error) {
	tools := []map[string]any{planningAnalysisResultTool()}
	settings, err := s.store.GetBillingSettings()
	if err != nil {
		return responsesResult{}, fmt.Errorf("读取内容分析计费设置: %w", err)
	}
	if !settings.Enabled {
		return callResponsesContext(ctx, model, input, tools)
	}
	cost := settings.ContentPlanningAnalysisCredits
	snapshot := map[string]any{"modelConfigId": model.ID, "provider": model.Provider, "model": model.Model, "creditsPerRequest": cost}
	reservationID, err := s.store.ReserveCredits(session.UserID, "content_planning_analysis", session.ID, cost, snapshot)
	if err != nil {
		return responsesResult{}, err
	}
	result, err := callResponsesContext(ctx, model, input, tools)
	if err != nil {
		_ = s.store.ReleaseCredits(reservationID, session.UserID)
		return responsesResult{}, fmt.Errorf("调用内容分析模型: %w", err)
	}
	usage := store.LLMUsageSettlement{
		ModelConfigID: model.ID, SourceType: "content_planning_analysis", SourceID: session.ID,
		PromptTokens: result.Usage.InputTokens, CompletionTokens: result.Usage.OutputTokens, CachedPromptTokens: result.Usage.CachedInputTokens,
		UsageRaw:        map[string]any{"inputTokens": result.Usage.InputTokens, "outputTokens": result.Usage.OutputTokens, "totalTokens": result.Usage.TotalTokens, "estimated": result.Usage.Estimated},
		BillingSnapshot: snapshot,
	}
	if err := s.store.SettleLLMReservation(reservationID, session.UserID, cost, usage); err != nil {
		return responsesResult{}, fmt.Errorf("结算内容分析费用: %w", err)
	}
	return result, nil
}

func (s *Server) failPlanningAnalysis(session store.ContentPlanningSession, cause error) {
	current, found, err := s.store.FindPlanningSession(session.ID)
	if err == nil && found {
		session = current
	}
	if session.Status != "analyzing" {
		return
	}
	session.Status, session.JobStage = "failed", "failed"
	session.ErrorMessage = cause.Error()
	_, _ = s.store.UpdatePlanningSession(session)
}

func (s *Server) buildPlanningAnalysisContext(ctx context.Context, session store.ContentPlanningSession) (planningAnalysisContext, error) {
	result := planningAnalysisContext{assetRefs: map[string]map[string]any{}}
	for _, key := range []string{"imageMaterials", "documentMaterials"} {
		for _, value := range anySlice(session.MaterialBundle[key]) {
			ref := objectValue(value)
			assetID := stringValue(ref, "assetId")
			asset, found, err := s.store.FindContentAsset(assetID)
			if err != nil || !found || asset.UserID != session.UserID {
				return result, fmt.Errorf("分析附件 %s 不存在", assetID)
			}
			result.assetRefs[asset.ID] = ref
			if key == "imageMaterials" {
				result.images = append(result.images, asset)
				result.sourceInfo = append(result.sourceInfo, fmt.Sprintf("图片附件 asset_id=%s, 文件名=%s", asset.ID, asset.OriginalFileName))
				continue
			}
			extraction, err := s.ensurePlanningAssetExtraction(ctx, asset)
			if err != nil {
				return result, fmt.Errorf("解析 %s 失败: %w", asset.OriginalFileName, err)
			}
			result.sourceInfo = append(result.sourceInfo, fmt.Sprintf("文档附件 asset_id=%s, 文件名=%s, 解析器=%s@%s", asset.ID, asset.OriginalFileName, extraction.Parser, extraction.ParserVersion))
			result.text += planningExtractionText(asset, extraction.Result)
			for _, derivedID := range extraction.DerivedAssetIDs {
				derived, found, findErr := s.store.FindContentAsset(derivedID)
				if findErr != nil || !found || derived.UserID != session.UserID || !strings.HasPrefix(strings.ToLower(derived.MimeType), "image/") {
					continue
				}
				result.images = append(result.images, derived)
				result.assetRefs[derived.ID] = planningAssetRef(derived, "image")
			}
		}
	}
	for _, key := range []string{"referenceVideo", "referenceAudio"} {
		ref := objectValue(session.MaterialBundle[key])
		if len(ref) == 0 {
			continue
		}
		assetID := stringValue(ref, "assetId")
		result.assetRefs[assetID] = ref
		result.sourceInfo = append(result.sourceInfo, fmt.Sprintf("%s附件 asset_id=%s, 文件名=%s", map[string]string{"referenceVideo": "视频", "referenceAudio": "音频"}[key], assetID, stringValue(ref, "originalFileName")))
		result.warnings = append(result.warnings, map[string]string{"referenceVideo": "本轮未提取视频逐帧和语音内容，仅将视频作为后续参考素材。", "referenceAudio": "本轮未转写音频内容，仅将音频作为后续参考素材。"}[key])
	}
	if len([]rune(result.text)) > planningAnalysisMaxText {
		result.text = truncateRunes(result.text, planningAnalysisMaxText)
		result.warnings = append(result.warnings, "文档文本较长，本轮仅分析前 60000 个字符。")
	}
	if len(result.images) > planningAnalysisMaxImages {
		result.images = result.images[:planningAnalysisMaxImages]
		result.warnings = append(result.warnings, "图片数量较多，本轮最多分析前 16 张有效图片。")
	}
	return result, nil
}

func (s *Server) ensurePlanningAssetExtraction(ctx context.Context, asset store.ContentAsset) (store.AssetExtraction, error) {
	if completed, found, err := s.store.FindLatestCompletedAssetExtraction(asset.ID, asset.UserID); err != nil {
		return store.AssetExtraction{}, err
	} else if found {
		return completed, nil
	}
	latest, found, err := s.store.FindLatestAssetExtraction(asset.ID, asset.UserID)
	if err != nil {
		return store.AssetExtraction{}, err
	}
	if found && (latest.Status == "queued" || latest.Status == "running") {
		return s.waitForPlanningAssetExtraction(ctx, latest.ID, asset.UserID)
	}
	descriptor, err := s.assetExtract.DescriptorFor(assetExtractionInput(asset))
	if err != nil {
		if errors.Is(err, assetextract.ErrUnsupportedFormat) {
			return store.AssetExtraction{}, errors.New("当前仅支持解析 PPTX 和 PDF")
		}
		return store.AssetExtraction{}, err
	}
	created, err := s.store.CreateAssetExtraction(store.AssetExtraction{
		AssetID: asset.ID, UserID: asset.UserID, Parser: descriptor.Name, ParserVersion: descriptor.Version,
		OptionsHash: defaultAssetExtractionOptionsHash,
	})
	if err != nil {
		return store.AssetExtraction{}, err
	}
	s.executeAssetExtraction(created.ID, created.UserID)
	completed, found, err := s.store.FindAssetExtraction(created.ID, created.UserID)
	if err != nil {
		return store.AssetExtraction{}, err
	}
	if !found || completed.Status != "completed" {
		if found && completed.ErrorMessage != nil {
			return store.AssetExtraction{}, errors.New(*completed.ErrorMessage)
		}
		return store.AssetExtraction{}, errors.New("附件解析未完成")
	}
	return completed, nil
}

func (s *Server) waitForPlanningAssetExtraction(ctx context.Context, extractionID, userID string) (store.AssetExtraction, error) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		item, found, err := s.store.FindAssetExtraction(extractionID, userID)
		if err != nil {
			return store.AssetExtraction{}, err
		}
		if !found {
			return store.AssetExtraction{}, errors.New("附件解析任务不存在")
		}
		switch item.Status {
		case "completed":
			return item, nil
		case "failed":
			if item.ErrorMessage != nil {
				return store.AssetExtraction{}, errors.New(*item.ErrorMessage)
			}
			return store.AssetExtraction{}, errors.New("附件解析失败")
		}
		select {
		case <-ctx.Done():
			return store.AssetExtraction{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func planningExtractionText(asset store.ContentAsset, result map[string]any) string {
	var builder strings.Builder
	builder.WriteString("\n\n===== 文档：")
	builder.WriteString(asset.OriginalFileName)
	builder.WriteString("；asset_id=")
	builder.WriteString(asset.ID)
	builder.WriteString(" =====\n")
	if text := stringValue(result, "text"); text != "" {
		builder.WriteString(text)
		builder.WriteByte('\n')
	}
	for _, value := range anySlice(result["units"]) {
		unit := objectValue(value)
		text := stringValue(unit, "text")
		if text == "" {
			continue
		}
		locator := objectValue(unit["locator"])
		builder.WriteString(fmt.Sprintf("[%s %v]\n%s\n", stringValue(locator, "kind"), locator["index"], text))
	}
	return builder.String()
}

func planningAnalysisModelInput(session store.ContentPlanningSession, analysisContext planningAnalysisContext) []map[string]any {
	parts := []map[string]any{{"type": "input_text", "text": strings.Join([]string{
		"请结合营销需求和所有附件，完成营销视频前置内容分析。不得编造附件中不存在的产品参数；不确定内容请写入 notes。",
		"产品名称：" + stringValue(session.MaterialBundle, "productName"),
		"营销需求：" + stringValue(session.MaterialBundle, "prompt"),
		"附件索引：\n" + strings.Join(analysisContext.sourceInfo, "\n"),
		"文档提取文本：" + analysisContext.text,
	}, "\n\n")}}
	for _, asset := range analysisContext.images {
		parts = append(parts, map[string]any{"type": "input_text", "text": fmt.Sprintf("以下图片对应 asset_id=%s，文件名=%s。", asset.ID, asset.OriginalFileName)})
		if thumbnail, err := imageDecisionThumbnailDataURL(asset.FilePath, 768); err == nil {
			parts = append(parts, map[string]any{"type": "input_image", "image_url": thumbnail, "detail": "low"})
		}
	}
	return []map[string]any{
		{"role": "system", "content": "你是严谨的中文营销内容分析师。你必须调用 submit_content_analysis，并返回可直接用于后续宣传图、旁白、字幕和分镜生成的结构化事实。"},
		{"role": "user", "content": parts},
	}
}

func planningAnalysisResultTool() map[string]any {
	stringArray := map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
	breakdown := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"tags", "structureFramework", "emotionCurve", "summary", "segments", "replaceableElements", "keepElements", "applicableCategories"},
		"properties": map[string]any{
			"tags": stringArray, "structureFramework": map[string]any{"type": "string"}, "emotionCurve": map[string]any{"type": "string"}, "summary": map[string]any{"type": "string"},
			"segments":            map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"timeRange", "title", "summary"}, "properties": map[string]any{"timeRange": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "summary": map[string]any{"type": "string"}}}},
			"replaceableElements": stringArray, "keepElements": stringArray, "applicableCategories": stringArray,
		},
	}
	return map[string]any{
		"type": "function", "name": "submit_content_analysis", "description": "提交结构化营销内容分析", "strict": true,
		"parameters": map[string]any{
			"type": "object", "additionalProperties": false,
			"required": []string{"materialCaptions", "productInsights", "referenceBreakdown", "notes"},
			"properties": map[string]any{
				"materialCaptions":   map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"assetId", "label", "description"}, "properties": map[string]any{"assetId": map[string]any{"type": "string"}, "label": map[string]any{"type": "string"}, "description": map[string]any{"type": "string"}}}},
				"productInsights":    map[string]any{"type": "object", "additionalProperties": false, "required": []string{"productName", "productCategory", "productFeatures", "coreSellingPoints", "targetAudience", "useScenarios"}, "properties": map[string]any{"productName": map[string]any{"type": "string"}, "productCategory": map[string]any{"type": "string"}, "productFeatures": stringArray, "coreSellingPoints": stringArray, "targetAudience": stringArray, "useScenarios": stringArray}},
				"referenceBreakdown": map[string]any{"anyOf": []any{breakdown, map[string]any{"type": "null"}}},
				"notes":              stringArray,
			},
		},
	}
}

func decodePlanningAnalysisResult(result responsesResult) (map[string]any, error) {
	for _, item := range result.Output {
		if item.Type != "function_call" || item.Name != "submit_content_analysis" || strings.TrimSpace(item.Arguments) == "" {
			continue
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(item.Arguments), &value); err != nil {
			return nil, fmt.Errorf("解析 AI 内容分析参数: %w", err)
		}
		return value, nil
	}
	text := strings.TrimSpace(responseOutputText(result))
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start >= 0 && end > start {
		text = text[start : end+1]
	}
	var value map[string]any
	if text == "" || json.Unmarshal([]byte(text), &value) != nil {
		return nil, errors.New("AI 内容分析没有返回有效结构化结果")
	}
	return value, nil
}

func normalizePlanningAnalysis(raw map[string]any, analysisContext planningAnalysisContext) map[string]any {
	result := defaultAnalysisHTTP()
	insights := objectValue(raw["productInsights"])
	result["productInsights"] = map[string]any{
		"productName": stringValue(insights, "productName"), "productCategory": stringValue(insights, "productCategory"),
		"productFeatures": stringSlice(insights["productFeatures"]), "coreSellingPoints": stringSlice(insights["coreSellingPoints"]),
		"targetAudience": stringSlice(insights["targetAudience"]), "useScenarios": stringSlice(insights["useScenarios"]),
	}
	captions := []any{}
	seen := map[string]bool{}
	for _, value := range anySlice(raw["materialCaptions"]) {
		item := objectValue(value)
		assetID := stringValue(item, "assetId")
		ref, allowed := analysisContext.assetRefs[assetID]
		if !allowed || seen[assetID] {
			continue
		}
		seen[assetID] = true
		label := stringValue(item, "label")
		if label == "" {
			label = valueOr(stringValue(ref, "name"), stringValue(ref, "originalFileName"))
		}
		captions = append(captions, map[string]any{"id": "caption-" + assetID, "assetId": assetID, "label": label, "previewUrl": stringValue(ref, "fileUrl"), "description": stringValue(item, "description")})
	}
	result["materialCaptions"] = captions
	if breakdown := objectValue(raw["referenceBreakdown"]); len(breakdown) > 0 {
		result["referenceBreakdown"] = map[string]any{
			"tags": stringSlice(breakdown["tags"]), "structureFramework": stringValue(breakdown, "structureFramework"), "emotionCurve": stringValue(breakdown, "emotionCurve"), "summary": stringValue(breakdown, "summary"),
			"segments": anySlice(breakdown["segments"]), "replaceableElements": stringSlice(breakdown["replaceableElements"]), "keepElements": stringSlice(breakdown["keepElements"]), "applicableCategories": stringSlice(breakdown["applicableCategories"]),
		}
	}
	notes := append([]string{}, stringSlice(raw["notes"])...)
	notes = append(notes, analysisContext.warnings...)
	result["notes"] = notes
	result["confirmed"] = false
	return result
}

func anySlice(value any) []any {
	if result, ok := value.([]any); ok {
		return result
	}
	return []any{}
}
