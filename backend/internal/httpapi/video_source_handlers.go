package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"sweet-potato-go/internal/transfer"
)

const mobileVideoUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1"

type videoSourceToken struct {
	ExpiresAt int64  `json:"expiresAt"`
	Platform  string `json:"platform"`
	Referer   string `json:"referer"`
	URL       string `json:"url"`
}

func (s *Server) handleVideoSource(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/video-source"), "/"))
	if len(parts) == 1 && parts[0] == "preview" {
		s.proxyVideoPreview(w, r)
		return
	}
	if _, ok := s.requireUser(w, r, "web.module.content.create_video"); !ok {
		return
	}
	switch {
	case len(parts) == 1 && parts[0] == "resolve" && r.Method == http.MethodPost:
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		source, err := resolveVideoSource(strings.TrimSpace(stringValue(input, "input")))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		source["previewUrl"] = s.videoPreviewURL(source)
		writeJSON(w, http.StatusOK, map[string]any{"source": source})
	case len(parts) == 1 && parts[0] == "dance-remakes" && r.Method == http.MethodPost:
		s.createVideoSourceTask(w, r, "dance_remake")
	case len(parts) == 1 && parts[0] == "subject-replaces" && r.Method == http.MethodPost:
		s.createVideoSourceTask(w, r, "subject_replace")
	default:
		writeError(w, http.StatusNotFound, "视频源接口不存在")
	}
}

func extractFirstHTTPURL(value string) (*url.URL, error) {
	matched := regexp.MustCompile(`https?://[^\s<>"']+`).FindString(value)
	matched = strings.TrimRight(matched, "),，。；;!?！？]}")
	if matched == "" {
		return nil, errors.New("请输入包含有效链接的分享内容")
	}
	parsed, err := url.Parse(matched)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("视频链接格式不正确")
	}
	return parsed, nil
}

func resolveVideoSource(input string) (map[string]any, error) {
	parsed, err := extractFirstHTTPURL(input)
	if err != nil {
		return nil, err
	}
	platform := videoPlatform(parsed.Hostname())
	if platform == "" {
		return nil, errors.New("当前仅支持抖音、快手和小红书视频链接")
	}
	body, resolved, status, err := fetchRemoteVideoPage(parsed)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 400 {
		return nil, fmt.Errorf("视频平台返回 HTTP %d", status)
	}
	metadata := findVideoMetadata(body)
	externalID := firstNonEmpty(stringFrom(metadata, "externalId"), extractExternalVideoID(platform, resolved))
	downloadURL := firstNonEmpty(stringFrom(metadata, "downloadUrl"), directVideoURL(body), resolved)
	coverURL := stringFrom(metadata, "coverUrl")
	title := firstNonEmpty(stringFrom(metadata, "title"), pageTitle(body), platform+"视频-"+externalID)
	if externalID == "" {
		externalID = strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return map[string]any{
		"coverUrl": coverURL, "downloadUrl": downloadURL, "durationMs": numberFrom(metadata, "durationMs"), "externalId": externalID,
		"height": numberFrom(metadata, "height"), "music": nil, "platform": platform, "publishedAt": nil,
		"publisher":        map[string]any{"avatarUrl": "", "id": "", "name": "", "secUid": "", "signature": "", "uniqueId": "", "verification": ""},
		"resolvedShareUrl": resolved, "sourceUrl": parsed.String(), "statistics": map[string]any{"collectCount": 0, "commentCount": 0, "diggCount": 0, "playCount": 0, "shareCount": 0},
		"title": title, "watermarkedUrl": downloadURL, "width": numberFrom(metadata, "width"),
	}, nil
}

func videoPlatform(host string) string {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, item := range []struct {
		name     string
		suffixes []string
	}{{"douyin", []string{"douyin.com", "iesdouyin.com"}}, {"xiaohongshu", []string{"xhslink.com", "xiaohongshu.com"}}, {"kuaishou", []string{"kuaishou.com", "chenzhongtech.com", "gifshow.com"}}} {
		for _, suffix := range item.suffixes {
			if host == suffix || strings.HasSuffix(host, "."+suffix) {
				return item.name
			}
		}
	}
	return ""
}

func fetchRemoteVideoPage(input *url.URL) (string, string, int, error) {
	if err := assertSafeRemoteURL(input); err != nil {
		return "", "", 0, err
	}
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		if err := assertSafeRemoteURL(req.URL); err != nil {
			return err
		}
		return nil
	}}
	request, err := http.NewRequest(http.MethodGet, input.String(), nil)
	if err != nil {
		return "", "", 0, err
	}
	request.Header.Set("User-Agent", mobileVideoUserAgent)
	request.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
	response, err := client.Do(request)
	if err != nil {
		return "", "", 0, fmt.Errorf("视频链接请求失败: %w", err)
	}
	defer response.Body.Close()
	body, err := transfer.ReadAll(response.Body, 20<<20)
	if err != nil {
		return "", "", 0, err
	}
	return string(body), response.Request.URL.String(), response.StatusCode, nil
}

func findVideoMetadata(body string) map[string]any {
	result := map[string]any{}
	for _, block := range extractJSONBlocks(body) {
		var value any
		if json.Unmarshal([]byte(block), &value) == nil {
			walkVideoMetadata(value, result)
		}
	}
	return result
}

func extractJSONBlocks(body string) []string {
	result := []string{}
	for _, marker := range []string{"__ROUTER_DATA", "__SETUP_SERVER_STATE__", "INIT_STATE", "RENDER_DATA", "__INITIAL_STATE__"} {
		start := strings.Index(body, marker)
		if start < 0 {
			continue
		}
		start = strings.Index(body[start:], "{")
		if start < 0 {
			continue
		}
		start += strings.Index(body, marker)
		depth, quote, escaped := 0, false, false
		end := -1
		for index := start; index < len(body); index++ {
			char := body[index]
			if quote {
				if escaped {
					escaped = false
				} else if char == '\\' {
					escaped = true
				} else if char == '"' {
					quote = false
				}
				continue
			}
			if char == '"' {
				quote = true
				continue
			}
			if char == '{' {
				depth++
			}
			if char == '}' {
				depth--
				if depth == 0 {
					end = index + 1
					break
				}
			}
		}
		if end > start {
			result = append(result, body[start:end])
		}
	}
	return result
}

func walkVideoMetadata(value any, result map[string]any) {
	switch item := value.(type) {
	case []any:
		for _, child := range item {
			walkVideoMetadata(child, result)
		}
	case map[string]any:
		for key, child := range item {
			lower := strings.ToLower(key)
			if _, exists := result["downloadUrl"]; !exists && (lower == "downloadaddr" || lower == "masterurl" || lower == "playurl" || lower == "downloadurl") {
				if text := stringValueAny(child); strings.HasPrefix(text, "http") {
					result["downloadUrl"] = text
				}
			}
			if _, exists := result["coverUrl"]; !exists && (lower == "coverurl" || lower == "cover" || lower == "imageurl") {
				if text := stringValueAny(child); strings.HasPrefix(text, "http") {
					result["coverUrl"] = text
				}
			}
			if _, exists := result["title"]; !exists && (lower == "desc" || lower == "title" || lower == "caption") {
				if text := stringValueAny(child); text != "" {
					result["title"] = text
				}
			}
			if lower == "duration" || lower == "videoduration" {
				if number := numberAny(child); number > 0 && result["durationMs"] == nil {
					if number < 1000 {
						number *= 1000
					}
					result["durationMs"] = number
				}
			}
			if lower == "width" {
				result["width"] = numberAny(child)
			}
			if lower == "height" {
				result["height"] = numberAny(child)
			}
			walkVideoMetadata(child, result)
		}
	}
}

func directVideoURL(body string) string {
	candidates := regexp.MustCompile(`https?://[^\s"'<>]+\.(?:mp4|mov|m3u8)(?:\?[^\s"'<>]+)?`).FindAllString(body, 8)
	if len(candidates) > 0 {
		return strings.ReplaceAll(candidates[0], `\u0026`, "&")
	}
	return ""
}
func pageTitle(body string) string {
	match := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`).FindStringSubmatch(body)
	if len(match) > 1 {
		return strings.TrimSpace(regexp.MustCompile(`\s+`).ReplaceAllString(match[1], " "))
	}
	return ""
}
func extractExternalVideoID(platform, value string) string {
	parsed, _ := url.Parse(value)
	patterns := map[string]*regexp.Regexp{"douyin": regexp.MustCompile(`/video/(\d+)`), "xiaohongshu": regexp.MustCompile(`/(?:discovery/item|explore)/([A-Za-z0-9]+)`), "kuaishou": regexp.MustCompile(`/(?:fw/photo|short-video)/([A-Za-z0-9_-]+)`)}
	if pattern := patterns[platform]; pattern != nil {
		if match := pattern.FindStringSubmatch(parsed.Path); len(match) > 1 {
			return match[1]
		}
	}
	for _, key := range []string{"item_id", "aweme_id", "photoId"} {
		if value := parsed.Query().Get(key); value != "" {
			return value
		}
	}
	return ""
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func stringFrom(value map[string]any, key string) string {
	if item, ok := value[key]; ok {
		return stringValueAny(item)
	}
	return ""
}
func numberFrom(value map[string]any, key string) float64 { return numberAny(value[key]) }
func stringValueAny(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case json.Number:
		return item.String()
	case float64:
		return strconv.FormatFloat(item, 'f', -1, 64)
	case map[string]any:
		for _, key := range []string{"url", "uri", "mainUrl", "masterUrl"} {
			if text := stringValueAny(item[key]); text != "" {
				return text
			}
		}
	}
	return ""
}
func numberAny(value any) float64 {
	switch item := value.(type) {
	case float64:
		return item
	case int:
		return float64(item)
	case json.Number:
		value, _ := item.Float64()
		return value
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(item), 64)
		return parsed
	}
	return 0
}

func assertSafeRemoteURL(value *url.URL) error {
	if value == nil || (value.Scheme != "http" && value.Scheme != "https") {
		return errors.New("仅支持 HTTP 或 HTTPS 视频链接")
	}
	host := strings.ToLower(strings.TrimSuffix(value.Hostname(), "."))
	if isPrivateHost(host) {
		return errors.New("不允许访问本地或内网地址")
	}
	addresses, err := net.LookupIP(host)
	if err == nil {
		for _, address := range addresses {
			if isPrivateIP(address) {
				return errors.New("不允许访问解析到内网的视频地址")
			}
		}
	}
	return nil
}
func isPrivateHost(value string) bool {
	return value == "localhost" || value == "0.0.0.0" || value == "::1" || isPrivateIP(net.ParseIP(value))
}
func isPrivateIP(value net.IP) bool {
	if value == nil {
		return false
	}
	if value4 := value.To4(); value4 != nil {
		return value4[0] == 10 || value4[0] == 127 || (value4[0] == 169 && value4[1] == 254) || (value4[0] == 172 && value4[1] >= 16 && value4[1] <= 31) || (value4[0] == 192 && value4[1] == 168) || value4[0] == 0 || value4[0] >= 224
	}
	return value.IsLoopback() || value.IsPrivate() || strings.HasPrefix(strings.ToLower(value.String()), "fc") || strings.HasPrefix(strings.ToLower(value.String()), "fd")
}

func (s *Server) videoPreviewURL(source map[string]any) string {
	payload := videoSourceToken{ExpiresAt: time.Now().Add(30 * time.Minute).UnixMilli(), Platform: stringValue(source, "platform"), Referer: stringValue(source, "resolvedShareUrl"), URL: stringValue(source, "downloadUrl")}
	raw, _ := json.Marshal(payload)
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(s.config.AuthTokenSecret))
	_, _ = mac.Write([]byte(encoded))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return "/api/video-source/preview?token=" + url.QueryEscape(encoded+"."+signature)
}

func (s *Server) proxyVideoPreview(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	payload, err := s.verifyVideoPreviewToken(token)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	parsed, err := url.Parse(payload.URL)
	if err != nil || assertSafeRemoteURL(parsed) != nil {
		writeError(w, 400, "预览地址无效")
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, payload.URL, nil)
	if err != nil {
		writeError(w, 400, "预览地址无效")
		return
	}
	request.Header.Set("User-Agent", mobileVideoUserAgent)
	if payload.Referer != "" {
		request.Header.Set("Referer", payload.Referer)
	}
	if rangeValue := r.Header.Get("Range"); rangeValue != "" {
		if len(rangeValue) > 100 || !regexp.MustCompile(`^bytes=\d*-\d*$`).MatchString(rangeValue) {
			writeError(w, 416, "视频预览 Range 请求无效")
			return
		}
		request.Header.Set("Range", rangeValue)
	}
	response, err := (&http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(next *http.Request, _ []*http.Request) error {
		return assertSafeRemoteURL(next.URL)
	}}).Do(request)
	if err != nil {
		writeError(w, 502, "视频预览获取失败")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 && response.StatusCode != 206 {
		writeError(w, 502, fmt.Sprintf("视频预览获取失败（%d）", response.StatusCode))
		return
	}
	for _, header := range []string{"Accept-Ranges", "Content-Length", "Content-Range", "ETag", "Last-Modified"} {
		if value := response.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("Content-Type", firstNonEmpty(response.Header.Get("Content-Type"), "video/mp4"))
	w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, 2<<30))
}
func (s *Server) verifyVideoPreviewToken(value string) (videoSourceToken, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return videoSourceToken{}, errors.New("预览令牌无效")
	}
	mac := hmac.New(sha256.New, []byte(s.config.AuthTokenSecret))
	_, _ = mac.Write([]byte(parts[0]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return videoSourceToken{}, errors.New("预览令牌无效")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return videoSourceToken{}, errors.New("预览令牌无效")
	}
	var payload videoSourceToken
	if json.Unmarshal(raw, &payload) != nil || payload.URL == "" || payload.ExpiresAt <= time.Now().UnixMilli() {
		return videoSourceToken{}, errors.New("预览地址已过期，请重新解析视频链接")
	}
	return payload, nil
}

func (s *Server) createVideoSourceTask(w http.ResponseWriter, r *http.Request, mode string) {
	input, ok := decodeMap(w, r)
	if !ok {
		return
	}
	user, _ := s.authenticatedUser(r)
	sourceURL := stringValue(input, "referenceVideoAssetId")
	if remote, exists := input["remoteVideo"].(map[string]any); exists && stringValue(remote, "input") != "" {
		sourceURL = stringValue(remote, "input")
	}
	if sourceURL == "" {
		sourceURL = stringValue(input, "sourceUrl")
	}
	taskInput := map[string]any{"sourceUrl": sourceURL, "prompt": mode + " task", "title": map[string]string{"dance_remake": "跳舞复刻", "subject_replace": "主体替换"}[mode], "aspectRatio": "9:16", "expertContext": map[string]any{"mode": mode, "request": input}, "selectedSkillIds": []any{}}
	task := buildVideoTask(user.ID, "video-productions", taskInput)
	task.Status = "pending"
	created, err := s.store.SaveVideoTask(task, true)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if mode == "dance_remake" {
		writeJSON(w, 201, map[string]any{"ok": true, "id": created.ID})
	} else {
		writeJSON(w, 201, created)
	}
}
