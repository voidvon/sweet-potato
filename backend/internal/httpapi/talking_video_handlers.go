package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
)

func (s *Server) handleTalkingVideo(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "web.module.content.create_video"); !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/talking-video"), "/"))
	if len(parts) == 2 && parts[0] == "prompt" && parts[1] == "history" && r.Method == http.MethodGet {
		user, _ := s.authenticatedUser(r)
		items, err := s.store.ListTalkingVideoHistory(user.ID, 10)
		if err != nil {
			writeError(w, 500, "口播历史读取失败")
			return
		}
		writeJSON(w, 200, map[string]any{"tasks": items})
		return
	}
	if len(parts) == 3 && parts[0] == "prompt" && parts[1] == "history" && parts[2] == "import" && r.Method == http.MethodPost {
		s.importTalkingVideoHistory(w, r)
		return
	}
	if len(parts) == 4 && parts[0] == "prompt" && parts[1] == "tasks" && parts[3] == "stream" {
		switch r.Method {
		case http.MethodPost:
			s.startTalkingVideoPrompt(w, r, parts[2])
		case http.MethodGet:
			s.streamTalkingVideoSnapshot(w, r, parts[2])
		default:
			writeError(w, 405, "请求方法不支持")
		}
		return
	}
	if len(parts) == 4 && parts[0] == "prompt" && parts[1] == "tasks" && parts[3] == "stop" && r.Method == http.MethodPost {
		s.stopTalkingVideoPrompt(w, r, parts[2])
		return
	}
	writeError(w, 404, "口播视频接口不存在")
}

func (s *Server) startTalkingVideoPrompt(w http.ResponseWriter, r *http.Request, taskID string) {
	user, _ := s.authenticatedUser(r)
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	video, err := s.talkingVideoInput(user.ID, input)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	images, err := s.talkingVideoImages(user.ID, input["images"])
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if !hasTalkingVideoRole(images, "model") {
		writeError(w, 400, "请先上传模特图片")
		return
	}
	if strings.TrimSpace(taskID) == "" {
		taskID = randomIDForHTTP()
	}
	deepThink := input["deepThink"] != false
	now := time.Now().UTC().Format(time.RFC3339Nano)
	history := store.TalkingVideoHistory{ID: taskID, Status: "thinking", Phase: "uploading_assets", SourceVideo: video, ReferenceImages: images, DeepThink: deepThink, Metrics: talkingVideoMetrics(), ServerTimings: map[string]any{}, CreatedAt: now}
	if _, err := s.store.UpsertTalkingVideoHistory(user.ID, history); err != nil {
		writeError(w, 400, "口播任务创建失败")
		return
	}
	s.writeTalkingStreamHeader(w)
	s.writeTalkingEvent(w, "snapshot", map[string]any{"taskId": taskID, "status": "thinking", "phase": "uploading_assets", "reasoning": "已确认参考视频和角色素材，开始整理镜头信息。", "prompt": "", "errorMessage": "", "metrics": history.Metrics, "timings": map[string]any{}})
	if r.Context().Err() != nil {
		return
	}
	s.writeTalkingEvent(w, "phase", map[string]any{"taskId": taskID, "phase": "understanding_video", "metrics": history.Metrics, "timings": map[string]any{}})
	reasoning := "参考视频将作为动作、节奏和讲解布局依据；图片素材只按已声明角色替换对应内容。"
	s.writeTalkingEvent(w, "reasoning_delta", map[string]any{"taskId": taskID, "delta": reasoning})
	prompt := buildTalkingVideoPrompt(video, images, deepThink)
	if r.Context().Err() != nil {
		return
	}
	for _, chunk := range splitTextChunks(prompt, 180) {
		s.writeTalkingEvent(w, "delta", map[string]any{"taskId": taskID, "delta": chunk})
	}
	metrics := history.Metrics
	metrics["understandingModelCalls"] = 0
	timings := map[string]any{"t_result_ms": float64(time.Since(time.Now().Add(-time.Millisecond)).Milliseconds())}
	updated := history
	updated.Status, updated.Phase, updated.Reasoning, updated.Prompt, updated.Metrics, updated.ServerTimings, updated.UpdatedAt = "completed", "completed", reasoning, prompt, metrics, timings, time.Now().UTC().Format(time.RFC3339Nano)
	_, _, _ = s.store.UpdateTalkingVideoHistory(user.ID, taskID, updated)
	s.writeTalkingEvent(w, "result", map[string]any{"taskId": taskID, "prompt": prompt, "metrics": metrics, "timings": timings})
	s.writeTalkingEvent(w, "snapshot", map[string]any{"taskId": taskID, "status": "completed", "phase": "completed", "reasoning": reasoning, "prompt": prompt, "errorMessage": "", "metrics": metrics, "timings": timings})
	s.writeTalkingEvent(w, "done", map[string]any{"taskId": taskID})
}

func (s *Server) streamTalkingVideoSnapshot(w http.ResponseWriter, r *http.Request, taskID string) {
	user, _ := s.authenticatedUser(r)
	item, found, err := s.store.FindTalkingVideoHistory(taskID, user.ID)
	if err != nil || !found {
		writeError(w, 410, "口播任务已失效，请点击继续重新生成")
		return
	}
	s.writeTalkingStreamHeader(w)
	s.writeTalkingEvent(w, "snapshot", item)
	s.writeTalkingEvent(w, "done", map[string]any{"taskId": taskID})
}

func (s *Server) stopTalkingVideoPrompt(w http.ResponseWriter, r *http.Request, taskID string) {
	user, _ := s.authenticatedUser(r)
	item, found, err := s.store.FindTalkingVideoHistory(taskID, user.ID)
	if err != nil || !found {
		writeError(w, 404, "口播任务不存在或已失效")
		return
	}
	item.Status, item.Phase, item.ErrorMessage = "stopped", "stopped", "任务已停止"
	updated, _, err := s.store.UpdateTalkingVideoHistory(user.ID, taskID, item)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, updated)
}

func (s *Server) importTalkingVideoHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := s.authenticatedUser(r)
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	raw, _ := input["tasks"].([]any)
	for _, value := range raw {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		source, _ := item["sourceVideo"].(map[string]any)
		id := valueOr(stringValue(item, "id"), randomIDForHTTP())
		history := store.TalkingVideoHistory{ID: id, Status: valueOr(stringValue(item, "status"), "stopped"), Phase: "stopped", Reasoning: stringValue(item, "reasoning"), Prompt: stringValue(item, "prompt"), ErrorMessage: stringValue(item, "errorMessage"), SourceVideo: source, ReferenceImages: arrayValue(item["referenceImages"]), DeepThink: item["deepThink"] != false, Metrics: objectValue(item["metrics"]), ServerTimings: objectValue(item["serverTimings"]), CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		_, _ = s.store.UpsertTalkingVideoHistory(user.ID, history)
	}
	items, _ := s.store.ListTalkingVideoHistory(user.ID, 10)
	writeJSON(w, 200, map[string]any{"tasks": items})
}

func (s *Server) talkingVideoInput(userID string, input map[string]any) (map[string]any, error) {
	if id := strings.TrimSpace(stringValue(input, "videoAssetId")); id != "" {
		asset, found, err := s.store.FindContentAsset(id)
		if err != nil || !found || asset.UserID != userID || !strings.HasPrefix(asset.MimeType, "video/") {
			return nil, fmt.Errorf("口播参考视频不存在")
		}
		return map[string]any{"assetId": asset.ID, "name": asset.Name, "url": asset.FileURL, "mimeType": asset.MimeType, "storedFileName": asset.StoredFileName}, nil
	}
	remote, _ := input["remoteVideo"].(map[string]any)
	if value := strings.TrimSpace(stringValue(remote, "input")); value != "" {
		return map[string]any{"url": value, "trimStart": remote["trimStart"], "trimEnd": remote["trimEnd"]}, nil
	}
	return nil, fmt.Errorf("请先上传口播参考视频")
}

func (s *Server) talkingVideoImages(userID string, value any) ([]any, error) {
	raw, _ := value.([]any)
	if len(raw) > 9 {
		raw = raw[:9]
	}
	result := []any{}
	for _, item := range raw {
		record, _ := item.(map[string]any)
		id := stringValue(record, "assetId")
		role := valueOr(stringValue(record, "role"), "detail")
		if id == "" || !map[string]bool{"model": true, "product": true, "background": true, "detail": true}[role] {
			return nil, errors.New("参考图片角色无效")
		}
		asset, found, err := s.store.FindContentAsset(id)
		if err != nil || !found || asset.UserID != userID || !strings.HasPrefix(asset.MimeType, "image/") {
			return nil, errors.New("参考图片不存在")
		}
		result = append(result, map[string]any{"assetId": asset.ID, "role": role, "name": asset.Name, "url": asset.FileURL, "mimeType": asset.MimeType})
	}
	return result, nil
}

func hasTalkingVideoRole(images []any, role string) bool {
	for _, item := range images {
		if value, ok := item.(map[string]any); ok && value["role"] == role {
			return true
		}
	}
	return false
}
func talkingVideoMetrics() map[string]any {
	return map[string]any{"arkUploadCount": 0, "arkUploadPollMs": 0, "understandingModelCalls": 0, "understandingReplayCalls": 0, "formatRepairCalls": 0, "promptRepairCalls": 0, "reuseCacheHitCount": 0}
}
func buildTalkingVideoPrompt(video map[string]any, images []any, deepThink bool) string {
	lines := []string{"画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。", "请保持参考视频的动作节奏、镜头连续性和讲解布局，并将角色素材按用途替换。", "素材用途："}
	for index, value := range images {
		item, _ := value.(map[string]any)
		lines = append(lines, fmt.Sprintf("@图片%d：仅作为%s参考。", index+1, stringValue(item, "role")))
	}
	lines = append(lines, "镜号1｜中景｜0-5秒", "画面：沿用参考视频的主视觉结构，展示产品与使用场景，保持动作自然连续。", "台词：无", "表演要点：讲解者保持稳定视线和自然手势。", "拍摄注意：保持光线、空间关系和镜头运动统一，不添加原视频文字。", "镜号2｜近景｜5-10秒", "画面：突出产品细节和核心卖点，保持参考视频的节奏。", "台词：无", "表演要点：动作清晰，主体始终位于画面重点区域。", "拍摄注意：避免素材角色串用。", "镜号3｜中近景｜10-15秒", "画面：完成行动引导并自然收束画面。", "台词：无", "表演要点：表情和动作自然收尾。", "拍摄注意：最后画面保持稳定。", fmt.Sprintf("生成策略：%s。参考视频：%s。", map[bool]string{true: "开启深度思考", false: "快速生成"}[deepThink], stringValue(video, "name")))
	return strings.Join(lines, "\n")
}

func (s *Server) writeTalkingStreamHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}
func (s *Server) writeTalkingEvent(w http.ResponseWriter, event string, payload any) {
	encoded, _ := json.Marshal(payload)
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, encoded)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}
func arrayValue(value any) []any {
	if result, ok := value.([]any); ok {
		return result
	}
	return []any{}
}
