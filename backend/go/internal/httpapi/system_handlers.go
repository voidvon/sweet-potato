package httpapi

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"

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
	// The local provider is the canonical Go runtime. TOS management is
	// exposed as an explicit unsupported response until its Go client is configured.
	if strings.HasSuffix(r.URL.Path, "/tos-summary") || strings.HasSuffix(r.URL.Path, "/tos-objects") {
		writeJSON(w, http.StatusOK, map[string]any{"provider": "local", "items": []any{}, "total": 0})
		return
	}
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/delete") {
		var input struct {
			RelativePaths []string `json:"relativePaths"`
		}
		if !decodeJSONBody(w, r, &input) {
			return
		}
		deleted := 0
		for _, relative := range input.RelativePaths {
			if s.deleteManagedFile(relative) {
				deleted++
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "page": 1, "pageSize": 50, "total": 0})
}

func (s *Server) deleteManagedFile(relative string) bool {
	clean := strings.TrimPrefix(strings.TrimSpace(relative), "/")
	if clean == "" || strings.Contains(clean, "..") {
		return false
	}
	path := s.config.DataDir + "/files/" + clean
	// os.Remove is deliberately kept behind a validated data/files relative path.
	if err := os.Remove(path); err != nil {
		return false
	}
	return true
}

func clientIP(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if value != "" {
		return strings.TrimSpace(strings.Split(value, ",")[0])
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
