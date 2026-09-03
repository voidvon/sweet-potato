package audio

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Client struct {
	HTTPClient *http.Client
	BaseURL    string
	APIKey     string
	Provider   string
	Model      string
}

type SpeechInput struct {
	Voice       string
	Text        string
	Speed       float64
	Instruction string
}

type Output struct {
	Bytes        []byte
	MimeType     string
	SpeedApplied bool
}

func (c Client) Synthesize(ctx context.Context, input SpeechInput) (Output, error) {
	if strings.TrimSpace(c.APIKey) == "" {
		return Output{}, errors.New("音频模型 API Key 未配置")
	}
	if strings.TrimSpace(c.Model) == "" {
		return Output{}, errors.New("音频模型名称未配置")
	}
	if strings.TrimSpace(input.Text) == "" {
		return Output{}, errors.New("旁白文本不能为空")
	}
	if strings.TrimSpace(input.Voice) == "" {
		return Output{}, errors.New("音色不能为空")
	}
	if input.Speed <= 0 {
		input.Speed = 1
	}
	if strings.TrimSpace(c.BaseURL) == "" {
		return Output{}, errors.New("音频模型 Base URL 未配置")
	}
	if c.isMiMo() {
		return c.synthesizeMiMo(ctx, input)
	}
	return c.synthesizeSpeech(ctx, input)
}

func (c Client) isMiMo() bool {
	value := strings.ToLower(strings.TrimSpace(c.Provider + " " + c.BaseURL + " " + c.Model))
	return strings.Contains(value, "mimo") || strings.Contains(value, "xiaomimimo")
}

func (c Client) synthesizeSpeech(ctx context.Context, input SpeechInput) (Output, error) {
	body := map[string]any{
		"model":           c.Model,
		"input":           input.Text,
		"voice":           input.Voice,
		"response_format": "wav",
		"speed":           input.Speed,
	}
	if strings.TrimSpace(input.Instruction) != "" {
		body["instructions"] = strings.TrimSpace(input.Instruction)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return Output{}, fmt.Errorf("编码语音请求失败: %w", err)
	}
	output, err := c.do(ctx, http.MethodPost, "audio/speech", encoded, false)
	output.SpeedApplied = err == nil
	return output, err
}

func (c Client) synthesizeMiMo(ctx context.Context, input SpeechInput) (Output, error) {
	instruction := strings.TrimSpace(input.Instruction)
	if instruction == "" {
		instruction = "用自然、专业、适合营销视频的语气朗读，发音清晰。"
	}
	instruction = strings.TrimSpace(instruction + " " + mimoSpeedInstruction(input.Speed))
	text := mimoSpeedTaggedText(input.Text, input.Speed)
	body := map[string]any{
		"model": c.Model,
		"messages": []map[string]string{
			{"role": "user", "content": instruction},
			{"role": "assistant", "content": text},
		},
		"audio": map[string]string{"format": "wav", "voice": input.Voice},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return Output{}, fmt.Errorf("编码 MiMo 语音请求失败: %w", err)
	}
	output, err := c.do(ctx, http.MethodPost, "chat/completions", encoded, true)
	output.SpeedApplied = err == nil
	return output, err
}

func mimoSpeedInstruction(speed float64) string {
	switch {
	case speed >= 1.8:
		return fmt.Sprintf("使用快速、紧凑且连贯的节奏，语速约为日常语速的 %.1f 倍，明显减少停顿。", speed)
	case speed > 1.1:
		return fmt.Sprintf("使用明显偏快、紧凑且连贯的节奏，语速约为日常语速的 %.1f 倍，减少不必要的停顿。", speed)
	case speed <= 0.7:
		return fmt.Sprintf("使用明显舒缓、从容的节奏，语速约为日常语速的 %.1f 倍。", speed)
	case speed < 0.9:
		return fmt.Sprintf("使用稍慢、清晰且从容的节奏，语速约为日常语速的 %.1f 倍。", speed)
	default:
		return "使用自然适中的语速和停顿。"
	}
}

func mimoSpeedTaggedText(text string, speed float64) string {
	switch {
	case speed > 1.1:
		return "(变快)" + text
	case speed < 0.9:
		return "(放慢)" + text
	default:
		return text
	}
}

func (c Client) do(ctx context.Context, method, path string, body []byte, expectBase64 bool) (Output, error) {
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+"/"+strings.TrimLeft(path, "/"), bytes.NewReader(body))
	if err != nil {
		return Output{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(c.APIKey))
	request.Header.Set("api-key", strings.TrimSpace(c.APIKey))
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return Output{}, fmt.Errorf("请求语音模型失败: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		return Output{}, fmt.Errorf("读取语音模型响应失败: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Output{}, fmt.Errorf("语音模型请求失败（%d）：%s", response.StatusCode, responseError(data))
	}
	contentType := strings.ToLower(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if expectBase64 || strings.Contains(contentType, "json") || looksLikeJSON(data) {
		decoded, err := decodeAudioJSON(data)
		if err != nil {
			return Output{}, err
		}
		return Output{Bytes: decoded, MimeType: "audio/wav"}, nil
	}
	if len(data) == 0 {
		return Output{}, errors.New("语音模型返回了空音频")
	}
	return Output{Bytes: data, MimeType: valueOr(contentType, "audio/wav")}, nil
}

func decodeAudioJSON(data []byte) ([]byte, error) {
	var payload any
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("解析语音模型响应失败: %w", err)
	}
	value := findBase64Value(payload)
	if value == "" {
		return nil, errors.New("语音模型响应中没有音频数据")
	}
	comma := strings.Index(value, ",")
	if strings.HasPrefix(value, "data:") && comma >= 0 {
		value = value[comma+1:]
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(decoded) == 0 {
		return nil, errors.New("语音模型返回的音频数据无效")
	}
	return decoded, nil
}

func findBase64Value(value any) string {
	switch current := value.(type) {
	case string:
		return strings.TrimSpace(current)
	case []any:
		for _, item := range current {
			if found := findBase64Value(item); found != "" {
				return found
			}
		}
	case map[string]any:
		for _, key := range []string{"data", "b64_json", "audio", "content", "choices", "message"} {
			if item, ok := current[key]; ok {
				if found := findBase64Value(item); found != "" {
					return found
				}
			}
		}
		for key, item := range current {
			if key == "data" || key == "b64_json" || key == "audio" || key == "content" || key == "choices" || key == "message" {
				continue
			}
			if found := findBase64Value(item); found != "" {
				return found
			}
		}
	}
	return ""
}

func responseError(data []byte) string {
	var payload map[string]any
	if json.Unmarshal(data, &payload) == nil {
		if value, ok := payload["error"].(map[string]any); ok {
			message, _ := value["message"].(string)
			param, _ := value["param"].(string)
			message = strings.TrimSpace(message)
			param = strings.TrimSpace(param)
			if message != "" && param != "" && !strings.Contains(message, param) {
				return fmt.Sprintf("%s: %s", message, param)
			}
			if message != "" {
				return message
			}
			if param != "" {
				return param
			}
		}
		message, _ := payload["message"].(string)
		if strings.TrimSpace(message) != "" {
			return strings.TrimSpace(message)
		}
	}
	message := strings.TrimSpace(string(data))
	if len(message) > 500 {
		message = message[:500]
	}
	return valueOr(message, "未知错误")
}

func looksLikeJSON(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	return len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[')
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
