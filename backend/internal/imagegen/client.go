package imagegen

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
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
	Prompt       string
	Count        int
	Size         string
	AspectRatio  string
	Resolution   string
	Background   string
	OutputFormat string
	Quality      string
	Compression  *float64
	References   []store.ContentAsset
}

type Output struct {
	Bytes    []byte
	URL      string
	MimeType string
	Raw      map[string]any
}

type responseItem struct {
	B64JSON string
	URL     string
	Raw     map[string]any
}

func (c Client) Generate(ctx context.Context, input GenerateInput) ([]Output, error) {
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, errors.New("image model API key is not configured")
	}
	if strings.TrimSpace(c.Model) == "" {
		return nil, errors.New("image model name is not configured")
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("image prompt is empty")
	}
	if input.Count < 1 {
		input.Count = 1
	}
	if input.Count > 4 {
		input.Count = 4
	}

	if c.isOpenAI() && len(input.References) > 0 {
		results := make([]Output, 0, input.Count)
		for index := 0; index < input.Count; index++ {
			items, err := c.generateMultipartEdit(ctx, input)
			if err != nil {
				return nil, fmt.Errorf("image edit %d: %w", index+1, err)
			}
			results = append(results, items...)
		}
		return results, nil
	}

	items, err := c.generateJSON(ctx, input)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, errors.New("image model returned no images")
	}
	return items, nil
}

func (c Client) generateJSON(ctx context.Context, input GenerateInput) ([]Output, error) {
	body := map[string]any{
		"model":  c.Model,
		"prompt": input.Prompt,
		"stream": false,
	}
	if c.isSeedream() {
		body["size"] = valueOr(input.Size, valueOr(input.Resolution, "2K"))
		body["response_format"] = "b64_json"
		body["output_format"] = valueOr(input.OutputFormat, "png")
		body["watermark"] = false
		if input.Count > 1 {
			body["sequential_image_generation"] = "auto"
			body["sequential_image_generation_options"] = map[string]any{"max_images": input.Count}
		}
		if len(input.References) > 0 {
			images, err := c.referenceDataURLs(ctx, input.References)
			if err != nil {
				return nil, err
			}
			if len(images) == 1 {
				body["image"] = images[0]
			} else {
				body["image"] = images
			}
		}
	} else {
		body["n"] = input.Count
		body["size"] = openAIImageSize(input.Size, input.AspectRatio)
		body["response_format"] = "b64_json"
	}
	c.addOptionalFields(body, input)
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode image request: %w", err)
	}
	request, err := c.newRequest(ctx, http.MethodPost, c.endpoint("images/generations"), strings.NewReader(string(encoded)))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	return c.send(request)
}

func (c Client) generateMultipartEdit(ctx context.Context, input GenerateInput) ([]Output, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"model":  c.Model,
		"prompt": input.Prompt,
		"n":      "1",
	}
	if size := strings.TrimSpace(input.Size); size != "" {
		fields["size"] = size
	} else if size := openAIImageSize(input.Size, input.AspectRatio); size != "" {
		fields["size"] = size
	}
	if input.Quality != "" {
		fields["quality"] = input.Quality
	}
	if input.Background != "" {
		fields["background"] = input.Background
	}
	if input.OutputFormat != "" {
		fields["output_format"] = input.OutputFormat
	}
	if input.Compression != nil {
		fields["output_compression"] = strconv.FormatFloat(*input.Compression, 'f', -1, 64)
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return nil, err
		}
	}
	for _, asset := range input.References {
		data, err := c.readAsset(ctx, asset)
		if err != nil {
			return nil, err
		}
		name := filepath.Base(asset.OriginalFileName)
		if name == "." || name == "" || name == "/" {
			name = "reference.png"
		}
		part, err := writer.CreateFormFile("image[]", name)
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(data); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	request, err := c.newRequest(ctx, http.MethodPost, c.endpoint("images/edits"), bytes.NewReader(body.Bytes()))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return c.send(request)
}

func (c Client) send(request *http.Request) ([]Output, error) {
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("call image model: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 20<<20))
	if err != nil {
		return nil, err
	}
	var record map[string]any
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, fmt.Errorf("invalid image model response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("image model returned %d: %s", response.StatusCode, responseMessage(record, string(raw)))
	}
	items := responseItems(record)
	results := make([]Output, 0, len(items))
	for _, item := range items {
		if item.B64JSON != "" {
			data, err := base64.StdEncoding.DecodeString(item.B64JSON)
			if err != nil {
				return nil, fmt.Errorf("decode generated image: %w", err)
			}
			results = append(results, Output{Bytes: data, MimeType: outputMime(item.Raw, "image/png"), Raw: item.Raw})
			continue
		}
		if item.URL == "" {
			continue
		}
		data, mimeType, err := c.download(ctxForRequest(request), item.URL)
		if err != nil {
			return nil, err
		}
		results = append(results, Output{Bytes: data, URL: item.URL, MimeType: valueOr(mimeType, outputMime(item.Raw, "image/png")), Raw: item.Raw})
	}
	return results, nil
}

func (c Client) newRequest(ctx context.Context, method, endpoint string, body io.Reader) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+c.APIKey)
	return request, nil
}

func (c Client) download(ctx context.Context, rawURL string) ([]byte, string, error) {
	if strings.HasPrefix(rawURL, "/") && strings.TrimSpace(c.PublicBase) != "" {
		rawURL = strings.TrimRight(c.PublicBase, "/") + rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, "", errors.New("generated image URL is invalid")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", err
	}
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, "", fmt.Errorf("download generated image: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("download generated image returned %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 100<<20))
	return data, response.Header.Get("Content-Type"), err
}

func (c Client) readAsset(ctx context.Context, asset store.ContentAsset) ([]byte, error) {
	if asset.FilePath != "" {
		data, err := os.ReadFile(asset.FilePath)
		if err != nil {
			return nil, fmt.Errorf("read reference image: %w", err)
		}
		return data, nil
	}
	if asset.FileURL != "" {
		data, _, err := c.download(ctx, asset.FileURL)
		if err != nil {
			return nil, fmt.Errorf("read reference image: %w", err)
		}
		return data, nil
	}
	return nil, errors.New("reference image has no readable file")
}

func (c Client) referenceDataURLs(ctx context.Context, assets []store.ContentAsset) ([]string, error) {
	result := make([]string, 0, len(assets))
	for _, asset := range assets {
		data, err := c.readAsset(ctx, asset)
		if err != nil {
			return nil, err
		}
		mimeType := valueOr(asset.MimeType, "image/png")
		result = append(result, "data:"+mimeType+";base64,"+base64.StdEncoding.EncodeToString(data))
	}
	return result, nil
}

func (c Client) endpoint(path string) string {
	base := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if strings.HasSuffix(base, "/"+path) {
		return base
	}
	return base + "/" + path
}

func (c Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 10 * time.Minute}
}

func (c Client) isOpenAI() bool {
	value := strings.ToLower(c.Provider + " " + c.BaseURL + " " + c.Model)
	return strings.Contains(value, "openai") || strings.Contains(value, "image2")
}

func (c Client) isSeedream() bool {
	value := strings.ToLower(c.Provider + " " + c.BaseURL + " " + c.Model)
	return strings.Contains(value, "seedream") || strings.Contains(value, "volcengine") || strings.Contains(value, "ark.cn-")
}

func (c Client) addOptionalFields(body map[string]any, input GenerateInput) {
	if input.Background != "" {
		body["background"] = input.Background
	}
	if input.OutputFormat != "" {
		body["output_format"] = input.OutputFormat
	}
	if input.Quality != "" {
		body["quality"] = input.Quality
	}
	if input.Compression != nil {
		body["output_compression"] = *input.Compression
	}
}

func responseItems(record map[string]any) []responseItem {
	values, _ := record["data"].([]any)
	result := make([]responseItem, 0, len(values))
	for _, value := range values {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		result = append(result, responseItem{B64JSON: stringValue(item, "b64_json"), URL: stringValue(item, "url"), Raw: item})
	}
	return result
}

func responseMessage(record map[string]any, fallback string) string {
	if message := stringValue(record, "message"); message != "" {
		return message
	}
	if nested, ok := record["error"].(map[string]any); ok {
		if message := stringValue(nested, "message"); message != "" {
			return message
		}
	}
	return strings.TrimSpace(fallback)
}

func outputMime(record map[string]any, fallback string) string {
	return valueOr(stringValue(record, "mime_type"), valueOr(stringValue(record, "mimeType"), fallback))
}

func stringValue(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return strings.TrimSpace(value)
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func openAIImageSize(size, ratio string) string {
	size = strings.TrimSpace(size)
	if strings.Contains(size, "x") {
		return size
	}
	switch strings.TrimSpace(ratio) {
	case "16:9":
		return "1792x1024"
	case "9:16":
		return "1024x1792"
	default:
		return "1024x1024"
	}
}

func outputExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/webp":
		return "webp"
	default:
		return "png"
	}
}

func ctxForRequest(request *http.Request) context.Context {
	if request == nil || request.Context() == nil {
		return context.Background()
	}
	return request.Context()
}
