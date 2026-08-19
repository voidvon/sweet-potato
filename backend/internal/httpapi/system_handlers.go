package httpapi

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ai-marketing-go/internal/store"
)

func (s *Server) handleBatchRequestSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionSettings); !ok {
		return
	}
	settings, err := s.store.GetBatchRequestSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "批量请求设置读取失败")
		return
	}
	if r.Method == http.MethodPut {
		if !decodeJSONBody(w, r, &settings) {
			return
		}
		settings, err = s.store.UpdateBatchRequestSettings(settings)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleFileStorageSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionSettings); !ok {
		return
	}
	settings, err := s.store.GetFileStorageSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "文件存储设置读取失败")
		return
	}
	if r.Method == http.MethodPut {
		var input map[string]any
		if !decodeJSONBody(w, r, &input) {
			return
		}
		secretKey := stringValue(input, "secretKey")
		settings.Enabled = boolValue(input["enabled"])
		settings.Endpoint = stringValue(input, "endpoint")
		settings.Bucket = stringValue(input, "bucket")
		settings.Region = stringValue(input, "region")
		settings.AccessKey = stringValue(input, "accessKey")
		settings.PublicBaseURL = stringValue(input, "publicBaseUrl")
		settings.KeyPrefix = stringValue(input, "keyPrefix")
		settings, err = s.store.UpdateFileStorageSettings(settings, secretKey)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleRateLimitSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionSettings); !ok {
		return
	}
	if r.Method == http.MethodPut {
		var input struct {
			Rules []store.RateLimitRule `json:"rules"`
		}
		if !decodeJSONBody(w, r, &input) {
			return
		}
		rules, err := s.store.ReplaceRateLimitRules(input.Rules)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
		return
	}
	rules, err := s.store.ListRateLimitRules()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "限速规则读取失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
}

func (s *Server) handleIPBlacklistSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionSettings); !ok {
		return
	}
	currentIP := clientIP(r)
	if r.Method == http.MethodPut {
		var input struct {
			Entries []string `json:"entries"`
		}
		if !decodeJSONBody(w, r, &input) {
			return
		}
		settings, err := s.store.ReplaceIPBlacklist(input.Entries, currentIP)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, settings)
		return
	}
	settings, err := s.store.GetIPBlacklist(currentIP)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "IP 黑名单读取失败")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleAccessLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionAccessLogs); !ok {
		return
	}
	if strings.HasSuffix(r.URL.Path, "/settings") {
		if r.Method == http.MethodPut {
			var input struct {
				RetentionDays int `json:"retentionDays"`
			}
			if !decodeJSONBody(w, r, &input) {
				return
			}
			settings, err := s.store.UpdateAccessLogSettings(input.RetentionDays)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, settings)
			return
		}
		settings, err := s.store.GetAccessLogSettings()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "日志设置读取失败")
			return
		}
		writeJSON(w, http.StatusOK, settings)
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	result, err := s.store.ListAccessLogs(page, pageSize, r.URL.Query().Get("ip"), r.URL.Query().Get("username"), r.URL.Query().Get("method"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "访问日志读取失败")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFileManagement(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionFileManagement); !ok {
		return
	}
	if strings.HasSuffix(r.URL.Path, "/tos-summary") || strings.HasSuffix(r.URL.Path, "/tos-objects") {
		writeError(w, http.StatusNotImplemented, "当前仅支持本地文件存储")
		return
	}
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/delete") {
		input, ok := decodeMap(w, r)
		if !ok {
			return
		}
		if id := strings.TrimSpace(stringValue(input, "id")); id != "" {
			if err := s.deleteManagedAsset(id); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": true})
			return
		}
		relativePaths, _ := input["relativePaths"].([]any)
		deleted := 0
		for _, value := range relativePaths {
			if s.deleteManagedFile(fmt.Sprint(value)) {
				deleted++
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	storageProvider := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("storageProvider")))
	if storageProvider != "" && storageProvider != "local" {
		writeError(w, http.StatusBadRequest, "当前仅支持本地文件存储")
		return
	}
	mediaType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mediaType")))
	if mediaType != "" && !containsString([]string{"image", "video", "audio", "document", "other"}, mediaType) {
		writeError(w, http.StatusBadRequest, "文件类型筛选无效")
		return
	}
	lifecycleStatus := strings.TrimSpace(r.URL.Query().Get("lifecycleStatus"))
	if lifecycleStatus != "" && !containsString([]string{"temporary", "retained", "permanent"}, lifecycleStatus) {
		writeError(w, http.StatusBadRequest, "文件状态筛选无效")
		return
	}
	createdAtFrom, err := normalizeFileManagementDate(r.URL.Query().Get("createdAtFrom"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "时间筛选格式无效")
		return
	}
	createdAtTo, err := normalizeFileManagementDate(r.URL.Query().Get("createdAtTo"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "时间筛选格式无效")
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	result, err := s.store.ListManagedFiles(store.ManagedFileListFilters{
		Page: page, PageSize: pageSize, Search: r.URL.Query().Get("search"),
		StorageProvider: storageProvider, MediaType: mediaType, LifecycleStatus: lifecycleStatus,
		CreatedAtFrom: createdAtFrom, CreatedAtTo: createdAtTo,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "文件列表获取失败")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func normalizeFileManagementDate(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format(time.RFC3339Nano), nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (s *Server) deleteManagedAsset(id string) error {
	asset, found, err := s.store.FindContentAsset(id)
	if err != nil {
		return err
	}
	if !found {
		return os.ErrNotExist
	}
	removed, err := s.store.DeleteContentAsset(asset.ID, asset.UserID)
	if err != nil {
		return err
	}
	if removed.FilePath != "" {
		if err := s.removeManagedFilePath(removed.FilePath); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) deleteManagedFile(relative string) bool {
	clean := strings.TrimPrefix(strings.TrimSpace(relative), "/")
	if clean == "" || strings.Contains(clean, "..") {
		return false
	}
	path := filepath.Join(s.config.DataDir, "files", filepath.FromSlash(clean))
	if err := s.removeManagedFilePath(path); err != nil {
		return false
	}
	return true
}

func (s *Server) removeManagedFilePath(path string) error {
	root, err := filepath.Abs(filepath.Join(s.config.DataDir, "files"))
	if err != nil {
		return err
	}
	target, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if target != root && !strings.HasPrefix(target, root+string(filepath.Separator)) {
		return os.ErrPermission
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	remoteIP := strings.TrimSpace(r.RemoteAddr)
	if err == nil {
		remoteIP = host
	}
	if parsed := net.ParseIP(remoteIP); parsed != nil && parsed.IsLoopback() {
		value := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
		if value != "" {
			return strings.TrimSpace(strings.Split(value, ",")[0])
		}
	}
	return remoteIP
}
