package imagegen

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"sweet-potato-go/internal/store"
	"sweet-potato-go/internal/transfer"
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

type OutputCallback func(output Output, slotIndex int) error

func (c Client) Generate(ctx context.Context, input GenerateInput) ([]Output, error) {
	return c.GenerateWithProgress(ctx, input, nil)
}

func (c Client) GenerateWithProgress(ctx context.Context, input GenerateInput, onOutput OutputCallback) ([]Output, error) {
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
	if input.Count > 12 {
		input.Count = 12
	}
	nextSlotIndex := 0
	emit := func(output Output) error {
		if onOutput != nil {
			if err := onOutput(output, nextSlotIndex); err != nil {
				return err
			}
		}
		nextSlotIndex++
		return nil
	}
	items, err := c.generate(ctx, input, emit)
	if err != nil && len(items) == 0 && strings.EqualFold(strings.TrimSpace(input.Background), "transparent") && transparentBackgroundUnsupported(err) {
		input.Background = "opaque"
		items, err = c.generate(ctx, input, emit)
	}
	return items, err
}

func (c Client) generate(ctx context.Context, input GenerateInput, emit func(Output) error) ([]Output, error) {
	if c.isOpenAI() && len(input.References) > 0 {
		results := make([]Output, 0, input.Count)
		for index := 0; index < input.Count; index++ {
			items, err := c.generateMultipartEdit(ctx, input, emit)
			results = append(results, items...)
			if err != nil {
				return results, fmt.Errorf("image edit %d: %w", index+1, err)
			}
		}
		return results, nil
	}
	if c.isGPTImage2() && input.Count > 1 {
		results := make([]Output, 0, input.Count)
		for index := 0; index < input.Count; index++ {
			single := input
			single.Count = 1
			items, err := c.generateJSON(ctx, single, emit)
			results = append(results, items...)
			if err != nil {
				return results, fmt.Errorf("image generation %d: %w", index+1, err)
			}
			if len(items) == 0 {
				return results, errors.New("image model returned no images")
			}
		}
		return results, nil
	}
	if !c.isSeedream() && input.Count > 4 {
		results := make([]Output, 0, input.Count)
		for remaining := input.Count; remaining > 0; remaining -= min(4, remaining) {
			chunk := input
			chunk.Count = min(4, remaining)
			items, err := c.generateJSON(ctx, chunk, emit)
			results = append(results, items...)
			if err != nil {
				return results, err
			}
			if len(items) == 0 {
				return nil, errors.New("image model returned no images")
			}
		}
		return results, nil
	}

	items, err := c.generateJSON(ctx, input, emit)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, errors.New("image model returned no images")
	}
	return items, nil
}

func transparentBackgroundUnsupported(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "transparent background") && strings.Contains(message, "not supported")
}

func (c Client) generateJSON(ctx context.Context, input GenerateInput, emit func(Output) error) ([]Output, error) {
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
		if !c.isGPTImage2() {
			body["n"] = input.Count
		}
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
	return c.send(request, emit)
}

func (c Client) generateMultipartEdit(ctx context.Context, input GenerateInput, emit func(Output) error) ([]Output, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"model":  c.Model,
		"prompt": input.Prompt,
	}
	if !c.isGPTImage2() {
		fields["n"] = "1"
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
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "image[]", "filename": name}))
		header.Set("Content-Type", valueOr(strings.TrimSpace(asset.MimeType), "image/png"))
		part, err := writer.CreatePart(header)
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
	return c.send(request, emit)
}

func (c Client) send(request *http.Request, emit func(Output) error) ([]Output, error) {
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("call image model: %w", err)
	}
	defer response.Body.Close()
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if response.StatusCode >= 200 && response.StatusCode < 300 && contentType == "text/event-stream" {
		return c.readImageSSE(request, response.Body, emit)
	}
	raw, err := transfer.ReadAll(response.Body, 20<<20)
	if err != nil {
		return nil, err
	}
	record, err := decodeImageModelResponse(raw, response.Header.Get("Content-Type"))
	if err != nil {
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, fmt.Errorf("image model returned %d: %s", response.StatusCode, imageResponseDiagnostic(raw))
		}
		return nil, fmt.Errorf("invalid image model response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("image model returned %d: %s", response.StatusCode, responseMessage(record, string(raw)))
	}
	items := responseItems(record)
	if len(items) == 0 {
		if message := responseMessage(record, ""); message != "" {
			return nil, fmt.Errorf("image model returned an error: %s", message)
		}
	}
	results, err := c.outputsFromItems(request, items)
	if err != nil {
		return nil, err
	}
	for _, output := range results {
		if emit != nil {
			if err := emit(output); err != nil {
				return results, err
			}
		}
	}
	return results, nil
}

func (c Client) outputsFromItems(request *http.Request, items []responseItem) ([]Output, error) {
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

func (c Client) readImageSSE(request *http.Request, body io.Reader, emit func(Output) error) ([]Output, error) {
	const maxResponseBytes = int64(256 << 20)
	reader := bufio.NewReader(io.LimitReader(body, maxResponseBytes+1))
	results := []Output{}
	seen := map[string]bool{}
	eventName := ""
	dataLines := []string{}
	var bytesRead int64
	flush := func() (bool, error) {
		payload := strings.TrimSpace(strings.Join(dataLines, "\n"))
		dataLines = dataLines[:0]
		currentEvent := eventName
		eventName = ""
		if payload == "" {
			return false, nil
		}
		if payload == "[DONE]" {
			return true, nil
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			return false, fmt.Errorf("decode image SSE event %q: %w", currentEvent, err)
		}
		descriptor := strings.ToLower(currentEvent + " " + stringValue(event, "type"))
		if strings.Contains(descriptor, "error") || event["error"] != nil {
			return false, fmt.Errorf("image model returned an error: %s", responseMessage(event, payload))
		}
		if strings.Contains(descriptor, "partial_image") && !strings.Contains(descriptor, "completed") {
			return false, nil
		}
		records := []map[string]any{event}
		for _, key := range []string{"response", "result"} {
			if nested, ok := event[key].(map[string]any); ok {
				records = append(records, nested)
			}
		}
		for _, record := range records {
			items := responseItems(record)
			if len(items) == 0 && (stringValue(record, "b64_json") != "" || stringValue(record, "url") != "") {
				items = []responseItem{{B64JSON: stringValue(record, "b64_json"), URL: stringValue(record, "url"), Raw: record}}
			}
			for _, item := range items {
				key := imageResponseItemKey(item)
				if seen[key] {
					continue
				}
				outputs, err := c.outputsFromItems(request, []responseItem{item})
				if err != nil {
					return false, err
				}
				for _, output := range outputs {
					seen[key] = true
					results = append(results, output)
					if emit != nil {
						if err := emit(output); err != nil {
							return false, err
						}
					}
				}
			}
		}
		return strings.Contains(descriptor, "response.completed") || strings.Contains(descriptor, "image_generation.completed"), nil
	}
	for {
		line, err := reader.ReadString('\n')
		bytesRead += int64(len(line))
		if bytesRead > maxResponseBytes {
			return results, fmt.Errorf("response exceeds %d byte limit", maxResponseBytes)
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			done, flushErr := flush()
			if flushErr != nil {
				return results, flushErr
			}
			if done {
				if len(results) == 0 {
					return nil, errors.New("image SSE response contained no image data")
				}
				return results, nil
			}
		} else {
			switch {
			case strings.HasPrefix(line, "event:"):
				eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			case strings.HasPrefix(line, "data:"):
				dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			case strings.HasPrefix(line, ":"):
			default:
				return results, fmt.Errorf("unexpected image response line %q", truncateImageDiagnostic(line))
			}
		}
		if err == io.EOF {
			if len(dataLines) > 0 {
				_, flushErr := flush()
				if flushErr != nil {
					return results, flushErr
				}
			}
			if len(results) == 0 {
				return nil, errors.New("image SSE response contained no image data")
			}
			return results, nil
		}
		if err != nil {
			return results, err
		}
	}
}

func imageResponseItemKey(item responseItem) string {
	if item.URL != "" {
		return "url:" + item.URL
	}
	value := item.B64JSON
	if len(value) > 64 {
		return fmt.Sprintf("b64:%d:%s:%s", len(value), value[:32], value[len(value)-32:])
	}
	return "b64:" + value
}

func decodeImageModelResponse(raw []byte, contentType string) (map[string]any, error) {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch {
	case mediaType == "application/json" || strings.HasSuffix(mediaType, "+json"):
		var record map[string]any
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, fmt.Errorf("response declared %s but contained invalid JSON: %w", mediaType, err)
		}
		return record, nil
	case mediaType == "text/event-stream":
		return decodeImageModelSSE(raw)
	case mediaType != "" && mediaType != "application/octet-stream":
		return nil, fmt.Errorf("unexpected image response Content-Type %q", contentType)
	}

	// A few OpenAI-compatible gateways omit Content-Type. Keep a bounded
	// compatibility path for those responses, while never overriding an
	// explicit JSON or SSE declaration above.
	var record map[string]any
	if err := json.Unmarshal(raw, &record); err == nil {
		return record, nil
	}
	if looksLikeImageSSE(raw) {
		return decodeImageModelSSE(raw)
	}
	return nil, errors.New("image response omitted Content-Type and was neither JSON nor SSE")
}

func looksLikeImageSSE(raw []byte) bool {
	value := strings.TrimSpace(string(raw))
	return strings.HasPrefix(value, "event:") || strings.HasPrefix(value, "data:") || strings.HasPrefix(value, ":")
}

func decodeImageModelSSE(raw []byte) (map[string]any, error) {
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	itemsByIndex := map[int]map[string]any{}
	var fullRecord map[string]any
	var errorRecord map[string]any
	eventName := ""
	dataLines := []string{}
	flush := func() error {
		if len(dataLines) == 0 {
			eventName = ""
			return nil
		}
		payload := strings.TrimSpace(strings.Join(dataLines, "\n"))
		dataLines = dataLines[:0]
		currentEvent := eventName
		eventName = ""
		if payload == "" || payload == "[DONE]" {
			return nil
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			return fmt.Errorf("decode image SSE event %q: %w", currentEvent, err)
		}
		if strings.Contains(strings.ToLower(currentEvent+" "+stringValue(event, "type")), "error") || event["error"] != nil {
			errorRecord = event
		}
		if len(responseItems(event)) > 0 {
			fullRecord = event
			return nil
		}
		for _, key := range []string{"response", "result"} {
			if nested, ok := event[key].(map[string]any); ok && len(responseItems(nested)) > 0 {
				fullRecord = nested
				return nil
			}
		}
		if stringValue(event, "b64_json") != "" || stringValue(event, "url") != "" {
			itemsByIndex[imageSSEItemIndex(event)] = event
		}
		return nil
	}
	for _, line := range lines {
		if line == "" {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		case strings.HasPrefix(line, ":"):
			// SSE comment/heartbeat.
		default:
			return nil, fmt.Errorf("unexpected image response line %q", truncateImageDiagnostic(line))
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	if fullRecord != nil {
		return fullRecord, nil
	}
	if len(itemsByIndex) > 0 {
		largestIndex := 0
		for index := range itemsByIndex {
			if index > largestIndex {
				largestIndex = index
			}
		}
		items := make([]any, 0, len(itemsByIndex))
		for index := 0; index <= largestIndex; index++ {
			if item, ok := itemsByIndex[index]; ok {
				items = append(items, item)
			}
		}
		return map[string]any{"data": items}, nil
	}
	if errorRecord != nil {
		return errorRecord, nil
	}
	return nil, errors.New("image SSE response contained no image data")
}

func imageSSEItemIndex(record map[string]any) int {
	for _, key := range []string{"partial_image_index", "image_index", "index"} {
		switch value := record[key].(type) {
		case float64:
			if value >= 0 {
				return int(value)
			}
		case int:
			if value >= 0 {
				return value
			}
		}
	}
	return 0
}

func imageResponseDiagnostic(raw []byte) string {
	return truncateImageDiagnostic(strings.TrimSpace(string(raw)))
}

func truncateImageDiagnostic(value string) string {
	const limit = 800
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
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
	if err := transfer.ValidatePublicHTTPURL(parsed.String()); err != nil {
		return nil, "", err
	}
	response, err := transfer.PublicRedirectClient(c.httpClient()).Do(request)
	if err != nil {
		return nil, "", fmt.Errorf("download generated image: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("download generated image returned %d", response.StatusCode)
	}
	data, err := transfer.ReadAll(response.Body, 100<<20)
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

func (c Client) isGPTImage2() bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(c.Model)), "gpt-image-2")
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
