package httpapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"sweet-potato-go/internal/audio"
	"sweet-potato-go/internal/store"
)

const (
	planningNarrationMaxScenes = 6
	planningCaptionMaxRunes    = 18
)

type planningNarrationScene struct {
	ID   string
	Text string
}

func (s *Server) queuePlanningNarration(session store.ContentPlanningSession, input map[string]any) (store.ContentPlanningSession, string, error) {
	if isActiveRemotionRender(objectValue(session.Analysis["renderGeneration"])) {
		return session, "", errors.New("视频正在渲染，请先取消渲染任务")
	}
	scenes := planningNarrationInputs(session)
	if len(scenes) == 0 {
		return session, "", errors.New("当前分析结果没有可用的场景旁白，请先完成 AI 内容分析")
	}
	generation := objectValue(session.Analysis["narrationGeneration"])
	if stringValue(generation, "status") == "generating" {
		return session, "", errors.New("旁白与字幕正在生成")
	}
	// Leave the voice empty when the client does not specify one. The worker
	// selects a provider-specific default after resolving the configured model.
	voice := strings.TrimSpace(stringValue(input, "voice"))
	speed := numberValue(input["speed"], 1)
	if speed < 0.5 || speed > 2 {
		speed = 1
	}
	runID := randomIDForHTTP()
	session.Analysis["narrationGeneration"] = map[string]any{
		"runId":         runID,
		"status":        "generating",
		"provider":      strings.TrimSpace(stringValue(input, "provider")),
		"voice":         voice,
		"speed":         speed,
		"instruction":   strings.TrimSpace(stringValue(input, "instruction")),
		"modelConfigId": strings.TrimSpace(stringValue(input, "modelConfigId")),
		"durationMs":    0,
		"scenes":        []any{},
		"captions":      []any{},
		"errorMessage":  "",
		"startedAt":     time.Now().UTC().Format(time.RFC3339Nano),
	}
	session.Analysis["remotionGeneration"] = map[string]any{"status": "idle", "presetId": "", "errorMessage": ""}
	session.Analysis["renderGeneration"] = map[string]any{"status": "idle", "progress": 0, "pluginJobId": "", "assetId": "", "fileUrl": "", "errorMessage": ""}
	updated, err := s.store.UpdatePlanningSession(session)
	return updated, runID, err
}

func (s *Server) executePlanningNarration(sessionID, runID string) {
	session, found, err := s.store.FindPlanningSession(sessionID)
	if err != nil || !found || !planningNarrationRunActive(session, runID) {
		return
	}
	generation := objectValue(session.Analysis["narrationGeneration"])
	model, err := s.resolveAudioModelConfig(session.UserID, stringValue(generation, "modelConfigId"))
	if err != nil {
		s.failPlanningNarration(session, runID, err, nil, nil, 0)
		return
	}
	voice := strings.TrimSpace(stringValue(generation, "voice"))
	if !isSupportedPresetAudioVoice(model, voice) {
		// Older sessions may contain a voice from another provider (for example
		// `alloy`) or may have been created while a voice-clone model was the
		// default. Never forward that stale value to MiMo: its API returns the
		// unhelpful "Param Incorrect" response for an invalid voice contract.
		voice = defaultAudioVoice(model)
	}
	speed := numberValue(generation["speed"], 1)
	if speed < 0.5 || speed > 2 {
		speed = 1
	}
	instruction := stringValue(generation, "instruction")
	client := audio.Client{
		BaseURL:  model.BaseURL,
		APIKey:   model.APIKey,
		Provider: model.Provider,
		Model:    model.Model,
	}
	groupID, err := s.ensureContentGroup(session.UserID, "finished_video")
	if err != nil {
		s.failPlanningNarration(session, runID, err, nil, nil, 0)
		return
	}
	ctx, cancel := context.WithTimeout(s.taskContext(), 15*time.Minute)
	defer cancel()
	scenes := planningNarrationInputs(session)
	results := make([]any, 0, len(scenes))
	allCaptions := make([]any, 0)
	totalDurationMs := 0
	for index, scene := range scenes {
		if !planningNarrationRunActiveForSession(sessionID, runID, s) {
			return
		}
		output, synthErr := client.Synthesize(ctx, audio.SpeechInput{
			Voice: voice, Text: scene.Text, Speed: speed, Instruction: instruction,
		})
		if synthErr != nil {
			s.failPlanningNarration(session, runID, synthErr, results, allCaptions, totalDurationMs)
			return
		}
		durationMs, durationErr := audio.DurationMs(output.Bytes)
		if durationErr != nil {
			s.failPlanningNarration(session, runID, durationErr, results, allCaptions, totalDurationMs)
			return
		}
		asset, persistErr := s.persistNarrationAudio(session.UserID, groupID, sessionID, scene, index, output.Bytes, model)
		if persistErr != nil {
			s.failPlanningNarration(session, runID, persistErr, results, allCaptions, totalDurationMs)
			return
		}
		captions := narrationCaptions(scene.Text, totalDurationMs, durationMs)
		results = append(results, map[string]any{
			"sceneId":    scene.ID,
			"text":       scene.Text,
			"assetId":    asset.ID,
			"fileUrl":    asset.FileURL,
			"durationMs": durationMs,
			"startMs":    totalDurationMs,
			"captions":   captions,
		})
		allCaptions = append(allCaptions, captions...)
		totalDurationMs += durationMs
		current, currentFound, currentErr := s.store.FindPlanningSession(sessionID)
		if currentErr != nil || !currentFound || !planningNarrationRunActive(current, runID) {
			return
		}
		current.Analysis["narrationGeneration"] = map[string]any{
			"runId": runID, "status": "generating", "provider": valueOr(stringValue(generation, "provider"), model.Provider),
			"voice": voice, "speed": speed, "instruction": instruction, "modelConfigId": model.ID,
			"durationMs": totalDurationMs, "scenes": results, "captions": allCaptions, "errorMessage": "",
			"startedAt": stringValue(generation, "startedAt"),
		}
		updated, updateErr := s.store.UpdatePlanningSession(current)
		if updateErr != nil {
			s.failPlanningNarration(current, runID, updateErr, results, allCaptions, totalDurationMs)
			return
		}
		s.publishPlanningSessionUpdated(updated, "narration")
		session = updated
		generation = objectValue(session.Analysis["narrationGeneration"])
	}
	current, found, err := s.store.FindPlanningSession(sessionID)
	if err != nil || !found || !planningNarrationRunActive(current, runID) {
		return
	}
	current.Analysis["narrationGeneration"] = map[string]any{
		"runId": runID, "status": "completed", "provider": valueOr(stringValue(generation, "provider"), model.Provider),
		"voice": voice, "speed": speed, "instruction": instruction, "modelConfigId": model.ID,
		"durationMs": totalDurationMs, "scenes": results, "captions": allCaptions, "errorMessage": "",
		"startedAt": stringValue(generation, "startedAt"), "completedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if updated, updateErr := s.store.UpdatePlanningSession(current); updateErr == nil {
		s.publishPlanningSessionUpdated(updated, "narration")
	}
}

func (s *Server) persistNarrationAudio(userID, groupID, sessionID string, scene planningNarrationScene, index int, data []byte, model store.ModelConfig) (store.ContentAsset, error) {
	if len(data) == 0 {
		return store.ContentAsset{}, errors.New("语音模型返回了空音频")
	}
	filename := fmt.Sprintf("%d-narration-%s-%d.wav", time.Now().UnixNano(), randomIDForHTTP(), index+1)
	path := filepath.Join(s.config.DataDir, "files", filename)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return store.ContentAsset{}, fmt.Errorf("保存旁白音频失败: %w", err)
	}
	asset, err := s.store.CreateContentAsset(store.ContentAsset{
		UserID: userID, GroupID: groupID, ResourceType: "finished_video", Type: "generated",
		Name: fmt.Sprintf("旁白-%s", valueOr(scene.ID, fmt.Sprintf("场景 %d", index+1))), Description: "营销视频旁白音频",
		OriginalFileName: fmt.Sprintf("narration-%d.wav", index+1), StoredFileName: filename, MimeType: "audio/wav",
		FileSize: int64(len(data)), Size: int64(len(data)), FilePath: path, FileURL: "/files/" + filename,
		AssetKind: "generated_narration", LifecycleStatus: "permanent",
		Metadata: map[string]any{"generatedBy": "audio_model", "generationStatus": "completed", "sessionId": sessionID, "sceneId": scene.ID, "modelConfigId": model.ID, "provider": model.Provider, "model": model.Model},
	})
	if err != nil {
		_ = os.Remove(path)
	}
	return asset, err
}

func planningNarrationInputs(session store.ContentPlanningSession) []planningNarrationScene {
	plan := objectValue(session.Analysis["campaignPlan"])
	result := make([]planningNarrationScene, 0, planningNarrationMaxScenes)
	for index, value := range anySlice(plan["scenes"]) {
		if len(result) >= planningNarrationMaxScenes {
			break
		}
		scene := objectValue(value)
		id := strings.TrimSpace(stringValue(scene, "id"))
		if id == "" {
			id = fmt.Sprintf("scene-%d", index+1)
		}
		text := strings.TrimSpace(stringValue(scene, "voiceover"))
		if text == "" {
			text = strings.TrimSpace(stringValue(scene, "title"))
		}
		if text == "" {
			text = fmt.Sprintf("场景 %d", index+1)
		}
		result = append(result, planningNarrationScene{ID: id, Text: text})
	}
	return result
}

func planningNarrationRunActive(session store.ContentPlanningSession, runID string) bool {
	return stringValue(objectValue(session.Analysis["narrationGeneration"]), "status") == "generating" && stringValue(objectValue(session.Analysis["narrationGeneration"]), "runId") == runID
}

func planningNarrationRunActiveForSession(sessionID, runID string, s *Server) bool {
	current, found, err := s.store.FindPlanningSession(sessionID)
	return err == nil && found && planningNarrationRunActive(current, runID)
}

func (s *Server) failPlanningNarration(session store.ContentPlanningSession, runID string, cause error, scenes, captions []any, durationMs int) {
	current, found, err := s.store.FindPlanningSession(session.ID)
	if err != nil || !found || !planningNarrationRunActive(current, runID) {
		return
	}
	generation := objectValue(current.Analysis["narrationGeneration"])
	if len(scenes) == 0 {
		scenes = anySlice(generation["scenes"])
	}
	if len(captions) == 0 {
		captions = anySlice(generation["captions"])
	}
	current.Analysis["narrationGeneration"] = map[string]any{
		"runId": runID, "status": "failed", "provider": stringValue(generation, "provider"), "voice": stringValue(generation, "voice"),
		"speed": numberValue(generation["speed"], 1), "instruction": stringValue(generation, "instruction"), "modelConfigId": stringValue(generation, "modelConfigId"),
		"durationMs": durationMs, "scenes": scenes, "captions": captions, "errorMessage": cause.Error(),
		"startedAt": stringValue(generation, "startedAt"), "completedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if updated, updateErr := s.store.UpdatePlanningSession(current); updateErr == nil {
		s.publishPlanningSessionUpdated(updated, "narration")
	}
}

func narrationCaptions(text string, startMs, durationMs int) []any {
	parts := splitNarrationCaptionParts(text, planningCaptionMaxRunes)
	if len(parts) == 0 {
		parts = []string{text}
	}
	totalWeight := 0
	for _, part := range parts {
		totalWeight += maxInt(1, utf8.RuneCountInString(part))
	}
	result := make([]any, 0, len(parts))
	elapsedWeight := 0
	for index, part := range parts {
		start := startMs + int(math.Round(float64(durationMs)*float64(elapsedWeight)/float64(totalWeight)))
		elapsedWeight += maxInt(1, utf8.RuneCountInString(part))
		end := startMs + int(math.Round(float64(durationMs)*float64(elapsedWeight)/float64(totalWeight)))
		if index == len(parts)-1 {
			end = startMs + durationMs
		}
		if end <= start {
			end = start + 1
		}
		result = append(result, map[string]any{"text": part, "startMs": start, "endMs": end, "timestampMs": start, "confidence": 1})
	}
	return result
}

func splitNarrationCaptionParts(text string, maxRunes int) []string {
	parts := splitNarrationSentences(text)
	if maxRunes < 1 {
		return parts
	}
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		runes := []rune(part)
		for len(runes) > maxRunes {
			result = append(result, strings.TrimSpace(string(runes[:maxRunes])))
			runes = runes[maxRunes:]
		}
		if remainder := strings.TrimSpace(string(runes)); remainder != "" {
			result = append(result, remainder)
		}
	}
	return result
}

func splitNarrationSentences(text string) []string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if text == "" {
		return nil
	}
	result := []string{}
	start := 0
	for index, r := range text {
		if !strings.ContainsRune("。！？!?；;，,\n", r) {
			continue
		}
		end := index + utf8.RuneLen(r)
		part := strings.TrimSpace(text[start:end])
		if part != "" {
			result = append(result, part)
		}
		start = end
	}
	if part := strings.TrimSpace(text[start:]); part != "" {
		result = append(result, part)
	}
	return result
}

func maxInt(value, minimum int) int {
	if value < minimum {
		return minimum
	}
	return value
}

func (s *Server) resolveAudioModelConfig(userID, requestedID string) (store.ModelConfig, error) {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" {
		if model, found, err := s.store.FindUserModelConfig(userID, requestedID); err != nil {
			return store.ModelConfig{}, err
		} else if found {
			if model.Type != "audio" {
				return store.ModelConfig{}, errors.New("音频模型不存在或无权使用")
			}
			model = withAudioEnvironmentCredentials(model)
			if audioModelSupportsPresetVoice(model) {
				return model, nil
			}
		}
		if model, found, err := s.store.FindModelConfig(requestedID); err != nil {
			return store.ModelConfig{}, err
		} else if found {
			if model.Type != "audio" {
				return store.ModelConfig{}, errors.New("音频模型不存在或无权使用")
			}
			model = withAudioEnvironmentCredentials(model)
			if audioModelSupportsPresetVoice(model) {
				return model, nil
			}
		}
		// The marketing-video narrator only sends a preset voice ID. A voice
		// clone/design model cannot consume that value, so prefer another
		// configured audio model that supports preset voices when a stale or
		// incompatible model ID is supplied by an older session.
		if model, found, err := s.findPresetAudioModel(userID, requestedID); err != nil {
			return store.ModelConfig{}, err
		} else if found {
			return model, nil
		}
		return store.ModelConfig{}, errors.New("当前音频模型不支持预置音色，请配置并启用 MiMo TTS（mimo-v2.5-tts）")
	}
	if models, err := s.store.ListUserModelConfigs(userID, "audio"); err == nil {
		if model, found := selectPresetAudioModel(models); found {
			return withAudioEnvironmentCredentials(model), nil
		}
	}
	models, err := s.store.ListModelConfigs("audio")
	if err != nil {
		return store.ModelConfig{}, err
	}
	if model, found := selectPresetAudioModel(models); found {
		return withAudioEnvironmentCredentials(model), nil
	}
	// Keep the error explicit when the only configured model is a voice clone
	// or voice design model. Falling through to environment defaults would hide
	// a configuration mistake and produce the same opaque upstream 400.
	if len(models) > 0 {
		return store.ModelConfig{}, errors.New("当前音频模型不支持预置音色，请配置并启用 MiMo TTS（mimo-v2.5-tts）")
	}
	provider := strings.TrimSpace(os.Getenv("AUDIO_MODEL_PROVIDER"))
	if provider == "" {
		if strings.TrimSpace(os.Getenv("MIMO_API_KEY")) != "" {
			provider = "mimo-tts"
		} else {
			provider = "openai-audio"
		}
	}
	return withAudioEnvironmentCredentials(store.ModelConfig{ID: "env-audio", Type: "audio", Provider: provider}), nil
}

// findPresetAudioModel searches user and system configurations for a model
// that can consume the preset voice IDs exposed by this feature. The requested
// ID is excluded so a stale voice-clone/design session cannot select itself
// again. Defaults win over non-default configurations, followed by the
// existing sort order returned by the store.
func (s *Server) findPresetAudioModel(userID, excludedID string) (store.ModelConfig, bool, error) {
	if models, err := s.store.ListUserModelConfigs(userID, "audio"); err != nil {
		return store.ModelConfig{}, false, err
	} else if model, found := selectPresetAudioModelExcluding(models, excludedID); found {
		return withAudioEnvironmentCredentials(model), true, nil
	}
	models, err := s.store.ListModelConfigs("audio")
	if err != nil {
		return store.ModelConfig{}, false, err
	}
	model, found := selectPresetAudioModelExcluding(models, excludedID)
	if !found {
		return store.ModelConfig{}, false, nil
	}
	return withAudioEnvironmentCredentials(model), true, nil
}

func selectPresetAudioModel(models []store.ModelConfig) (store.ModelConfig, bool) {
	return selectPresetAudioModelExcluding(models, "")
}

func selectPresetAudioModelExcluding(models []store.ModelConfig, excludedID string) (store.ModelConfig, bool) {
	var fallback store.ModelConfig
	foundFallback := false
	for _, model := range models {
		if model.Type != "audio" || strings.TrimSpace(model.ID) == strings.TrimSpace(excludedID) || !audioModelSupportsPresetVoice(model) {
			continue
		}
		if model.IsDefault {
			return model, true
		}
		if !foundFallback {
			fallback = model
			foundFallback = true
		}
	}
	return fallback, foundFallback
}

func withAudioEnvironmentCredentials(model store.ModelConfig) store.ModelConfig {
	provider := strings.ToLower(strings.TrimSpace(model.Provider + " " + model.BaseURL + " " + model.Model))
	if strings.TrimSpace(model.APIKey) == "" {
		for _, name := range audioAPIKeyNames(provider) {
			if value := strings.TrimSpace(os.Getenv(name)); value != "" {
				model.APIKey = value
				break
			}
		}
	}
	if strings.TrimSpace(model.BaseURL) == "" {
		if strings.Contains(provider, "mimo") || strings.Contains(provider, "xiaomimimo") {
			model.BaseURL = valueOr(strings.TrimSpace(os.Getenv("MIMO_BASE_URL")), "https://api.xiaomimimo.com/v1")
		} else {
			model.BaseURL = valueOr(strings.TrimSpace(os.Getenv("AUDIO_MODEL_BASE_URL")), valueOr(strings.TrimSpace(os.Getenv("OPENAI_BASE_URL")), "https://api.openai.com/v1"))
		}
	}
	if strings.TrimSpace(model.Model) == "" {
		if strings.Contains(provider, "mimo") || strings.Contains(provider, "xiaomimimo") {
			model.Model = valueOr(strings.TrimSpace(os.Getenv("MIMO_TTS_MODEL")), "mimo-v2.5-tts")
		} else {
			model.Model = valueOr(strings.TrimSpace(os.Getenv("AUDIO_MODEL_ID")), "gpt-4o-mini-tts")
		}
	}
	return model
}

func audioAPIKeyNames(provider string) []string {
	if strings.Contains(provider, "mimo") || strings.Contains(provider, "xiaomimimo") {
		return []string{"AUDIO_MODEL_API_KEY", "MIMO_API_KEY", "OPENAI_API_KEY"}
	}
	return []string{"AUDIO_MODEL_API_KEY", "OPENAI_API_KEY"}
}

func isMiMoAudioModel(model store.ModelConfig) bool {
	value := strings.ToLower(model.Provider + " " + model.BaseURL + " " + model.Model)
	return strings.Contains(value, "mimo") || strings.Contains(value, "xiaomimimo")
}

// MiMo voice-clone and voice-design models use a different voice contract
// from the preset-voice TTS model. The marketing-video workflow currently
// exposes only preset voice IDs, so those models must not be selected here.
func audioModelSupportsPresetVoice(model store.ModelConfig) bool {
	if !isMiMoAudioModel(model) {
		return true
	}
	modelID := strings.ToLower(strings.TrimSpace(model.Model))
	return !strings.Contains(modelID, "voiceclone") && !strings.Contains(modelID, "voicedesign")
}

func isSupportedPresetAudioVoice(model store.ModelConfig, voice string) bool {
	voice = strings.TrimSpace(voice)
	if voice == "" || !audioModelSupportsPresetVoice(model) {
		return false
	}
	for _, candidate := range contentPlanningAudioVoices(model) {
		if strings.TrimSpace(stringValue(candidate, "id")) == voice {
			return true
		}
	}
	return false
}

func defaultAudioVoice(model store.ModelConfig) string {
	if isMiMoAudioModel(model) {
		return "mimo_default"
	}
	return "alloy"
}

func contentPlanningAudioVoices(model store.ModelConfig) []map[string]any {
	if isMiMoAudioModel(model) {
		if !audioModelSupportsPresetVoice(model) {
			return []map[string]any{}
		}
		return []map[string]any{
			{"id": "mimo_default", "name": "MiMo 默认音色", "language": "中文/English", "provider": "mimo"},
			{"id": "冰糖", "name": "MiMo 冰糖（女声）", "language": "中文", "provider": "mimo"},
			{"id": "茉莉", "name": "MiMo 茉莉（女声）", "language": "中文", "provider": "mimo"},
			{"id": "苏打", "name": "MiMo 苏打（男声）", "language": "中文", "provider": "mimo"},
			{"id": "白桦", "name": "MiMo 白桦（男声）", "language": "中文", "provider": "mimo"},
		}
	}
	return []map[string]any{
		{"id": "alloy", "name": "Alloy", "language": "多语言", "provider": "openai"},
		{"id": "ash", "name": "Ash", "language": "多语言", "provider": "openai"},
		{"id": "coral", "name": "Coral", "language": "多语言", "provider": "openai"},
		{"id": "echo", "name": "Echo", "language": "多语言", "provider": "openai"},
		{"id": "fable", "name": "Fable", "language": "多语言", "provider": "openai"},
		{"id": "nova", "name": "Nova", "language": "多语言", "provider": "openai"},
		{"id": "onyx", "name": "Onyx", "language": "多语言", "provider": "openai"},
		{"id": "sage", "name": "Sage", "language": "多语言", "provider": "openai"},
		{"id": "shimmer", "name": "Shimmer", "language": "多语言", "provider": "openai"},
	}
}
