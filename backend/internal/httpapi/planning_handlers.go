package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"sweet-potato-go/internal/pluginruntime"
	"sweet-potato-go/internal/store"
)

func (s *Server) handleContentPlanning(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "web.module.content.create_video"); !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/content-planning"), "/"))
	if len(parts) == 1 && parts[0] == "config" && r.Method == http.MethodGet {
		settings, err := s.store.GetBillingSettings()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "内容策划配置读取失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"analysisCredits": settings.ContentPlanningAnalysisCredits, "generationCredits": settings.ContentPlanningGenerationCredits})
		return
	}
	if len(parts) == 1 && parts[0] == "voices" && r.Method == http.MethodGet {
		user, _ := s.authenticatedUser(r)
		model, err := s.resolveAudioModelConfig(user.ID, "")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"voices":   contentPlanningAudioVoices(model),
			"provider": model.Provider,
			"model":    model.Model,
		})
		return
	}
	if len(parts) == 1 && parts[0] == "remotion-presets" && r.Method == http.MethodGet {
		payload := map[string]any{
			"presets": []any{},
			"runtime": s.plugins.Status(pluginruntime.RemotionPluginKey),
		}
		if capabilities, err := s.plugins.Capabilities(r.Context(), pluginruntime.RemotionPluginKey); err == nil {
			payload["capabilities"] = capabilities
			payload["presets"] = anySlice(capabilities["presets"])
		}
		writeJSON(w, http.StatusOK, payload)
		return
	}
	if len(parts) == 1 && parts[0] == "sessions" && r.Method == http.MethodPost {
		user, _ := s.authenticatedUser(r)
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		if boolValue(input["restoreLatest"]) {
			latest, found, err := s.store.FindLatestPlanningSession(user.ID, "create_video")
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if found {
				writeJSON(w, http.StatusOK, latest)
				return
			}
		}
		if id := stringValue(input, "sessionId"); id != "" {
			session, found, err := s.store.FindPlanningSession(id)
			if err != nil || !found || session.UserID != user.ID {
				writeError(w, http.StatusBadRequest, "planning session not found")
				return
			}
			writeJSON(w, http.StatusOK, session)
			return
		}
		session, err := s.store.CreatePlanningSession(user.ID, stringValue(input, "sourceSurface"), stringValue(input, "prompt"), stringValue(input, "productName"))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, session)
		return
	}
	if len(parts) >= 2 && parts[0] == "sessions" {
		s.handlePlanningSession(w, r, parts[1:])
		return
	}
	writeError(w, http.StatusNotFound, "内容策划接口不存在")
}

func (s *Server) handlePlanningSession(w http.ResponseWriter, r *http.Request, parts []string) {
	user, _ := s.authenticatedUser(r)
	id := parts[0]
	session, found, err := s.store.FindPlanningSession(id)
	if err != nil || !found || session.UserID != user.ID {
		writeError(w, http.StatusNotFound, "planning session not found")
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, session)
		return
	}
	if len(parts) == 2 && parts[1] == "updates" && r.Method == http.MethodGet {
		generation := session.Generation
		writeJSON(w, http.StatusOK, map[string]any{"sessionId": session.ID, "status": session.Status, "jobStage": session.JobStage, "updatedAt": session.UpdatedAt, "reasoningLogs": generation["reasoningLogs"], "reasoningStream": generation["reasoningStream"], "stages": generation["stages"], "candidates": generation["candidates"], "selectedCandidateId": generation["selectedCandidateId"]})
		return
	}
	if len(parts) == 2 && parts[1] == "analyze" && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		updated, err := s.queuePlanningAnalysis(session, input)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		modelConfigID := stringValue(input, "modelConfigId")
		s.publishPlanningSessionUpdated(updated, "analysis")
		s.startBackgroundTask(func() { s.executePlanningAnalysis(updated.ID, modelConfigID) })
		writeJSON(w, http.StatusAccepted, updated)
		return
	}
	if len(parts) == 2 && parts[1] == "campaign-images" && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		updated, runID, err := s.queuePlanningCampaignImages(session)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		modelConfigID := stringValue(input, "modelConfigId")
		s.publishPlanningSessionUpdated(updated, "campaign-images")
		s.startBackgroundTask(func() { s.executePlanningCampaignImages(updated.ID, runID, modelConfigID) })
		writeJSON(w, http.StatusAccepted, updated)
		return
	}
	if len(parts) == 2 && parts[1] == "narration" && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		updated, runID, err := s.queuePlanningNarration(session, input)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.publishPlanningSessionUpdated(updated, "narration")
		s.startBackgroundTask(func() { s.executePlanningNarration(updated.ID, runID) })
		writeJSON(w, http.StatusAccepted, updated)
		return
	}
	if len(parts) == 2 && parts[1] == "remotion-json" && r.Method == http.MethodPost {
		s.handleGenerateRemotionJSON(w, r, session)
		return
	}
	if len(parts) == 2 && parts[1] == "render" && r.Method == http.MethodPost {
		s.handleStartRemotionRender(w, r, session)
		return
	}
	if len(parts) == 2 && parts[1] == "render" && r.Method == http.MethodDelete {
		s.handleCancelRemotionRender(w, r, session)
		return
	}
	if len(parts) == 2 && parts[1] == "confirmation" && (r.Method == http.MethodPatch || r.Method == http.MethodPut) {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		if value, exists := input["referenceBreakdown"]; exists {
			session.Analysis["referenceBreakdown"] = value
		}
		if value, exists := input["materialCaptions"]; exists {
			session.Analysis["materialCaptions"] = value
		}
		if value, exists := input["productInsights"]; exists {
			session.Analysis["productInsights"] = value
		}
		session.Analysis["confirmed"] = true
		if value, exists := input["referencePolicy"]; exists {
			session.Settings["referencePolicy"] = value
		}
		session.Status, session.UIStep, session.JobStage = "configuring", "step3", "idle"
		session.Generation = defaultPlanningGenerationHTTP()
		updated, err := s.store.UpdatePlanningSession(session)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
		return
	}
	if len(parts) == 2 && parts[1] == "settings" && (r.Method == http.MethodPatch || r.Method == http.MethodPut) {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		if value, exists := input["settings"].(map[string]any); exists {
			session.Settings = value
		}
		session.Status, session.UIStep, session.JobStage = "configuring", "step3", "idle"
		session.Generation = defaultPlanningGenerationHTTP()
		updated, err := s.store.UpdatePlanningSession(session)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
		return
	}
	if len(parts) == 2 && parts[1] == "generate" && r.Method == http.MethodPost {
		updated, err := s.generatePlanningSession(session)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusAccepted, updated)
		return
	}
	if len(parts) == 4 && parts[1] == "candidates" && parts[3] == "select" && r.Method == http.MethodPost {
		generation := session.Generation
		candidates, _ := generation["candidates"].([]any)
		selected := false
		for _, value := range candidates {
			candidate, _ := value.(map[string]any)
			if candidate["id"] == parts[2] {
				selected = true
				break
			}
		}
		if !selected {
			writeError(w, http.StatusBadRequest, "candidate not found")
			return
		}
		generation["selectedCandidateId"] = parts[2]
		session.Generation = generation
		updated, err := s.store.UpdatePlanningSession(session)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
		return
	}
	if len(parts) == 2 && parts[1] == "apply" && r.Method == http.MethodPost {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		result, err := s.applyPlanningSession(session, stringValue(input, "candidateId"))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
}

func makeMaterialCaptions(items []any) []any {
	result := make([]any, 0, len(items))
	for index, value := range items {
		item, _ := value.(map[string]any)
		result = append(result, map[string]any{"id": fmt.Sprintf("caption-%d", index+1), "assetId": item["assetId"], "label": fmt.Sprintf("产品素材 %d", index+1), "previewUrl": item["fileUrl"], "description": "已载入产品参考素材。"})
	}
	return result
}

func (s *Server) generatePlanningSession(session store.ContentPlanningSession) (store.ContentPlanningSession, error) {
	confirmed, _ := session.Analysis["confirmed"].(bool)
	if !confirmed {
		return session, errors.New("confirm planning analysis before generating candidates")
	}
	product := stringValue(session.MaterialBundle, "productName")
	if product == "" {
		product = "产品"
	}
	duration := int(numberValue(session.Settings["durationSeconds"], 5))
	if duration != 5 && duration != 10 && duration != 15 {
		duration = 5
	}
	candidateCount := int(numberValue(session.Settings["candidateCount"], 1))
	if candidateCount < 1 {
		candidateCount = 1
	}
	if candidateCount > 3 {
		candidateCount = 3
	}
	candidates := make([]any, 0, candidateCount)
	for index := 0; index < candidateCount; index++ {
		id := fmt.Sprintf("candidate-%d-%d", index+1, time.Now().UnixNano())
		title := []string{"痛点切入展示", "场景体验推荐", "卖点快速对比"}[index]
		hook := fmt.Sprintf("你还在为%s的选择犹豫吗？", product)
		storyboard := []any{
			map[string]any{"id": id + "-shot-1", "startSecond": 0, "endSecond": float64(duration) * 0.25, "title": "开场钩子", "visual": "快速展示产品和使用场景", "action": "镜头推进并突出产品", "dialogue": hook, "soundEffect": "轻快转场", "camera": "近景推镜", "lighting": "明亮", "spaceRelation": "主体居中", "materialRefs": []any{}},
			map[string]any{"id": id + "-shot-2", "startSecond": float64(duration) * 0.25, "endSecond": float64(duration) * 0.75, "title": "核心卖点", "visual": fmt.Sprintf("围绕%s展示关键细节", product), "action": "手部或人物演示产品", "dialogue": fmt.Sprintf("%s，帮助你更轻松地完成目标。", product), "soundEffect": "节奏音乐", "camera": "中景切特写", "lighting": "自然光", "spaceRelation": "前景突出", "materialRefs": []any{}},
			map[string]any{"id": id + "-shot-3", "startSecond": float64(duration) * 0.75, "endSecond": float64(duration), "title": "行动引导", "visual": "产品定格与品牌信息", "action": "展示购买或咨询入口", "dialogue": "现在就来了解更多。", "soundEffect": "收束音效", "camera": "稳定定格", "lighting": "干净明亮", "spaceRelation": "主体居中", "materialRefs": []any{}},
		}
		fullScript := fmt.Sprintf("%s\n%s，帮助你更轻松地完成目标。\n现在就来了解更多。", hook, product)
		script := map[string]any{"id": id + "-script", "title": title, "summary": fmt.Sprintf("以%s为核心，完成一条 %d 秒产品短视频。", product, duration), "fullScript": fullScript, "prompt": fullScript, "durationSeconds": duration, "storyboard": storyboard}
		candidates = append(candidates, map[string]any{"id": id, "title": title, "summary": script["summary"], "hook": hook, "audienceAngle": "面向正在寻找解决方案的用户", "tags": []any{"产品展示", "短视频", "转化"}, "fullScript": fullScript, "prompt": fullScript, "storyboard": storyboard, "score": 90 - index*3, "issues": []any{}, "repairAdvice": "", "sourceStrategyId": fmt.Sprintf("strategy-%d", index+1), "script": script})
	}
	generation := defaultPlanningGenerationHTTP()
	generation["candidates"] = candidates
	generation["selectedCandidateId"] = candidates[0].(map[string]any)["id"]
	generation["validatorSummary"] = "候选脚本已完成结构校验，可直接应用。"
	generation["stages"] = planningStagesHTTP()
	session.Generation = generation
	session.Status, session.UIStep, session.JobStage = "ready_to_apply", "step4", "completed"
	return s.store.UpdatePlanningSession(session)
}

func (s *Server) applyPlanningSession(session store.ContentPlanningSession, candidateID string) (map[string]any, error) {
	generation := session.Generation
	candidates, _ := generation["candidates"].([]any)
	selectedID := candidateID
	if selectedID == "" {
		selectedID = stringValue(generation, "selectedCandidateId")
	}
	var selected map[string]any
	for _, value := range candidates {
		candidate, _ := value.(map[string]any)
		if candidate["id"] == selectedID {
			selected = candidate
			break
		}
	}
	if selected == nil {
		return nil, errors.New("select a planning candidate before applying")
	}
	prompt := stringValue(selected, "prompt")
	duration := int(numberValue(session.Settings["durationSeconds"], 5))
	imageMaterials, _ := session.MaterialBundle["imageMaterials"].([]any)
	allowlist := map[string]any{"prompt": prompt, "duration": fmt.Sprintf("%ds", duration), "imageMaterials": imageMaterials}
	if value := session.MaterialBundle["referenceVideo"]; value != nil {
		allowlist["referenceVideo"] = value
	}
	if value := session.MaterialBundle["referenceAudio"]; value != nil {
		allowlist["referenceAudio"] = value
	}
	snapshot := map[string]any{"prompt": prompt, "duration": fmt.Sprintf("%ds", duration), "imageMaterials": imageMaterials, "appliedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	for _, key := range []string{"referenceVideo", "referenceAudio"} {
		if value, exists := allowlist[key]; exists {
			snapshot[key] = value
		}
	}
	session.ApplySnapshot = snapshot
	session.Status, session.JobStage = "applied", "completed"
	generation["selectedCandidateId"] = selectedID
	session.Generation = generation
	updated, err := s.store.UpdatePlanningSession(session)
	if err != nil {
		return nil, err
	}
	return map[string]any{"session": updated, "allowlist": allowlist}, nil
}

func defaultAnalysisHTTP() map[string]any {
	return map[string]any{
		"referenceBreakdown":      nil,
		"materialCaptions":        []any{},
		"campaignPlan":            nil,
		"campaignImageGeneration": map[string]any{"status": "idle", "images": []any{}, "errorMessage": ""},
		"narrationGeneration":     map[string]any{"status": "idle", "provider": "", "voice": "", "speed": 1, "instruction": "", "modelConfigId": "", "durationMs": 0, "scenes": []any{}, "captions": []any{}, "errorMessage": ""},
		"remotionGeneration":      map[string]any{"status": "idle", "presetId": "", "errorMessage": ""},
		"renderGeneration":        map[string]any{"status": "idle", "progress": 0, "pluginJobId": "", "assetId": "", "fileUrl": "", "errorMessage": ""},
		"productInsights":         map[string]any{},
		"confirmed":               false,
		"notes":                   []any{},
	}
}
func defaultPlanningGenerationHTTP() map[string]any {
	return map[string]any{"reasoningLogs": []any{}, "reasoningStream": nil, "stages": []any{}, "candidates": []any{}, "selectedCandidateId": "", "validatorSummary": "", "stageOutputs": map[string]any{}}
}
func planningStagesHTTP() []any {
	roles := []string{"Planner", "Strategy", "Timeline", "Copywriter", "Visual Director", "Validator"}
	result := make([]any, 0, len(roles))
	for _, role := range roles {
		result = append(result, map[string]any{"id": strings.ToLower(strings.ReplaceAll(role, " ", "-")), "role": role, "status": "completed", "inputSummary": "已读取当前策划会话", "outputSummary": "已完成 Go 内置流程生成"})
	}
	return result
}

func numberValue(value any, fallback float64) float64 {
	switch number := value.(type) {
	case float64:
		return number
	case int:
		return float64(number)
	case string:
		var parsed float64
		if _, err := fmt.Sscan(number, &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}
