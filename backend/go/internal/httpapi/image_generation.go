package httpapi

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ai-marketing-go/internal/imagegen"
	"ai-marketing-go/internal/store"
)

func (s *Server) resolveImageModelConfig(requestedID string) store.ModelConfig {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" {
		if model, found, err := s.store.FindModelConfig(requestedID); err == nil && found && model.Type == "image" {
			return withImageEnvironmentCredentials(model)
		}
	}
	if models, err := s.store.ListModelConfigs("image"); err == nil {
		for _, model := range models {
			if model.IsDefault {
				return withImageEnvironmentCredentials(model)
			}
		}
		if len(models) > 0 {
			return withImageEnvironmentCredentials(models[0])
		}
	}
	return withImageEnvironmentCredentials(store.ModelConfig{
		ID:       "env-image",
		Type:     "image",
		Provider: valueOr(strings.TrimSpace(os.Getenv("IMAGE_MODEL_PROVIDER")), "openai-images"),
		Model:    valueOr(strings.TrimSpace(os.Getenv("IMAGE_MODEL_ID")), "gpt-image-1"),
		BaseURL:  strings.TrimSpace(os.Getenv("IMAGE_MODEL_BASE_URL")),
	})
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

func (s *Server) generateImageAssets(userID string, model store.ModelConfig, prompt string, count int, references []store.ContentAsset, options imagegen.GenerateInput, mode, title string, parentAssetID *string) ([]store.ContentAsset, error) {
	if strings.TrimSpace(prompt) == "" {
		return nil, errors.New("图片提示词不能为空")
	}
	options.Prompt = prompt
	options.Count = count
	client := imagegen.Client{BaseURL: model.BaseURL, APIKey: model.APIKey, Provider: model.Provider, Model: model.Model, PublicBase: strings.TrimRight(os.Getenv("PUBLIC_BASE_URL"), "/")}
	outputs, err := client.Generate(context.Background(), optionsWithReferences(options, references))
	if err != nil {
		return nil, err
	}
	if len(outputs) == 0 {
		return nil, errors.New("图片模型没有返回可用图片")
	}
	groupID, err := s.ensureContentGroup(userID, "finished_video")
	if err != nil {
		return nil, fmt.Errorf("创建图片作品分组失败: %w", err)
	}
	assets := make([]store.ContentAsset, 0, len(outputs))
	for index, output := range outputs {
		asset, persistErr := s.persistGeneratedImage(userID, groupID, output, mode, title, prompt, index, parentAssetID, model)
		if persistErr != nil {
			for _, created := range assets {
				_ = os.Remove(created.FilePath)
				_, _ = s.store.DeleteContentAsset(created.ID, userID)
			}
			return nil, persistErr
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

func optionsWithReferences(options imagegen.GenerateInput, references []store.ContentAsset) imagegen.GenerateInput {
	options.References = references
	return options
}

func (s *Server) persistGeneratedImage(userID, groupID string, output imagegen.Output, mode, title, prompt string, slotIndex int, parentAssetID *string, model store.ModelConfig) (store.ContentAsset, error) {
	if len(output.Bytes) == 0 {
		return store.ContentAsset{}, errors.New("图片模型返回了空文件")
	}
	mimeType := valueOr(output.MimeType, "image/png")
	extension := imageExtension(mimeType)
	storedName := fmt.Sprintf("%d-image-%s-%d.%s", time.Now().UnixNano(), sanitizeUploadName(randomIDForHTTP()), slotIndex+1, extension)
	path := filepath.Join(s.config.DataDir, "files", storedName)
	if err := os.WriteFile(path, output.Bytes, 0o644); err != nil {
		return store.ContentAsset{}, fmt.Errorf("保存生成图片失败: %w", err)
	}
	if title == "" {
		title = "生成图片"
	}
	metadata := map[string]any{
		"generatedBy":      "image_model",
		"generationStatus": "completed",
		"provider":         model.Provider,
		"model":            model.Model,
		"mode":             valueOr(mode, "image_generation"),
		"prompt":           prompt,
		"slotIndex":        slotIndex,
		"generatedAt":      time.Now().UTC().Format(time.RFC3339Nano),
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
	return imagegen.GenerateInput{
		Size:         stringValue(generation, "outputSize"),
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
	return valueOr(prompt, stringValue(params, "prompt"))
}

func imageGenerationCount(contextValue map[string]any, params map[string]any) int {
	generation := objectValue(contextValue["imageGeneration"])
	value := numberValue(generation["outputCount"], numberValue(params["outputCount"], 1))
	count := int(value)
	if count < 1 {
		return 1
	}
	if count > 4 {
		return 4
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
		if !strings.HasPrefix(asset.MimeType, "image/") {
			return nil, errors.New("参考素材必须是图片")
		}
		assets = append(assets, asset)
	}
	return assets, nil
}
