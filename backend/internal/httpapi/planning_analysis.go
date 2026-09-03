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
	planningAnalysisMaxImages     = 16
	planningAnalysisMaxText       = 60000
	planningCampaignMaxReferences = 6
	planningCampaignMaxVariants   = 3
	planningCampaignMaxImages     = 12
)

type planningAnalysisContext struct {
	text       string
	images     []store.ContentAsset
	assetRefs  map[string]map[string]any
	warnings   []string
	sourceInfo []string
}

func (s *Server) queuePlanningAnalysis(session store.ContentPlanningSession, input map[string]any) (store.ContentPlanningSession, error) {
	if isActiveRemotionRender(objectValue(session.Analysis["renderGeneration"])) {
		return session, errors.New("视频正在渲染，请先取消渲染任务")
	}
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
	updated, err := s.store.UpdatePlanningSession(session)
	if err != nil {
		s.failPlanningAnalysis(session, err)
		return
	}
	s.publishPlanningSessionUpdated(updated, "analysis")
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
	if updated, updateErr := s.store.UpdatePlanningSession(session); updateErr == nil {
		s.publishPlanningSessionUpdated(updated, "analysis")
	}
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
		result.warnings = append(result.warnings, "图片数量较多，AI 将重点理解前 16 张有效图片，其余图片仍会尽量分配到宣传画面规划中。")
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
		"同时规划 2 至 6 个宣传视频场景。宣传图片是视频的核心画面，每个场景必须提供主 imagePrompt，并在 imagePrompts 中规划 1 至 3 个内容或构图明显不同、可直接生图的中文镜头提示词，不得返回空的 campaignPlan 或 scenes。先确定贯穿全片的视觉风格，再为每个场景生成主标题、副标题、旁白、CTA、用途、时长和图片提示词。",
		"旁白采用自然、直接、面向企业客户和老板的产品推介口吻，全片连贯表达以下逻辑：先用“你是不是在找一款能够解决某类问题的产品”引出需求；再说明“我们公司开发了什么产品”；接着依据附件中的真实信息介绍性能指标、核心能力、适用需求和成本优势；然后介绍公司类型与主营业务；最后以“欢迎各位老板合作共赢”一类自然表达收束。根据实际场景数量合并这些环节，不要每个场景机械重复固定句式。",
		"旁白、标题和副标题尽量使用自然中文。常见英文概念应优先翻译为中文或使用中文替代表达；只有品牌名、正式产品名、型号、行业通用缩写等翻译后会失真的内容才保留英文，必要时在首次出现时补充简短中文解释。避免连续堆叠英文词语，确保中文语音朗读自然。不得为了套用推介结构编造公司背景、性能数值、价格或降本幅度；附件没有明确依据时使用定性表达或省略该信息。",
		"必须尽可能使用附件索引中的真实图片：每张有效图片 asset_id 至少分配给一个场景，不得只反复使用少数图片；若图片较多，可在不同场景间均匀分配，每个场景最多引用 6 张。即使没有可用原图，也必须根据文案规划完整的宣传图片场景。图片提示词不得要求生成文字、字幕、Logo、水印、UI 标签或边框，并为后续叠加文案预留清晰区域。",
		"如果一张参考图是拼图、PPT 页面、照片墙或同时包含多个独立产品/场景，必须识别其中可独立使用的视觉区域，并用多个 imagePrompts 分别聚焦不同区域或主题，不要只生成一张概括全部内容的图片。普通单主体参考图也应尽量提供全景、特写或不同使用场景等至少 2 个镜头。全部场景合计最多规划 12 张宣传图片。",
		"产品名称：" + stringValue(session.MaterialBundle, "productName"),
		"营销需求：" + stringValue(session.MaterialBundle, "prompt"),
		"附件索引：\n" + strings.Join(analysisContext.sourceInfo, "\n"),
		"文档提取文本：" + analysisContext.text,
	}, "\n\n")}}
	modelImages := analysisContext.images
	if len(modelImages) > planningAnalysisMaxImages {
		modelImages = modelImages[:planningAnalysisMaxImages]
	}
	for _, asset := range modelImages {
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
	campaignScene := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"id", "title", "subtitle", "voiceover", "cta", "purpose", "durationInSeconds", "assetIds", "imagePrompt", "imagePrompts"},
		"properties": map[string]any{
			"id": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "subtitle": map[string]any{"type": "string"},
			"voiceover": map[string]any{"type": "string"}, "cta": map[string]any{"type": "string"}, "purpose": map[string]any{"type": "string"},
			"durationInSeconds": map[string]any{"type": "number", "minimum": 2, "maximum": 10},
			"assetIds":          map[string]any{"type": "array", "maxItems": planningCampaignMaxReferences, "items": map[string]any{"type": "string"}},
			"imagePrompt":       map[string]any{"type": "string"},
			"imagePrompts":      map[string]any{"type": "array", "minItems": 1, "maxItems": planningCampaignMaxVariants, "items": map[string]any{"type": "string"}},
		},
	}
	campaignPlan := map[string]any{
		"type": "object", "additionalProperties": false,
		"required": []string{"visualStyle", "scenes"},
		"properties": map[string]any{
			"visualStyle": map[string]any{"type": "string"},
			"scenes":      map[string]any{"type": "array", "minItems": 2, "maxItems": 6, "items": campaignScene},
		},
	}
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
			"required": []string{"materialCaptions", "productInsights", "campaignPlan", "referenceBreakdown", "notes"},
			"properties": map[string]any{
				"materialCaptions":   map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"assetId", "label", "description"}, "properties": map[string]any{"assetId": map[string]any{"type": "string"}, "label": map[string]any{"type": "string"}, "description": map[string]any{"type": "string"}}}},
				"productInsights":    map[string]any{"type": "object", "additionalProperties": false, "required": []string{"productName", "productCategory", "productFeatures", "coreSellingPoints", "targetAudience", "useScenarios"}, "properties": map[string]any{"productName": map[string]any{"type": "string"}, "productCategory": map[string]any{"type": "string"}, "productFeatures": stringArray, "coreSellingPoints": stringArray, "targetAudience": stringArray, "useScenarios": stringArray}},
				"campaignPlan":       campaignPlan,
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
	result["campaignPlan"] = normalizePlanningCampaignPlan(objectValue(raw["campaignPlan"]), analysisContext)
	result["campaignImageGeneration"] = map[string]any{"status": "idle", "images": []any{}, "errorMessage": ""}
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

func normalizePlanningCampaignPlan(raw map[string]any, analysisContext planningAnalysisContext) any {
	availableIDs := make([]string, 0, len(analysisContext.images))
	allowed := map[string]bool{}
	for _, asset := range analysisContext.images {
		if !allowed[asset.ID] {
			allowed[asset.ID] = true
			availableIDs = append(availableIDs, asset.ID)
		}
	}
	scenes := []any{}
	seenIDs := map[string]bool{}
	for index, value := range anySlice(raw["scenes"]) {
		if len(scenes) >= 6 {
			break
		}
		item := objectValue(value)
		id := strings.TrimSpace(stringValue(item, "id"))
		if id == "" || seenIDs[id] {
			id = fmt.Sprintf("scene-%d", index+1)
		}
		seenIDs[id] = true
		assetIDs := []string{}
		for _, assetID := range stringSlice(item["assetIds"]) {
			if allowed[assetID] && !planningContainsString(assetIDs, assetID) && len(assetIDs) < planningCampaignMaxReferences {
				assetIDs = append(assetIDs, assetID)
			}
		}
		if len(assetIDs) == 0 && len(availableIDs) > 0 {
			assetIDs = append(assetIDs, availableIDs[index%len(availableIDs)])
		}
		duration := numberValue(item["durationInSeconds"], 4)
		if duration < 2 || duration > 10 {
			duration = 4
		}
		title := strings.TrimSpace(stringValue(item, "title"))
		prompt := strings.TrimSpace(stringValue(item, "imagePrompt"))
		if prompt == "" {
			prompt = fmt.Sprintf("生成与“%s”匹配的专业营销视频画面", valueOr(title, fmt.Sprintf("场景 %d", index+1)))
		}
		imagePrompts := normalizePlanningImagePrompts(item["imagePrompts"], prompt, len(assetIDs) > 0)
		scenes = append(scenes, map[string]any{
			"id": id, "title": title, "subtitle": stringValue(item, "subtitle"), "voiceover": stringValue(item, "voiceover"),
			"cta": stringValue(item, "cta"), "purpose": stringValue(item, "purpose"), "durationInSeconds": duration,
			"assetIds": assetIDs, "imagePrompt": prompt, "imagePrompts": imagePrompts,
		})
	}
	// A campaign image plan is required by all downstream video stages. Keep a
	// deterministic fallback so an incomplete model response never makes image
	// generation unusable.
	fallbackScenes := []map[string]string{
		{"title": "找到合适的产品", "purpose": "从客户需求切入", "voiceover": "你是不是在找一款更省心、更高效，能够解决实际需求的产品？", "prompt": "突出产品或服务核心主体的专业营销主视觉，主体清晰，构图有吸引力，背景简洁并预留文案区域"},
		{"title": "满足真实需求", "purpose": "呈现核心价值与使用场景", "voiceover": "我们带来的这款产品聚焦真实使用需求，希望用可靠的体验帮助你提高效率、降低成本。", "prompt": "展示产品核心卖点与真实使用情境的专业营销画面，画面自然可信，层次清晰并预留文案区域"},
		{"title": "合作共赢", "purpose": "介绍业务并推动合作", "voiceover": "欢迎进一步了解我们的产品，也期待与各位老板合作共赢。", "prompt": "产品英雄镜头或品牌收束画面，视觉聚焦、质感专业，背景简洁并为行动文案预留区域"},
	}
	minimumScenes := 2
	for len(scenes) < minimumScenes {
		index := len(scenes)
		fallback := fallbackScenes[index]
		scenes = append(scenes, map[string]any{
			"id": fmt.Sprintf("scene-%d", index+1), "title": fallback["title"], "subtitle": "", "voiceover": fallback["voiceover"],
			"cta": "", "purpose": fallback["purpose"], "durationInSeconds": float64(4),
			"assetIds": []string{}, "imagePrompt": fallback["prompt"], "imagePrompts": []string{fallback["prompt"]},
		})
	}

	// Ensure every usable source image participates in at least one scene. Add
	// scenes when necessary instead of silently dropping assets because a scene
	// already reached the per-request reference limit.
	used := map[string]bool{}
	for _, value := range scenes {
		for _, assetID := range stringSlice(objectValue(value)["assetIds"]) {
			used[assetID] = true
		}
	}
	for _, assetID := range availableIDs {
		if used[assetID] {
			continue
		}
		assigned := false
		for sceneIndex := range scenes {
			scene := objectValue(scenes[sceneIndex])
			assetIDs := stringSlice(scene["assetIds"])
			if len(assetIDs) >= planningCampaignMaxReferences {
				continue
			}
			scene["assetIds"] = append(assetIDs, assetID)
			scenes[sceneIndex] = scene
			assigned = true
			break
		}
		if !assigned && len(scenes) < 6 {
			index := len(scenes)
			fallback := fallbackScenes[index%len(fallbackScenes)]
			scenes = append(scenes, map[string]any{
				"id": fmt.Sprintf("scene-%d", index+1), "title": fallback["title"], "subtitle": "", "voiceover": fallback["voiceover"],
				"cta": "", "purpose": fallback["purpose"], "durationInSeconds": float64(4),
				"assetIds": []string{assetID}, "imagePrompt": fallback["prompt"], "imagePrompts": normalizePlanningImagePrompts(nil, fallback["prompt"], true),
			})
		}
		used[assetID] = true
	}
	visualStyle := strings.TrimSpace(stringValue(raw, "visualStyle"))
	if visualStyle == "" {
		visualStyle = "专业、统一、清晰的营销视频视觉，主体突出，适合后续叠加文案"
	}
	return map[string]any{"visualStyle": visualStyle, "scenes": scenes}
}

func normalizePlanningImagePrompts(raw any, primary string, hasReferences bool) []string {
	result := []string{}
	appendPrompt := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || planningContainsString(result, value) || len(result) >= planningCampaignMaxVariants {
			return
		}
		result = append(result, value)
	}
	appendPrompt(primary)
	for _, value := range stringSlice(raw) {
		appendPrompt(value)
	}
	// Legacy analyses only had one prompt. A referenced image may contain more
	// than one useful subject (for example a PPT photo wall), so regeneration
	// should immediately gain another distinct shot without requiring users to
	// pay for AI analysis again.
	if hasReferences && len(result) == 1 {
		appendPrompt(primary + "；从参考素材中选择另一个可独立使用的主体、局部或场景，采用不同景别和构图，避免复制上一张画面")
	}
	if len(result) == 0 {
		result = []string{"专业营销视频画面，主体清晰，构图有吸引力，并预留文案区域"}
	}
	return result
}

func planningContainsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func anySlice(value any) []any {
	if result, ok := value.([]any); ok {
		return result
	}
	return []any{}
}
