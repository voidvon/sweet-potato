package httpapi

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"sweet-potato-go/internal/imagegen"
	"sweet-potato-go/internal/store"
)

func (s *Server) resolveImageModelConfig(userID, requestedID string) (store.ModelConfig, error) {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" {
		if model, found, err := s.store.FindUserModelConfig(userID, requestedID); err != nil {
			return store.ModelConfig{}, err
		} else if found {
			return withImageEnvironmentCredentials(model), nil
		}
		if model, found, err := s.store.FindModelConfig(requestedID); err == nil && found && model.Type == "image" {
			return withImageEnvironmentCredentials(model), nil
		} else if err != nil {
			return store.ModelConfig{}, err
		}
		return store.ModelConfig{}, errors.New("图片模型不存在或无权使用")
	}
	if models, err := s.store.ListUserModelConfigs(userID, "image"); err != nil {
		return store.ModelConfig{}, err
	} else {
		for _, model := range models {
			if model.IsDefault {
				return withImageEnvironmentCredentials(model), nil
			}
		}
	}
	if models, err := s.store.ListModelConfigs("image"); err == nil {
		for _, model := range models {
			if model.IsDefault {
				return withImageEnvironmentCredentials(model), nil
			}
		}
		if len(models) > 0 {
			return withImageEnvironmentCredentials(models[0]), nil
		}
	} else {
		return store.ModelConfig{}, err
	}
	return withImageEnvironmentCredentials(store.ModelConfig{
		ID:       "env-image",
		Type:     "image",
		Provider: valueOr(strings.TrimSpace(os.Getenv("IMAGE_MODEL_PROVIDER")), "openai-images"),
		Model:    valueOr(strings.TrimSpace(os.Getenv("IMAGE_MODEL_ID")), "gpt-image-1"),
		BaseURL:  strings.TrimSpace(os.Getenv("IMAGE_MODEL_BASE_URL")),
	}), nil
}

func withImageEnvironmentCredentials(model store.ModelConfig) store.ModelConfig {
	provider := strings.ToLower(model.Provider + " " + model.BaseURL + " " + model.Model)
	if strings.TrimSpace(model.APIKey) == "" {
		for _, key := range imageAPIKeyNames(provider) {
			if value := strings.TrimSpace(os.Getenv(key)); value != "" {
				model.APIKey = value
				break
			}
		}
	}
	if strings.TrimSpace(model.BaseURL) == "" {
		model.BaseURL = imageDefaultBaseURL(provider)
	}
	return model
}

func imageAPIKeyNames(provider string) []string {
	if strings.Contains(provider, "seedream") || strings.Contains(provider, "volcengine") || strings.Contains(provider, "ark.cn-") {
		return []string{"IMAGE_MODEL_API_KEY", "ARK_IMAGE_API_KEY", "ARK_API_KEY"}
	}
	return []string{"IMAGE_MODEL_API_KEY", "OPENAI_API_KEY"}
}

func imageDefaultBaseURL(provider string) string {
	if strings.Contains(provider, "seedream") || strings.Contains(provider, "volcengine") || strings.Contains(provider, "ark.cn-") {
		return valueOr(strings.TrimSpace(os.Getenv("ARK_IMAGE_BASE_URL")), "https://ark.cn-beijing.volces.com/api/v3")
	}
	return valueOr(strings.TrimSpace(os.Getenv("OPENAI_BASE_URL")), "https://api.openai.com/v1")
}

func (s *Server) imageGenerationCreditCost(model store.ModelConfig, successfulCount int) (float64, error) {
	if successfulCount <= 0 {
		return 0, nil
	}
	settings, err := s.store.GetBillingSettings()
	if err != nil {
		return 0, fmt.Errorf("读取计费设置失败: %w", err)
	}
	if !settings.Enabled {
		return 0, nil
	}
	billing := objectValue(model.Settings["billing"])
	creditsPerRequest := numberValue(billing["creditsPerRequest"], numberValue(billing["perRequestUsd"], 0))
	if creditsPerRequest < 0 {
		return 0, errors.New("图片模型单张积分不能为负数")
	}
	return creditsPerRequest * float64(successfulCount), nil
}

func (s *Server) generateBillableImageAssets(ctx context.Context, userID string, model store.ModelConfig, expectedCount int, mode string, requestSnapshot map[string]any, generate func() ([]store.ContentAsset, error)) ([]store.ContentAsset, error) {
	if expectedCount < 1 {
		expectedCount = 1
	}
	reservedCredits, err := s.imageGenerationCreditCost(model, expectedCount)
	if err != nil {
		return nil, err
	}
	if reservedCredits <= 0 || strings.TrimSpace(userID) == "" {
		return generate()
	}
	billing := objectValue(model.Settings["billing"])
	creditsPerRequest := reservedCredits / float64(expectedCount)
	sourceID := randomIDForHTTP()
	snapshot := map[string]any{
		"modelConfigId":     model.ID,
		"provider":          model.Provider,
		"model":             model.Model,
		"pricingMode":       "per_request",
		"creditsPerRequest": creditsPerRequest,
		"expectedCount":     expectedCount,
		"mode":              mode,
		"priceSource":       stringValue(billing, "priceSource"),
	}
	reservationID, err := s.store.ReserveCredits(userID, "image_generation", sourceID, reservedCredits, snapshot)
	if err != nil {
		return nil, err
	}
	assets, generateErr := generate()
	if len(assets) == 0 && generateErr != nil {
		if releaseErr := s.store.ReleaseCredits(reservationID, userID); releaseErr != nil {
			return nil, fmt.Errorf("%v；释放图片生成预留积分失败: %w", generateErr, releaseErr)
		}
		return nil, generateErr
	}
	actualCredits := creditsPerRequest * float64(len(assets))
	responseSnapshot := map[string]any{"successfulCount": len(assets)}
	if generateErr != nil {
		responseSnapshot["error"] = generateErr.Error()
	}
	if err := s.store.SettleBillableReservation(reservationID, userID, actualCredits, store.BillableUsageSettlement{
		Category:         "image",
		ModelConfigID:    model.ID,
		Provider:         model.Provider,
		Model:            model.Model,
		SourceType:       "image_generation",
		SourceID:         sourceID,
		PricingMode:      "per_request",
		QuantitySnapshot: map[string]any{"expectedCount": expectedCount, "successfulCount": len(assets), "creditsPerRequest": creditsPerRequest},
		UsageRaw:         map[string]any{"outputCount": len(assets)},
		RequestSnapshot:  requestSnapshot,
		ResponseSnapshot: responseSnapshot,
	}); err != nil {
		return assets, fmt.Errorf("结算图片生成费用失败: %w", err)
	}
	if updatedUser, found, findErr := s.store.FindUserByID(userID); findErr == nil && found {
		s.publishAppEvent(userID, "app/credit-balance-updated", map[string]any{
			"userId": userID, "creditBalance": updatedUser.CreditBalance, "creditDelta": -actualCredits,
			"at": time.Now().UTC().Format(time.RFC3339Nano),
		})
	}
	return assets, generateErr
}

func (s *Server) generateImageAssets(userID string, model store.ModelConfig, prompt string, count int, references []store.ContentAsset, options imagegen.GenerateInput, mode, title string, parentAssetID *string) ([]store.ContentAsset, error) {
	return s.generateImageAssetsContext(context.Background(), userID, model, prompt, count, references, options, mode, title, parentAssetID)
}

func (s *Server) generateImageAssetsContext(ctx context.Context, userID string, model store.ModelConfig, prompt string, count int, references []store.ContentAsset, options imagegen.GenerateInput, mode, title string, parentAssetID *string) ([]store.ContentAsset, error) {
	return s.generateImageAssetsContextWithProgress(ctx, userID, model, prompt, count, references, options, mode, title, parentAssetID, nil)
}

func (s *Server) generateImageAssetsForPromptsContextWithProgress(ctx context.Context, userID string, model store.ModelConfig, prompts []string, count int, references []store.ContentAsset, options imagegen.GenerateInput, mode, title string, parentAssetID *string, onAsset func(store.ContentAsset, int)) ([]store.ContentAsset, error) {
	referenceSets := make([][]store.ContentAsset, len(prompts))
	for index := range referenceSets {
		referenceSets[index] = references
	}
	return s.generateImageAssetsForPromptPlansContextWithProgress(ctx, userID, model, prompts, referenceSets, count, options, mode, title, parentAssetID, onAsset)
}

func (s *Server) generateImageAssetsForPromptPlansContextWithProgress(ctx context.Context, userID string, model store.ModelConfig, prompts []string, referenceSets [][]store.ContentAsset, count int, options imagegen.GenerateInput, mode, title string, parentAssetID *string, onAsset func(store.ContentAsset, int)) ([]store.ContentAsset, error) {
	expectedCount := count
	if len(prompts) > 1 {
		expectedCount = len(prompts)
	}
	return s.generateBillableImageAssets(ctx, userID, model, expectedCount, mode, map[string]any{
		"promptCount": len(prompts),
		"title":       title,
	}, func() ([]store.ContentAsset, error) {
		return s.generateRawImageAssetsForPromptPlansContextWithProgress(ctx, userID, model, prompts, referenceSets, count, options, mode, title, parentAssetID, onAsset)
	})
}

func (s *Server) generateRawImageAssetsForPromptPlansContextWithProgress(ctx context.Context, userID string, model store.ModelConfig, prompts []string, referenceSets [][]store.ContentAsset, count int, options imagegen.GenerateInput, mode, title string, parentAssetID *string, onAsset func(store.ContentAsset, int)) ([]store.ContentAsset, error) {
	if len(prompts) == 1 {
		return s.generateRawImageAssetsContextWithProgress(ctx, userID, model, prompts[0], count, imageReferencesForSlot(referenceSets, 0), options, mode, title, parentAssetID, onAsset)
	}
	if _, err := s.ensureContentGroup(userID, "finished_video"); err != nil {
		return nil, fmt.Errorf("创建图片作品分组失败: %w", err)
	}

	type chapterResult struct {
		assets []store.ContentAsset
		err    error
	}
	results := make([]chapterResult, len(prompts))
	jobs := make(chan int)
	workerCount := min(len(prompts), imageModelMaxConcurrency(model))
	var workers sync.WaitGroup
	var callbackMu sync.Mutex
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for slotIndex := range jobs {
				generated, err := s.generateRawImageAssetsContextWithProgress(ctx, userID, model, prompts[slotIndex], 1, imageReferencesForSlot(referenceSets, slotIndex), options, mode, title, parentAssetID, func(asset store.ContentAsset, _ int) {
					if onAsset != nil {
						callbackMu.Lock()
						onAsset(asset, slotIndex)
						callbackMu.Unlock()
					}
				})
				results[slotIndex] = chapterResult{assets: generated, err: err}
			}
		}()
	}
	for slotIndex := range prompts {
		jobs <- slotIndex
	}
	close(jobs)
	workers.Wait()

	assets := make([]store.ContentAsset, 0, len(prompts))
	var firstErr error
	for _, result := range results {
		assets = append(assets, result.assets...)
		if firstErr == nil && result.err != nil {
			firstErr = result.err
		}
	}
	return assets, firstErr
}

func imageReferencesForSlot(referenceSets [][]store.ContentAsset, slotIndex int) []store.ContentAsset {
	if len(referenceSets) == 0 {
		return nil
	}
	if len(referenceSets) == 1 || slotIndex < 0 || slotIndex >= len(referenceSets) {
		return referenceSets[0]
	}
	return referenceSets[slotIndex]
}

func imageModelMaxConcurrency(model store.ModelConfig) int {
	value := int(numberValue(objectValue(model.Settings["imageGeneration"])["maxConcurrency"], 3))
	if value < 1 || value > 12 {
		return 3
	}
	return value
}

func (s *Server) generateImageAssetsContextWithProgress(ctx context.Context, userID string, model store.ModelConfig, prompt string, count int, references []store.ContentAsset, options imagegen.GenerateInput, mode, title string, parentAssetID *string, onAsset func(store.ContentAsset, int)) ([]store.ContentAsset, error) {
	return s.generateBillableImageAssets(ctx, userID, model, count, mode, map[string]any{
		"promptCount": 1,
		"title":       title,
	}, func() ([]store.ContentAsset, error) {
		return s.generateRawImageAssetsContextWithProgress(ctx, userID, model, prompt, count, references, options, mode, title, parentAssetID, onAsset)
	})
}

func (s *Server) generateRawImageAssetsContextWithProgress(ctx context.Context, userID string, model store.ModelConfig, prompt string, count int, references []store.ContentAsset, options imagegen.GenerateInput, mode, title string, parentAssetID *string, onAsset func(store.ContentAsset, int)) ([]store.ContentAsset, error) {
	if strings.TrimSpace(prompt) == "" {
		return nil, errors.New("图片提示词不能为空")
	}
	prompt, options, applyChromaKey := prepareCutoutGeneration(prompt, mode, options)
	options.Prompt = prompt
	options.Count = count
	client := imagegen.Client{BaseURL: model.BaseURL, APIKey: model.APIKey, Provider: model.Provider, Model: model.Model, PublicBase: strings.TrimRight(os.Getenv("PUBLIC_BASE_URL"), "/")}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	groupID, err := s.ensureContentGroup(userID, "finished_video")
	if err != nil {
		return nil, fmt.Errorf("创建图片作品分组失败: %w", err)
	}
	assets := make([]store.ContentAsset, 0, count)
	cleanupPartialAssets := func() {
		if onAsset != nil {
			return
		}
		for _, created := range assets {
			_, _ = s.deleteContentAssetAndDerivedFiles(created.ID, userID)
		}
	}
	_, generateErr := client.GenerateWithProgress(ctx, optionsWithReferences(options, references), func(output imagegen.Output, index int) error {
		if applyChromaKey {
			processed, processErr := imagegen.ApplyGreenChromaKey(output.Bytes)
			if processErr != nil {
				return fmt.Errorf("处理抠图透明通道失败: %w", processErr)
			}
			output.Bytes = processed
			output.MimeType = "image/png"
		}
		if ratio := strings.TrimSpace(options.AspectRatio); ratio != "" && !strings.EqualFold(ratio, "auto") {
			processed, processErr := fitImageToAspectRatio(output.Bytes, output.MimeType, ratio)
			if processErr != nil {
				return fmt.Errorf("校正生成图片比例失败: %w", processErr)
			}
			output.Bytes = processed
		}
		output, encodingMetadata := optimizeGeneratedImageForStorage(output)
		asset, persistErr := s.persistGeneratedImage(userID, groupID, output, mode, title, prompt, index, parentAssetID, model, references, encodingMetadata)
		if persistErr != nil {
			return persistErr
		}
		assets = append(assets, asset)
		if onAsset != nil {
			onAsset(asset, index)
		}
		return nil
	})
	if generateErr != nil {
		cleanupPartialAssets()
		return assets, generateErr
	}
	if len(assets) == 0 {
		return nil, errors.New("图片模型没有返回可用图片")
	}
	return assets, nil
}

func prepareCutoutGeneration(prompt, mode string, options imagegen.GenerateInput) (string, imagegen.GenerateInput, bool) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	background := strings.ToLower(strings.TrimSpace(options.Background))
	if (mode != "cutout" && mode != "image.cutout") || (background != "" && background != "transparent") {
		return prompt, options, false
	}
	chromaKeyPrompt := "绿幕处理要求：模型只需输出不透明图片，不要尝试生成透明通道。主体之外的所有区域必须使用均匀纯色 #00FF00 填充。绿色背景不得包含纹理、渐变、阴影、反射、光斑或其他物体，主体边缘清晰且不要染绿。"
	options.Background = "opaque"
	options.OutputFormat = "png"
	return strings.TrimSpace(prompt + "\n" + chromaKeyPrompt), options, true
}

func optionsWithReferences(options imagegen.GenerateInput, references []store.ContentAsset) imagegen.GenerateInput {
	options.References = references
	return options
}

func imageGenerationResultContext(generation map[string]any, inputPrompt, resolvedPrompt string, references []store.ContentAsset) map[string]any {
	result := make(map[string]any, len(generation)+6)
	for key, value := range generation {
		result[key] = value
	}
	referenceAttachments := make([]any, 0, len(references))
	for _, reference := range references {
		referenceAttachments = append(referenceAttachments, chatAttachmentPayload(reference))
	}
	result["inputPrompt"] = strings.TrimSpace(inputPrompt)
	result["resolvedPrompt"] = strings.TrimSpace(resolvedPrompt)
	result["referenceAttachments"] = referenceAttachments
	result["referenceAssetIds"] = contentAssetIDs(references)
	result["referenceCount"] = len(references)
	result["requestMode"] = imageGenerationRequestMode(references)
	return map[string]any{"imageGeneration": result}
}

func chatGeneratedImageAttachmentPayload(asset store.ContentAsset, slotIndex int, prompt string, references []store.ContentAsset) map[string]any {
	payload := chatAttachmentPayload(asset)
	referenceAttachments := make([]any, 0, len(references))
	for _, reference := range references {
		referenceAttachments = append(referenceAttachments, chatAttachmentPayload(reference))
	}
	payload["imageGenerationSlotIndex"] = slotIndex
	payload["imageGenerationPrompt"] = strings.TrimSpace(prompt)
	payload["imageGenerationReferenceAttachments"] = referenceAttachments
	return payload
}

func imagePromptForSlot(prompts []string, slotIndex int) string {
	if len(prompts) == 0 {
		return ""
	}
	if len(prompts) == 1 || slotIndex < 0 || slotIndex >= len(prompts) {
		return prompts[0]
	}
	return prompts[slotIndex]
}

func contentAssetIDs(assets []store.ContentAsset) []string {
	ids := make([]string, 0, len(assets))
	for _, asset := range assets {
		ids = append(ids, asset.ID)
	}
	return ids
}

func imageGenerationRequestMode(references []store.ContentAsset) string {
	if len(references) > 0 {
		return "edit"
	}
	return "generation"
}

func (s *Server) persistGeneratedImage(userID, groupID string, output imagegen.Output, mode, title, prompt string, slotIndex int, parentAssetID *string, model store.ModelConfig, references []store.ContentAsset, encodingMetadata map[string]any) (store.ContentAsset, error) {
	if len(output.Bytes) == 0 {
		return store.ContentAsset{}, errors.New("图片模型返回了空文件")
	}
	mimeType := valueOr(output.MimeType, "image/png")
	extension := imageExtension(mimeType)
	storedName := fmt.Sprintf("%d-image-%s-%d.%s", time.Now().UnixNano(), sanitizeUploadName(randomIDForHTTP()), slotIndex+1, extension)
	path := filepath.Join(s.config.DataDir, "files", storedName)
	if err := os.WriteFile(path, output.Bytes, 0o600); err != nil {
		return store.ContentAsset{}, fmt.Errorf("保存生成图片失败: %w", err)
	}
	if title == "" {
		title = "生成图片"
	}
	metadata := map[string]any{
		"generatedBy":       "image_model",
		"generationStatus":  "completed",
		"modelConfigId":     model.ID,
		"modelScope":        valueOr(personalModelScope(model), "system"),
		"provider":          model.Provider,
		"model":             model.Model,
		"mode":              valueOr(mode, "image_generation"),
		"prompt":            prompt,
		"slotIndex":         slotIndex,
		"generatedAt":       time.Now().UTC().Format(time.RFC3339Nano),
		"referenceAssetIds": contentAssetIDs(references),
		"referenceCount":    len(references),
		"requestMode":       imageGenerationRequestMode(references),
	}
	for key, value := range encodingMetadata {
		metadata[key] = value
	}
	asset, err := s.store.CreateContentAsset(store.ContentAsset{
		UserID:           userID,
		GroupID:          groupID,
		ResourceType:     "finished_video",
		Type:             "generated",
		Name:             fmt.Sprintf("%s-%d", title, slotIndex+1),
		Description:      "图片模型生成的作品",
		OriginalFileName: "generated-image." + extension,
		StoredFileName:   storedName,
		MimeType:         mimeType,
		FileSize:         int64(len(output.Bytes)),
		Size:             int64(len(output.Bytes)),
		FilePath:         path,
		FileURL:          "/files/" + storedName,
		AssetKind:        "generated_image",
		LifecycleStatus:  "permanent",
		ParentAssetID:    parentAssetID,
		Metadata:         metadata,
	})
	if err != nil {
		_ = os.Remove(path)
		return store.ContentAsset{}, err
	}
	return asset, nil
}

func personalModelScope(model store.ModelConfig) string {
	if model.OwnerUserID != "" {
		return "personal"
	}
	return ""
}

func imageExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/webp":
		return "webp"
	default:
		return "png"
	}
}

func (s *Server) imageGenerationOptions(contextValue map[string]any, params map[string]any) imagegen.GenerateInput {
	generation := objectValue(contextValue["imageGeneration"])
	if len(generation) == 0 {
		generation = params
	}
	size := stringValue(generation, "outputSize")
	if isPlannedCommerceImageMode(generation) {
		if ratio := strings.TrimSpace(stringValue(generation, "aspectRatio")); ratio == "" || strings.EqualFold(ratio, "auto") {
			size = ""
		}
	}
	return imagegen.GenerateInput{
		Size:         size,
		AspectRatio:  valueOr(stringValue(generation, "aspectRatio"), stringValue(params, "aspectRatio")),
		Resolution:   valueOr(stringValue(generation, "resolution"), stringValue(params, "resolution")),
		Background:   valueOr(stringValue(generation, "outputBackground"), stringValue(params, "background")),
		OutputFormat: valueOr(stringValue(generation, "outputFormat"), stringValue(params, "outputFormat")),
		Quality:      valueOr(stringValue(generation, "quality"), stringValue(params, "quality")),
	}
}

func (s *Server) imageGenerationPrompt(content string, contextValue map[string]any, params map[string]any) string {
	generation := objectValue(contextValue["imageGeneration"])
	prompt := valueOr(stringValue(generation, "promptText"), strings.TrimSpace(content))
	prompt = valueOr(prompt, stringValue(generation, "promptHint"))
	return valueOr(prompt, stringValue(params, "prompt"))
}

func imageGenerationCount(contextValue map[string]any, params map[string]any) int {
	generation := objectValue(contextValue["imageGeneration"])
	value := numberValue(generation["outputCount"], numberValue(params["outputCount"], 1))
	count := int(value)
	if count < 1 {
		return 1
	}
	if count > 12 {
		return 12
	}
	return count
}

func (s *Server) imageReferences(userID string, attachments []any, contextValue map[string]any, extraIDs []string) ([]store.ContentAsset, error) {
	ids := make([]string, 0, len(extraIDs)+len(attachments))
	ids = append(ids, extraIDs...)
	for _, attachment := range attachments {
		item, ok := attachment.(map[string]any)
		if !ok {
			continue
		}
		ids = append(ids, stringValue(item, "assetId"), stringValue(item, "id"))
	}
	generation := objectValue(contextValue["imageGeneration"])
	if groups, ok := generation["referenceGroups"].([]any); ok {
		for _, value := range groups {
			group := objectValue(value)
			ids = append(ids, stringSlice(group["attachmentIds"])...)
		}
	}
	seen := map[string]bool{}
	assets := make([]store.ContentAsset, 0, len(ids))
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		id = strings.TrimPrefix(id, "chat-attachment-")
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		asset, found, err := s.store.FindContentAsset(id)
		if err != nil {
			return nil, err
		}
		if !found || asset.UserID != userID {
			return nil, errors.New("参考图片素材不存在")
		}
		if strings.EqualFold(strings.TrimSpace(asset.MimeType), "application/pdf") {
			continue
		}
		if !strings.HasPrefix(asset.MimeType, "image/") {
			return nil, errors.New("参考素材必须是图片")
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

// chatImageReferences always keeps images attached to the current message.
// The chat model may select additional images from conversation history, but
// it must never be able to discard references the user just uploaded.
func (s *Server) chatImageReferences(userID string, input chatRequest, decision imageGenerationDecision) ([]store.ContentAsset, error) {
	current, err := s.imageReferences(userID, input.Attachments, nil, nil)
	if err != nil {
		return nil, err
	}
	if input.AutoImageGeneration && decision.HasReferenceSelection {
		return mergeImageReferenceAssets(current, decision.ReferenceAssets), nil
	}
	return s.imageReferences(userID, input.Attachments, input.CapabilityContext, nil)
}

func mergeImageReferenceAssets(primary, additional []store.ContentAsset) []store.ContentAsset {
	result := make([]store.ContentAsset, 0, len(primary)+len(additional))
	seen := make(map[string]bool, len(primary)+len(additional))
	for _, assets := range [][]store.ContentAsset{primary, additional} {
		for _, asset := range assets {
			if asset.ID == "" || seen[asset.ID] {
				continue
			}
			seen[asset.ID] = true
			result = append(result, asset)
		}
	}
	return result
}
