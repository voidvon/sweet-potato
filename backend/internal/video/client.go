package video

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ai-marketing-go/internal/store"
)

type Client struct {
	HTTPClient *http.Client
	BaseURL    string
	APIKey     string
	Provider   string
	Model      string
	PublicBase string
}

type GenerateInput struct {
	TaskID        string
	Prompt        string
	Ratio         string
	Quality       string
	Duration      string
	GenerateAudio bool
	Images        []store.ContentAsset
	Videos        []store.ContentAsset
	Audios        []store.ContentAsset
	RemoteVideo   string
}

type Result struct {
	Provider string
	Model    string
	JobID    string
	VideoURL string
	CoverURL string
	Raw      map[string]any
}

func (c Client) Generate(ctx context.Context, input GenerateInput) (Result, error) {
	if strings.TrimSpace(c.APIKey) == "" {
		return Result{}, errors.New("视频模型未配置 API Key")
	}
	if strings.TrimSpace(c.Model) == "" {
		return Result{}, errors.New("视频模型未配置模型名称")
	}
	requestURL := generationURL(c.BaseURL, c.Provider, c.Model)
	seedance := isSeedance(c.BaseURL, c.Provider, c.Model)
	body, err := c.requestBody(input, seedance)
	if err != nil {
		return Result{}, err
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return Result{}, fmt.Errorf("编码视频请求失败: %w", err)
	}
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, strings.NewReader(string(encoded)))
	if err != nil {
		return Result{}, err
	}
	request.Header.Set("Authorization", "Bearer "+c.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return Result{}, fmt.Errorf("调用视频模型失败: %w", err)
	}
	defer response.Body.Close()
	record, err := decodeResponse(response)
	if err != nil {
		return Result{}, err
	}
	result := parseResult(record, c.Provider, c.Model)
	if result.VideoURL != "" || result.JobID == "" {
		if result.VideoURL == "" {
			return Result{}, errors.New("视频模型响应中没有任务 ID 或视频地址")
		}
		return result, nil
	}
	return c.poll(ctx, result)
}

func (c Client) poll(ctx context.Context, result Result) (Result, error) {
	queryURL := taskURL(c.BaseURL, c.Provider, c.Model, result.JobID)
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	interval := 2 * time.Second
	deadline := time.Now().Add(10 * time.Minute)
	for time.Now().Before(deadline) {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL, nil)
		if err != nil {
			return Result{}, err
		}
		request.Header.Set("Authorization", "Bearer "+c.APIKey)
		response, err := client.Do(request)
		if err != nil {
			return Result{}, fmt.Errorf("查询视频任务失败: %w", err)
		}
		record, decodeErr := decodeResponse(response)
		_ = response.Body.Close()
		if decodeErr != nil {
			return Result{}, decodeErr
		}
		current := parseResult(record, c.Provider, c.Model)
		if current.JobID == "" {
			current.JobID = result.JobID
		}
		if current.VideoURL != "" {
			return current, nil
		}
		status := strings.ToLower(stringValue(record, "status"))
		if isFailedStatus(status) {
			return Result{}, fmt.Errorf("视频模型任务失败: %s", valueOr(stringValue(record, "message"), status))
		}
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-time.After(interval):
		}
		if interval < 10*time.Second {
			interval += time.Second
		}
	}
	return Result{}, errors.New("视频模型任务查询超时")
}

func (c Client) Download(ctx context.Context, rawURL, outputPath string) (int64, error) {
	if strings.HasPrefix(rawURL, "/") && c.PublicBase != "" {
		rawURL = strings.TrimRight(c.PublicBase, "/") + rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" {
		return 0, errors.New("视频结果地址无效")
	}
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return 0, err
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, fmt.Errorf("下载视频结果失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return 0, fmt.Errorf("下载视频结果返回 %d", response.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return 0, err
	}
	file, err := os.OpenFile(outputPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, err
	}
	written, copyErr := io.Copy(file, io.LimitReader(response.Body, 2<<30))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(outputPath)
		if copyErr != nil {
			return 0, copyErr
		}
		return 0, closeErr
	}
	return written, nil
}

func (c Client) requestBody(input GenerateInput, seedance bool) (map[string]any, error) {
	if seedance {
		content := []map[string]any{{"type": "text", "text": input.Prompt}}
		for _, asset := range input.Images {
			value, err := c.assetURL(asset)
			if err != nil {
				return nil, err
			}
			content = append(content, map[string]any{"type": "image_url", "image_url": map[string]string{"url": value}, "role": "reference_image"})
		}
		for _, asset := range input.Videos {
			value, err := c.assetURL(asset)
			if err != nil {
				return nil, err
			}
			content = append(content, map[string]any{"type": "video_url", "video_url": map[string]string{"url": value}, "role": "reference_video"})
		}
		if input.RemoteVideo != "" {
			content = append(content, map[string]any{"type": "video_url", "video_url": map[string]string{"url": input.RemoteVideo}, "role": "reference_video"})
		}
		for _, asset := range input.Audios {
			value, err := c.assetURL(asset)
			if err != nil {
				return nil, err
			}
			content = append(content, map[string]any{"type": "audio_url", "audio_url": map[string]string{"url": value}, "role": "reference_audio"})
		}
		return map[string]any{"model": c.Model, "content": content, "ratio": valueOr(input.Ratio, "9:16"), "resolution": qualityValue(input.Quality), "duration": durationSeconds(input.Duration), "generate_audio": input.GenerateAudio, "watermark": false}, nil
	}
	return map[string]any{"model": c.Model, "prompt": input.Prompt, "size": input.Ratio, "duration": input.Duration, "metadata": map[string]any{"taskId": input.TaskID}}, nil
}

func (c Client) assetURL(asset store.ContentAsset) (string, error) {
	if asset.FilePath != "" {
		bytes, err := os.ReadFile(asset.FilePath)
		if err != nil {
			return "", fmt.Errorf("读取参考素材失败: %w", err)
		}
		mimeType := asset.MimeType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(bytes), nil
	}
	if asset.FileURL != "" && strings.HasPrefix(asset.FileURL, "http") {
		return asset.FileURL, nil
	}
	return "", errors.New("参考素材没有可访问地址")
}

func decodeResponse(response *http.Response) (map[string]any, error) {
	body, err := io.ReadAll(io.LimitReader(response.Body, 20<<20))
	if err != nil {
		return nil, err
	}
	var record map[string]any
	if json.Unmarshal(body, &record) != nil {
		return nil, errors.New("视频模型响应格式无效")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("视频模型返回 %d: %s", response.StatusCode, valueOr(stringValue(record, "message"), string(body)))
	}
	return record, nil
}

func parseResult(record map[string]any, provider, model string) Result {
	result := Result{Provider: provider, Model: model, Raw: record}
	result.JobID = firstString(record, "id", "task_id", "taskId", "job_id", "jobId")
	result.VideoURL = firstString(record, "video_url", "videoUrl", "url", "output_url", "outputUrl")
	result.CoverURL = firstString(record, "cover_url", "coverUrl", "preview_image_url", "last_frame_url")
	for _, key := range []string{"data", "result", "output", "content", "task"} {
		if nested, ok := record[key].(map[string]any); ok {
			child := parseResult(nested, provider, model)
			if result.JobID == "" {
				result.JobID = child.JobID
			}
			if result.VideoURL == "" {
				result.VideoURL = child.VideoURL
			}
			if result.CoverURL == "" {
				result.CoverURL = child.CoverURL
			}
		}
	}
	if values, ok := record["data"].([]any); ok && len(values) > 0 {
		if nested, ok := values[0].(map[string]any); ok {
			child := parseResult(nested, provider, model)
			result.JobID, result.VideoURL, result.CoverURL = valueOr(result.JobID, child.JobID), valueOr(result.VideoURL, child.VideoURL), valueOr(result.CoverURL, child.CoverURL)
		}
	}
	return result
}

func generationURL(baseURL, provider, model string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(trimmed, "/contents/generations/tasks") || strings.HasSuffix(trimmed, "/videos/generations") || strings.HasSuffix(trimmed, "/video/generations") {
		return trimmed
	}
	if isSeedance(trimmed, provider, model) {
		return trimmed + "/contents/generations/tasks"
	}
	return trimmed + "/videos/generations"
}

func taskURL(baseURL, provider, model, jobID string) string {
	base := generationURL(baseURL, provider, model)
	return base + "/" + url.PathEscape(jobID)
}

func isSeedance(baseURL, provider, model string) bool {
	value := strings.ToLower(baseURL + " " + provider + " " + model)
	return strings.Contains(value, "seedance") || strings.Contains(value, "volcengine") || strings.Contains(value, "ark.cn-") || strings.Contains(value, "/contents/generations/tasks")
}

func firstString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringValue(record, key); value != "" {
			return value
		}
	}
	return ""
}

func stringValue(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return strings.TrimSpace(value)
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func durationSeconds(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 5
	}
	if parsed, err := strconv.Atoi(strings.TrimSuffix(value, "秒")); err == nil && parsed > 0 {
		return parsed
	}
	return 5
}

func qualityValue(value string) string {
	if strings.Contains(strings.ToLower(value), "480") {
		return "480p"
	}
	if strings.Contains(strings.ToLower(value), "1080") {
		return "1080p"
	}
	return "720p"
}

func isFailedStatus(value string) bool {
	switch value {
	case "failed", "error", "expired", "cancelled", "canceled":
		return true
	default:
		return false
	}
}
