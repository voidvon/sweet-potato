package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"sweet-potato-go/internal/pluginruntime"
	"sweet-potato-go/internal/store"
)

func (s *Server) handleGenerateRemotionJSON(w http.ResponseWriter, r *http.Request, session store.ContentPlanningSession) {
	if isActiveRemotionRender(objectValue(session.Analysis["renderGeneration"])) {
		writeError(w, http.StatusConflict, "视频正在渲染，请先取消渲染任务")
		return
	}
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	capabilities, err := s.plugins.Capabilities(r.Context(), pluginruntime.RemotionPluginKey)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, pluginruntime.ErrNotRunning) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	motionPlan := map[string]any{"scenes": []any{}}
	if model, modelErr := s.resolveLLMModelConfig(session.UserID, "", ""); modelErr == nil {
		if organized, organizeErr := s.organizeRemotionScenes(r.Context(), session, model, capabilities); organizeErr == nil {
			motionPlan = organized
		}
	}
	composeInput, err := planningRemotionComposeInput(session, stringValue(input, "presetId"), motionPlan, remotionAssetURLResolver(r))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.plugins.Compose(r.Context(), pluginruntime.RemotionPluginKey, composeInput)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	renderRequest := objectValue(result["renderRequest"])
	if len(renderRequest) == 0 {
		writeError(w, http.StatusBadGateway, "Remotion 插件没有返回渲染 JSON")
		return
	}
	validation, err := s.plugins.Validate(r.Context(), pluginruntime.RemotionPluginKey, renderRequest)
	if err != nil {
		session.Analysis["remotionGeneration"] = map[string]any{
			"status": "failed", "presetId": stringValue(input, "presetId"), "errorMessage": err.Error(), "generatedAt": result["generatedAt"],
		}
		if updated, updateErr := s.store.UpdatePlanningSession(session); updateErr == nil {
			s.publishPlanningSessionUpdated(updated, "remotion-json")
		}
		status := http.StatusBadGateway
		if errors.Is(err, pluginruntime.ErrNotRunning) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}

	session.Analysis["remotionGeneration"] = map[string]any{
		"status": "completed", "presetId": stringValue(input, "presetId"), "preset": result["preset"],
		"plan": result["plan"], "motionPlan": motionPlan, "renderRequest": renderRequest, "validation": validation,
		"generatedAt": result["generatedAt"], "errorMessage": "",
	}
	session.Analysis["renderGeneration"] = map[string]any{
		"status": "idle", "progress": 0, "pluginJobId": "", "assetId": "", "fileUrl": "", "errorMessage": "",
	}
	updated, err := s.store.UpdatePlanningSession(session)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Remotion JSON 保存失败")
		return
	}
	s.publishPlanningSessionUpdated(updated, "remotion-json")
	writeJSON(w, http.StatusOK, updated)
}

func planningRemotionComposeInput(session store.ContentPlanningSession, presetID string, motionPlan map[string]any, resolveURL func(string) (string, error)) (map[string]any, error) {
	plan := objectValue(session.Analysis["campaignPlan"])
	planScenes := anySlice(plan["scenes"])
	if len(planScenes) == 0 {
		return nil, errors.New("请先完成 AI 内容分析")
	}
	imageGeneration := objectValue(session.Analysis["campaignImageGeneration"])
	if stringValue(imageGeneration, "status") != "completed" {
		return nil, errors.New("请先完成宣传图片生成")
	}
	narrationGeneration := objectValue(session.Analysis["narrationGeneration"])
	if stringValue(narrationGeneration, "status") != "completed" {
		return nil, errors.New("请先完成旁白与字幕生成")
	}
	imagesByScene := map[string][]map[string]any{}
	for _, value := range anySlice(imageGeneration["images"]) {
		image := objectValue(value)
		if sceneID := stringValue(image, "sceneId"); sceneID != "" {
			imagesByScene[sceneID] = append(imagesByScene[sceneID], image)
		}
	}
	narrationByScene := map[string]map[string]any{}
	for _, value := range anySlice(narrationGeneration["scenes"]) {
		narration := objectValue(value)
		if sceneID := stringValue(narration, "sceneId"); sceneID != "" {
			narrationByScene[sceneID] = narration
		}
	}
	scenes := make([]any, 0, len(planScenes))
	for index, value := range planScenes {
		scene := objectValue(value)
		sceneID := valueOr(stringValue(scene, "id"), fmt.Sprintf("scene-%d", index+1))
		images := imagesByScene[sceneID]
		if len(images) == 0 {
			return nil, fmt.Errorf("场景 %s 缺少宣传图片", sceneID)
		}
		composeImages := make([]any, 0, len(images))
		for _, image := range images {
			url, err := resolveURL(stringValue(image, "fileUrl"))
			if err != nil {
				return nil, fmt.Errorf("场景 %s 宣传图片地址无效: %w", sceneID, err)
			}
			composeImages = append(composeImages, map[string]any{"assetId": stringValue(image, "assetId"), "url": url})
		}
		narration := narrationByScene[sceneID]
		if len(narration) == 0 {
			return nil, fmt.Errorf("场景 %s 缺少旁白", sceneID)
		}
		audioURL, err := resolveURL(stringValue(narration, "fileUrl"))
		if err != nil {
			return nil, fmt.Errorf("场景 %s 旁白地址无效: %w", sceneID, err)
		}
		durationMs := int(numberValue(narration["durationMs"], numberValue(scene["durationInSeconds"], 4)*1000))
		if durationMs < 1000 {
			durationMs = 1000
		}
		scenes = append(scenes, map[string]any{
			"id": sceneID, "title": stringValue(scene, "title"), "subtitle": stringValue(scene, "subtitle"), "cta": stringValue(scene, "cta"), "durationMs": durationMs,
			"images":    composeImages,
			"narration": map[string]any{"assetId": stringValue(narration, "assetId"), "url": audioURL, "startMs": numberValue(narration["startMs"], 0), "captions": anySlice(narration["captions"])},
		})
	}
	return map[string]any{"presetId": presetID, "visualStyle": stringValue(plan, "visualStyle"), "scenes": scenes, "motionPlan": motionPlan}, nil
}

func remotionAssetURLResolver(r *http.Request) func(string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/")
	if base == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
		if forwarded == "http" || forwarded == "https" {
			scheme = forwarded
		}
		base = scheme + "://" + r.Host
	}
	return func(raw string) (string, error) {
		value := strings.TrimSpace(raw)
		parsed, err := url.Parse(value)
		if err != nil {
			return "", err
		}
		if parsed.IsAbs() {
			return value, nil
		}
		if !strings.HasPrefix(value, "/") {
			value = "/" + value
		}
		return base + value, nil
	}
}
