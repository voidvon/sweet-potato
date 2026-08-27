package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"sweet-potato-go/internal/store"
)

var personalImageProviderDefaultBaseURLs = map[string]string{
	"volcengine-seedream": "https://ark.cn-beijing.volces.com/api/v3",
	"openai-images":       "https://api.openai.com/v1",
}

func (s *Server) handleListUserModelConfigs(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	typeName := strings.TrimSpace(r.URL.Query().Get("type"))
	if typeName != "" && typeName != "image" && typeName != "llm" {
		writeError(w, http.StatusBadRequest, "个人模型当前仅支持 LLM 和图片模型")
		return
	}
	models, err := s.store.ListUserModelConfigs(user.ID, typeName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "个人模型配置读取失败")
		return
	}
	writeJSON(w, http.StatusOK, redactUserModelConfigs(models))
}

func (s *Server) handleCreateUserModelConfig(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	model, err := personalModelInput(store.ModelConfig{}, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(model.APIKey) == "" {
		writeError(w, http.StatusBadRequest, "API Key 不能为空")
		return
	}
	result, err := s.store.SaveUserModelConfig(user.ID, model, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, redactUserModelConfig(result))
}

func (s *Server) handleUserModelConfigSubtree(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	relative := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/user-model-configs/"), "/")
	if relative == "image-providers" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, imageProviders())
		return
	}
	id := strings.TrimSuffix(relative, "/default")
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusNotFound, "个人模型接口不存在")
		return
	}
	current, found, err := s.store.FindUserModelConfig(user.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "个人模型配置读取失败")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "模型配置不存在")
		return
	}
	if r.Method == http.MethodDelete && relative == id {
		if err := s.store.DeleteUserModelConfig(user.ID, id); err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method == http.MethodPut && strings.HasSuffix(relative, "/default") {
		current.IsDefault = true
		result, err := s.store.SaveUserModelConfig(user.ID, current, false)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, redactUserModelConfig(result))
		return
	}
	if r.Method != http.MethodPut || relative != id {
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	model, err := personalModelInput(current, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.store.SaveUserModelConfig(user.ID, model, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, redactUserModelConfig(result))
}

func personalModelInput(current store.ModelConfig, input map[string]any) (store.ModelConfig, error) {
	model := mergeModelInput(current, input)
	if current.Type != "" {
		model.Type = current.Type
	}
	if strings.TrimSpace(model.APIKey) == "" {
		model.APIKey = current.APIKey
	}
	if model.Type == "llm" {
		return personalLLMModelInput(model)
	}
	if model.Type != "image" {
		return store.ModelConfig{}, newInputError("个人模型当前仅支持 LLM 和图片模型")
	}
	return personalImageModelInput(model)
}

func personalLLMModelInput(model store.ModelConfig) (store.ModelConfig, error) {
	model.Provider = strings.TrimSpace(model.Provider)
	if model.Provider == "" {
		return store.ModelConfig{}, newInputError("LLM 服务商不能为空")
	}
	if !validPersonalModelBaseURL(model.BaseURL) {
		return store.ModelConfig{}, newInputError("个人模型服务地址必须是有效的 HTTPS URL")
	}
	if model.Temperature < 0 || model.Temperature > 2 {
		return store.ModelConfig{}, newInputError("Temperature 必须在 0 到 2 之间")
	}
	model.Settings = map[string]any{
		"billing": map[string]any{
			"multiplier":                 0,
			"maxOutputCreditsForReserve": 0,
			"priceSource":                "personal-api-key",
		},
	}
	return model, nil
}

func personalImageModelInput(model store.ModelConfig) (store.ModelConfig, error) {
	model.Provider = strings.TrimSpace(model.Provider)
	if model.Provider == "" {
		return store.ModelConfig{}, newInputError("图片模型服务商不能为空")
	}
	if strings.TrimSpace(model.BaseURL) == "" {
		model.BaseURL = personalImageProviderDefaultBaseURLs[model.Provider]
	}
	if !validPersonalModelBaseURL(model.BaseURL) {
		return store.ModelConfig{}, newInputError("个人模型服务地址必须是有效的 HTTPS URL")
	}
	supportsCustomResolution := false
	maxConcurrency := 3
	if imageGeneration := objectValue(model.Settings["imageGeneration"]); imageGeneration != nil {
		supportsCustomResolution = boolValue(imageGeneration["supportsCustomResolution"])
		maxConcurrency = int(numberValue(imageGeneration["maxConcurrency"], 3))
	}
	if maxConcurrency < 1 || maxConcurrency > 12 {
		return store.ModelConfig{}, newInputError("图片生成并发数量必须在 1 到 12 之间")
	}
	model.Settings = map[string]any{
		"imageGeneration": map[string]any{"supportsCustomResolution": supportsCustomResolution, "maxConcurrency": maxConcurrency},
		"billing":         map[string]any{"creditsPerRequest": 0, "priceSource": "personal-api-key"},
	}
	return model, nil
}

type inputError string

func (e inputError) Error() string       { return string(e) }
func newInputError(message string) error { return inputError(message) }

func validPersonalModelBaseURL(value string) bool {
	actualURL, actualErr := url.Parse(strings.TrimSpace(value))
	return actualErr == nil && actualURL.Scheme == "https" && actualURL.User == nil && actualURL.Host != ""
}

func redactUserModelConfig(model store.ModelConfig) map[string]any {
	result := redactModelConfig(model)
	result["scope"] = "personal"
	if model.Type == "llm" {
		result["settings"] = map[string]any{
			"billing": map[string]any{"multiplier": 0, "maxOutputCreditsForReserve": 0, "priceSource": "personal-api-key"},
		}
	} else {
		result["settings"] = map[string]any{
			"imageGeneration": objectValue(model.Settings["imageGeneration"]),
			"billing":         map[string]any{"creditsPerRequest": 0, "priceSource": "personal-api-key"},
		}
	}
	return result
}

func redactUserModelConfigs(models []store.ModelConfig) []map[string]any {
	result := make([]map[string]any, 0, len(models))
	for _, model := range models {
		result = append(result, redactUserModelConfig(model))
	}
	return result
}
