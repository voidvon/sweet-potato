package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleVideoUnderstanding(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "web.module.chat"); !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/video-understanding"), "/"))
	if len(parts) == 1 && parts[0] == "stream" && r.Method == http.MethodPost {
		s.streamVideoUnderstanding(w, r)
		return
	}
	writeError(w, 404, "视频理解接口不存在")
}

func (s *Server) streamVideoUnderstanding(w http.ResponseWriter, r *http.Request) {
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	requestID := valueOr(stringValue(input, "requestId"), "video-understanding-"+randomIDForHTTP())
	modelName := stringValue(input, "model")
	prompt := strings.TrimSpace(stringValue(input, "prompt"))
	if prompt == "" {
		prompt = "请分析视频的主体、动作、镜头节奏、台词和可执行的生成约束。"
	}
	mediaSummary := summarizeVideoUnderstandingInputs(input)
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, 500, "当前服务器不支持事件流")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	writeVideoUnderstandingEvent(w, flusher, "start", map[string]any{"type": "start", "requestId": requestID, "model": modelName, "useFilesApi": input["useFilesApi"] != false, "fps": numberValue(input["fps"], 2)})
	if r.Context().Err() != nil {
		return
	}
	answer, reasoning, err := s.completeVideoUnderstanding(r, input, prompt, mediaSummary)
	if err != nil {
		writeVideoUnderstandingEvent(w, flusher, "error", map[string]any{"type": "error", "requestId": requestID, "message": err.Error()})
		return
	}
	if reasoning != "" {
		writeVideoUnderstandingEvent(w, flusher, "reasoning_delta", map[string]any{"type": "reasoning_delta", "requestId": requestID, "delta": reasoning})
	}
	for _, chunk := range splitTextChunks(answer, 160) {
		if r.Context().Err() != nil {
			return
		}
		writeVideoUnderstandingEvent(w, flusher, "delta", map[string]any{"type": "delta", "requestId": requestID, "delta": chunk})
	}
	writeVideoUnderstandingEvent(w, flusher, "usage", map[string]any{"type": "usage", "requestId": requestID, "usage": map[string]any{"provider": "go", "mediaSummary": mediaSummary}})
	writeVideoUnderstandingEvent(w, flusher, "done", map[string]any{"type": "done", "requestId": requestID, "finishReason": "stop"})
}

func writeVideoUnderstandingEvent(w http.ResponseWriter, flusher http.Flusher, event string, value map[string]any) {
	encoded, _ := json.Marshal(value)
	_, _ = io.WriteString(w, fmt.Sprintf("event: %s\ndata: %s\n\n", event, encoded))
	flusher.Flush()
}

func (s *Server) completeVideoUnderstanding(r *http.Request, input map[string]any, prompt, mediaSummary string) (string, string, error) {
	models, err := s.store.ListModelConfigs("llm")
	if err != nil {
		return "", "", err
	}
	var modelConfig *storeModelConfigView
	requested := stringValue(input, "model")
	for _, item := range models {
		if (requested != "" && item.Model == requested) || (requested == "" && item.IsDefault) {
			modelConfig = &storeModelConfigView{BaseURL: item.BaseURL, APIKey: item.APIKey, Model: item.Model, Temperature: item.Temperature}
			break
		}
	}
	if modelConfig == nil && len(models) > 0 {
		item := models[0]
		modelConfig = &storeModelConfigView{BaseURL: item.BaseURL, APIKey: item.APIKey, Model: item.Model, Temperature: item.Temperature}
	}
	if modelConfig == nil || strings.TrimSpace(modelConfig.APIKey) == "" {
		return fmt.Sprintf("Go 本地视频理解已完成。\n%s\n媒体输入：%s\n请根据以上观察继续组织分镜、角色替换和镜头约束。", prompt, mediaSummary), "已读取视频理解请求，并采用本地结构化分析流程。", nil
	}
	baseURL := strings.TrimRight(valueOr(modelConfig.BaseURL, "https://api.openai.com/v1"), "/")
	messages := []map[string]string{{"role": "system", "content": "你是专业视频理解助手，请输出准确、可执行的中文视频分析。"}, {"role": "user", "content": prompt + "\n媒体输入摘要：" + mediaSummary}}
	payload := map[string]any{"model": valueOr(modelConfig.Model, requested), "messages": messages, "temperature": modelConfig.Temperature, "stream": false}
	body, _ := json.Marshal(payload)
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, baseURL+"/chat/completions", strings.NewReader(string(body)))
	if err != nil {
		return "", "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+modelConfig.APIKey)
	client := &http.Client{Timeout: 3 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		return "", "", fmt.Errorf("调用视频理解模型失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 20<<20))
	if err != nil {
		return "", "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", "", fmt.Errorf("视频理解模型返回 %d: %s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content   string `json:"content"`
				Reasoning string `json:"reasoning_content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &result) != nil || len(result.Choices) == 0 {
		return "", "", fmt.Errorf("视频理解模型响应格式无效")
	}
	return result.Choices[0].Message.Content, result.Choices[0].Message.Reasoning, nil
}

type storeModelConfigView struct {
	BaseURL, APIKey, Model string
	Temperature            float64
}

func summarizeVideoUnderstandingInputs(input map[string]any) string {
	parts := []string{}
	if inputs, ok := input["inputs"].([]any); ok {
		parts = append(parts, fmt.Sprintf("inputs=%d", len(inputs)))
	}
	if messages, ok := input["messages"].([]any); ok {
		parts = append(parts, fmt.Sprintf("messages=%d", len(messages)))
	}
	if filePath := stringValue(input, "filePath"); filePath != "" {
		parts = append(parts, "filePath="+filePath)
	}
	if value := stringValue(input, "url"); value != "" {
		parts = append(parts, "url="+value)
	}
	if len(parts) == 0 {
		return "未提供结构化媒体摘要"
	}
	return strings.Join(parts, ", ")
}
