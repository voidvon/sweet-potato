package vod

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"sweet-potato-go/internal/transfer"
)

const (
	legacyUploadVersion = "2022-01-01"
	chunkSize           = 20 * 1024 * 1024
)

func (c *Client) Upload(ctx context.Context, filePath, fileName string) (UploadResult, error) {
	if err := c.Configured(); err != nil {
		return UploadResult{}, err
	}
	path := strings.TrimSpace(filePath)
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return UploadResult{}, fmt.Errorf("视频文件不存在: %s", path)
	}
	remoteName := safeVODFileName(fileName, filepath.Ext(path), filepath.Base(path))
	params := map[string]string{
		"SpaceName":     c.config.SpaceName,
		"FileSize":      strconv.FormatInt(info.Size(), 10),
		"FileName":      remoteName,
		"FileExtension": filepath.Ext(path),
		"StorageClass":  "1",
		"NeedFallback":  "true",
		"Functions":     `[{"Name":"GetMeta"}]`,
		"CallbackArgs":  "",
	}
	if c.config.UploadHostPrefer != "" {
		params["UploadHostPrefer"] = c.config.UploadHostPrefer
	}
	response, err := c.legacyRequest(ctx, "ApplyUploadInfo", legacyUploadVersion, params)
	if err != nil {
		return UploadResult{}, fmt.Errorf("申请 VOD 上传地址失败: %w", err)
	}
	data := uploadData(response)
	address := firstUploadAddress(data)
	if address == nil {
		return UploadResult{}, errors.New("VOD 上传接口未返回 UploadAddress")
	}
	host := firstStringList(address, "UploadHosts")
	storeInfos := firstMapList(address, "StoreInfos")
	if host == "" || len(storeInfos) == 0 {
		return UploadResult{}, errors.New("VOD 上传接口返回的 TOS 地址不完整")
	}
	storeURI := firstString(storeInfos[0], "StoreUri", "StoreURI")
	auth := firstString(storeInfos[0], "Auth", "Authorization")
	if storeURI == "" || auth == "" {
		return UploadResult{}, errors.New("VOD 上传接口返回的 TOS 授权不完整")
	}
	storageClass := intValue(params["StorageClass"])
	if info.Size() < chunkSize {
		if err := c.directUpload(ctx, host, storeURI, auth, path, storageClass, storeInfos[0]); err != nil {
			return UploadResult{}, err
		}
	} else {
		if err := c.chunkUpload(ctx, host, storeURI, auth, path, info.Size(), storageClass, storeInfos[0]); err != nil {
			return UploadResult{}, err
		}
	}
	sessionKey := firstString(address, "SessionKey")
	if sessionKey == "" {
		sessionKey = firstString(data, "SessionKey")
	}
	if sessionKey == "" {
		return UploadResult{}, errors.New("VOD 上传接口未返回 SessionKey")
	}
	commit, err := c.legacyRequest(ctx, "CommitUploadInfo", legacyUploadVersion, map[string]string{
		"SpaceName":    c.config.SpaceName,
		"SessionKey":   sessionKey,
		"Functions":    params["Functions"],
		"CallbackArgs": params["CallbackArgs"],
	})
	if err != nil {
		return UploadResult{}, fmt.Errorf("提交 VOD 上传失败: %w", err)
	}
	result := parseUploadResult(commit, remoteName)
	if result.Vid == "" {
		return UploadResult{}, errors.New("VOD 上传成功但未返回 Vid")
	}
	if mediaInfo, mediaErr := c.mediaSourceInfo(ctx, result.Vid); mediaErr == nil && len(mediaInfo) > 0 {
		result.SourceInfo = mergeMap(result.SourceInfo, mediaInfo)
	}
	return result, nil
}

func (c *Client) legacyRequest(ctx context.Context, action, version string, params map[string]string) (map[string]any, error) {
	if err := c.Configured(); err != nil {
		return nil, err
	}
	endpoint, host, err := c.legacyEndpoint()
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("Action", action)
	query.Set("Version", version)
	for key, value := range params {
		if value != "" {
			query.Set(key, value)
		}
	}
	requestURL := endpoint
	if encoded := canonicalQuery(query); encoded != "" {
		requestURL += "?" + encoded
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	request.Host = host
	request.Header.Set("Accept", "application/json")
	signV4(request, nil, c.config.AccessKey, c.config.SecretKey, c.config.Region, "vod", time.Now())
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := transfer.ReadAll(response.Body, 8<<20)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("VOD %s 请求失败，HTTP %d: %s", action, response.StatusCode, strings.TrimSpace(string(body)))
	}
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("VOD %s 响应格式错误: %w", action, err)
	}
	metadata := mapValue(result, "ResponseMetadata")
	apiError := mapValue(metadata, "Error")
	if code := firstString(apiError, "Code"); code != "" {
		return nil, fmt.Errorf("VOD %s 返回错误 %s: %s", action, code, firstString(apiError, "Message"))
	}
	return result, nil
}

func (c *Client) legacyEndpoint() (string, string, error) {
	value := strings.TrimSpace(c.config.APIHost)
	if value == "" {
		value = legacyHost(c.config.Region)
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return "", "", fmt.Errorf("VOD API 地址无效: %s", value)
	}
	parsed.Path = "/"
	parsed.RawPath = ""
	return strings.TrimRight(parsed.String(), "/"), parsed.Host, nil
}

func legacyHost(region string) string {
	switch strings.TrimSpace(region) {
	case "", "cn-north-1":
		return "vod.volcengineapi.com"
	case "ap-southeast-1":
		return "vod.ap-southeast-1.volcengineapi.com"
	default:
		return "vod." + region + ".volcengineapi.com"
	}
}

func (c *Client) directUpload(ctx context.Context, host, storeURI, auth, filePath string, storageClass int, storeInfo map[string]any) error {
	checksum, err := fileCRC32(filePath)
	if err != nil {
		return err
	}
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	headers := uploadHeaders(auth, storageClass, storeInfo)
	headers.Set("Content-CRC32", checksum)
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, tosURL(host, storeURI, ""), file)
	if err != nil {
		return err
	}
	request.GetBody = func() (io.ReadCloser, error) {
		return os.Open(filePath)
	}
	request.ContentLength = info.Size()
	request.Header = headers
	return c.doTOS(request, "直传")
}

func (c *Client) chunkUpload(ctx context.Context, host, storeURI, auth, filePath string, size int64, storageClass int, storeInfo map[string]any) error {
	initRequest, err := http.NewRequestWithContext(ctx, http.MethodPut, tosURL(host, storeURI, "?uploads"), nil)
	if err != nil {
		return err
	}
	initRequest.Header = uploadHeaders(auth, storageClass, storeInfo)
	initRequest.Header.Set("X-Storage-Mode", "gateway")
	initBody, err := c.doTOSJSON(initRequest, "初始化分片上传")
	if err != nil {
		return err
	}
	uploadID := firstString(mapValue(initBody, "payload", "Payload"), "uploadID", "UploadID")
	if uploadID == "" {
		return errors.New("TOS 分片初始化未返回 uploadID")
	}

	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	partChecksums := make([]string, 0, (size+chunkSize-1)/chunkSize)
	partNumber := 1
	var uploaded int64
	for uploaded < size {
		length := int64(chunkSize)
		if remaining := size - uploaded; remaining < length {
			length = remaining
		}
		buffer := make([]byte, length)
		if _, err := io.ReadFull(file, buffer); err != nil {
			return fmt.Errorf("读取视频分片失败: %w", err)
		}
		checksum := fmt.Sprintf("%08x", crc32.ChecksumIEEE(buffer))
		query := "?partNumber=" + strconv.Itoa(partNumber) + "&uploadID=" + url.QueryEscape(uploadID)
		partRequest, err := http.NewRequestWithContext(ctx, http.MethodPut, tosURL(host, storeURI, query), bytes.NewReader(buffer))
		if err != nil {
			return err
		}
		partRequest.ContentLength = length
		partRequest.Header = uploadHeaders(auth, storageClass, storeInfo)
		partRequest.Header.Set("Content-CRC32", checksum)
		partRequest.Header.Set("X-Storage-Mode", "gateway")
		if _, err := c.doTOSJSON(partRequest, "上传视频分片"); err != nil {
			return err
		}
		partChecksums = append(partChecksums, checksum)
		uploaded += length
		partNumber++
	}
	mergeParts := make([]string, 0, len(partChecksums))
	for index, checksum := range partChecksums {
		mergeParts = append(mergeParts, strconv.Itoa(index)+":"+checksum)
	}
	mergeQuery := "?uploadID=" + url.QueryEscape(uploadID)
	mergeRequest, err := http.NewRequestWithContext(ctx, http.MethodPut, tosURL(host, storeURI, mergeQuery), strings.NewReader(strings.Join(mergeParts, ",")))
	if err != nil {
		return err
	}
	mergeRequest.Header = uploadHeaders(auth, storageClass, storeInfo)
	mergeRequest.Header.Set("X-Storage-Mode", "gateway")
	if err := c.doTOS(mergeRequest, "合并视频分片"); err != nil {
		return err
	}
	return nil
}

func (c *Client) doTOS(request *http.Request, operation string) error {
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 && request.GetBody != nil {
			body, resetErr := request.GetBody()
			if resetErr != nil {
				return fmt.Errorf("TOS %s重试失败: %w", operation, resetErr)
			}
			request.Body = body
		}
		response, err := c.http.Do(request)
		if err == nil {
			body, readErr := transfer.ReadAll(response.Body, 2<<20)
			response.Body.Close()
			if readErr == nil && response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
				if len(body) == 0 {
					return nil
				}
				var payload map[string]any
				if json.Unmarshal(body, &payload) != nil || tosResponseSucceeded(payload) {
					return nil
				}
			}
			err = fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
		}
		if attempt < 2 {
			timer := time.NewTimer(time.Duration(attempt+1) * time.Second)
			select {
			case <-request.Context().Done():
				timer.Stop()
				return request.Context().Err()
			case <-timer.C:
			}
			continue
		}
		return fmt.Errorf("TOS %s失败: %w", operation, err)
	}
	return nil
}

func (c *Client) doTOSJSON(request *http.Request, operation string) (map[string]any, error) {
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 && request.GetBody != nil {
			body, resetErr := request.GetBody()
			if resetErr != nil {
				return nil, fmt.Errorf("TOS %s重试失败: %w", operation, resetErr)
			}
			request.Body = body
		}
		response, err := c.http.Do(request)
		if err == nil {
			body, readErr := transfer.ReadAll(response.Body, 2<<20)
			response.Body.Close()
			if readErr == nil && response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
				var payload map[string]any
				if len(body) == 0 {
					return map[string]any{}, nil
				}
				if json.Unmarshal(body, &payload) == nil && tosResponseSucceeded(payload) {
					return payload, nil
				}
			}
			err = fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
		}
		if attempt < 2 {
			timer := time.NewTimer(time.Duration(attempt+1) * time.Second)
			select {
			case <-request.Context().Done():
				timer.Stop()
				return nil, request.Context().Err()
			case <-timer.C:
			}
			continue
		}
		return nil, fmt.Errorf("TOS %s失败: %w", operation, err)
	}
	return nil, errors.New("TOS 请求失败")
}

func tosResponseSucceeded(payload map[string]any) bool {
	value, exists := payload["success"]
	if !exists || value == nil {
		return true
	}
	switch item := value.(type) {
	case bool:
		return item
	case float64:
		return item != 0
	case json.Number:
		return item != "0"
	case string:
		return !strings.EqualFold(strings.TrimSpace(item), "false") && strings.TrimSpace(item) != "0"
	default:
		return false
	}
}

func (c *Client) mediaSourceInfo(ctx context.Context, vid string) (map[string]any, error) {
	response, err := c.legacyRequest(ctx, "GetMediaInfos", "2022-12-01", map[string]string{"Vids": vid})
	if err != nil {
		return nil, err
	}
	result := mapValue(response, "Result")
	items := mapList(result, "MediaInfoList")
	if len(items) == 0 {
		return nil, nil
	}
	source := mapValue(items[0], "SourceInfo")
	if source == nil {
		return nil, nil
	}
	return map[string]any{
		"fileName": firstString(source, "FileName"),
		"fileType": firstString(source, "FileType"),
		"storeUri": firstString(source, "StoreUri", "StoreURI"),
		"height":   numberValue(source, "Height"),
		"width":    numberValue(source, "Width"),
		"duration": numberValue(source, "Duration"),
		"size":     numberValue(source, "Size"),
		"format":   firstString(source, "Format"),
		"fps":      numberValue(source, "Fps"),
	}, nil
}

func parseUploadResult(response map[string]any, fallbackFileName string) UploadResult {
	result := mapValue(response, "Result")
	data := mapValue(result, "Data")
	if data == nil {
		data = result
	}
	source := mapValue(data, "SourceInfo")
	return UploadResult{
		Vid:        firstString(data, "Vid"),
		PosterURI:  firstString(data, "PosterUri", "PosterURI"),
		StoreURI:   firstString(data, "StoreUri", "StoreURI"),
		FileName:   valueOr(firstString(source, "FileName"), fallbackFileName),
		RequestID:  firstString(mapValue(response, "ResponseMetadata"), "RequestId", "RequestID"),
		SourceInfo: map[string]any{"fileName": valueOr(firstString(source, "FileName"), fallbackFileName), "fileType": firstString(source, "FileType"), "storeUri": firstString(source, "StoreUri", "StoreURI"), "height": numberValue(source, "Height"), "width": numberValue(source, "Width"), "duration": numberValue(source, "Duration"), "size": numberValue(source, "Size"), "format": firstString(source, "Format"), "fps": numberValue(source, "Fps")},
	}
}

func uploadData(response map[string]any) map[string]any {
	result := mapValue(response, "Result")
	data := mapValue(result, "Data")
	if data != nil {
		return data
	}
	return result
}

func firstUploadAddress(data map[string]any) map[string]any {
	if address := mapValue(data, "UploadAddress"); address != nil && validUploadAddress(address) {
		return address
	}
	candidate := mapValue(data, "CandidateUploadAddresses")
	if candidate == nil {
		return nil
	}
	for _, key := range []string{"MainUploadAddresses", "BackupUploadAddresses", "FallbackUploadAddresses"} {
		for _, address := range mapList(candidate, key) {
			if validUploadAddress(address) {
				return address
			}
		}
	}
	return nil
}

func validUploadAddress(value map[string]any) bool {
	return firstStringList(value, "UploadHosts") != "" && len(firstMapList(value, "StoreInfos")) > 0
}

func uploadHeaders(auth string, storageClass int, storeInfo map[string]any) http.Header {
	headers := http.Header{}
	headers.Set("Authorization", auth)
	if extra := mapValue(storeInfo, "UploadHeader"); extra != nil {
		keys := make([]string, 0, len(extra))
		for key := range extra {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if value := firstString(extra, key); value != "" {
				headers.Set(key, value)
			}
		}
	}
	if storageClass == 2 {
		headers.Set("X-Upload-Storage-Class", "archive")
	}
	if storageClass == 3 {
		headers.Set("X-Upload-Storage-Class", "ia")
	}
	return headers
}

func tosURL(host, object, query string) string {
	if !strings.Contains(host, "://") {
		host = "https://" + host
	}
	return strings.TrimRight(host, "/") + "/" + strings.TrimLeft(object, "/") + query
}

func fileCRC32(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := crc32.NewIEEE()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return fmt.Sprintf("%08x", hash.Sum32()), nil
}

func safeVODFileName(fileName, fallbackExtension, uniqueName string) string {
	base := filepath.Base(strings.TrimSpace(fileName))
	if base == "." || base == "" {
		base = "video" + fallbackExtension
	}
	extension := filepath.Ext(base)
	if extension == "" {
		extension = fallbackExtension
	}
	if extension == "" {
		extension = ".mp4"
	}
	stem := strings.TrimSuffix(base, filepath.Ext(base))
	stem = safeSlug(stem)
	unique := safeSlug(strings.TrimSuffix(filepath.Base(uniqueName), filepath.Ext(filepath.Base(uniqueName))))
	if unique != "" && unique != stem {
		stem += "-" + unique
	}
	if stem == "" {
		stem = "video"
	}
	return "video-uploads/" + stem + strings.ToLower(extension)
}

func safeSlug(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '.' || char == '_' || char == '-' {
			builder.WriteRune(char)
		} else if builder.Len() > 0 {
			builder.WriteByte('-')
		}
	}
	return strings.Trim(builder.String(), "-._")
}

func mapValue(value map[string]any, keys ...string) map[string]any {
	if value == nil {
		return nil
	}
	for _, key := range keys {
		for current, item := range value {
			if strings.EqualFold(current, key) {
				if result, ok := item.(map[string]any); ok {
					return result
				}
			}
		}
	}
	return nil
}

func mapList(value map[string]any, key string) []map[string]any {
	if value == nil {
		return nil
	}
	for current, item := range value {
		if !strings.EqualFold(current, key) {
			continue
		}
		items, ok := item.([]any)
		if !ok {
			return nil
		}
		result := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if object, ok := item.(map[string]any); ok {
				result = append(result, object)
			}
		}
		return result
	}
	return nil
}

func firstMapList(value map[string]any, key string) []map[string]any {
	return mapList(value, key)
}

func firstStringList(value map[string]any, key string) string {
	if value == nil {
		return ""
	}
	for current, item := range value {
		if !strings.EqualFold(current, key) {
			continue
		}
		if items, ok := item.([]any); ok && len(items) > 0 {
			return stringValue(items[0])
		}
		if items, ok := item.([]string); ok && len(items) > 0 {
			return items[0]
		}
	}
	return ""
}

func firstString(value map[string]any, keys ...string) string {
	if value == nil {
		return ""
	}
	for _, key := range keys {
		for current, item := range value {
			if strings.EqualFold(current, key) {
				if result := stringValue(item); result != "" {
					return result
				}
			}
		}
	}
	return ""
}

func stringValue(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case json.Number:
		return item.String()
	case float64:
		return strconv.FormatFloat(item, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(item), 'f', -1, 32)
	case int:
		return strconv.Itoa(item)
	default:
		return ""
	}
}

func numberValue(value map[string]any, key string) float64 {
	return numberAny(firstAny(value, key))
}

func numberAny(value any) float64 {
	switch item := value.(type) {
	case float64:
		return item
	case float32:
		return float64(item)
	case int:
		return float64(item)
	case int64:
		return float64(item)
	case json.Number:
		parsed, _ := item.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(item, 64)
		return parsed
	default:
		return 0
	}
}

func firstAny(value map[string]any, key string) any {
	for current, item := range value {
		if strings.EqualFold(current, key) {
			return item
		}
	}
	return nil
}

func intValue(value string) int {
	result, _ := strconv.Atoi(value)
	return result
}

func intValueValue(value any) int {
	return int(numberAny(value))
}

func mergeMap(left, right map[string]any) map[string]any {
	result := map[string]any{}
	for key, value := range left {
		result[key] = value
	}
	for key, value := range right {
		if value != nil && value != "" && value != float64(0) {
			result[key] = value
		}
	}
	return result
}

func valueOr(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
