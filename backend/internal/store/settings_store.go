package store

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type BatchRequestSettings struct {
	MaxCount           int `json:"maxCount"`
	MaxDurationSeconds int `json:"maxDurationSeconds"`
	MaxFileSizeMB      int `json:"maxFileSizeMb"`
}

type FileStorageSettings struct {
	Enabled          bool   `json:"enabled"`
	Provider         string `json:"provider"`
	Endpoint         string `json:"endpoint"`
	Bucket           string `json:"bucket"`
	Region           string `json:"region"`
	AccessKey        string `json:"accessKey"`
	SecretKey        string `json:"secretKey"`
	SecretConfigured bool   `json:"secretKeyConfigured"`
	PublicBaseURL    string `json:"publicBaseUrl"`
	KeyPrefix        string `json:"keyPrefix"`
}

type RateLimitRule struct {
	ID              string `json:"id"`
	URLPattern      string `json:"urlPattern"`
	MaxRequests     int    `json:"maxRequests"`
	IntervalSeconds int    `json:"intervalSeconds"`
	TargetUser      string `json:"targetUser"`
}

type IPBlacklistSettings struct {
	Entries   []string `json:"entries"`
	CurrentIP string   `json:"currentIp"`
}

type AccessLog struct {
	ID          string `json:"id"`
	IP          string `json:"ip"`
	UserID      string `json:"userId"`
	Username    string `json:"username"`
	Method      string `json:"method"`
	Path        string `json:"path"`
	UserAgent   string `json:"userAgent"`
	AccessCount int    `json:"accessCount"`
	AccessedAt  string `json:"accessedAt"`
	StatusCode  int    `json:"statusCode"`
	DurationMS  int64  `json:"durationMs"`
}

func (s *Store) GetBatchRequestSettings() (BatchRequestSettings, error) {
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO batch_request_settings (id, max_count, max_duration_seconds, max_file_size_mb, updated_at) VALUES ('default', 20, 300, 100, ?)`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return BatchRequestSettings{}, err
	}
	var result BatchRequestSettings
	err := s.db.QueryRow(`SELECT max_count, max_duration_seconds, max_file_size_mb FROM batch_request_settings WHERE id = 'default'`).Scan(&result.MaxCount, &result.MaxDurationSeconds, &result.MaxFileSizeMB)
	return result, err
}

func (s *Store) UpdateBatchRequestSettings(result BatchRequestSettings) (BatchRequestSettings, error) {
	if result.MaxCount < 1 || result.MaxCount > 1000 || result.MaxDurationSeconds < 1 || result.MaxDurationSeconds > 86400 || result.MaxFileSizeMB < 1 || result.MaxFileSizeMB > 10240 {
		return BatchRequestSettings{}, errors.New("批量请求设置超出允许范围")
	}
	_, err := s.db.Exec(`UPDATE batch_request_settings SET max_count = ?, max_duration_seconds = ?, max_file_size_mb = ?, updated_at = ? WHERE id = 'default'`, result.MaxCount, result.MaxDurationSeconds, result.MaxFileSizeMB, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return BatchRequestSettings{}, err
	}
	return s.GetBatchRequestSettings()
}

func (s *Store) GetFileStorageSettings() (FileStorageSettings, error) {
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO file_storage_settings (id, enabled, key_prefix, updated_at) VALUES ('default', 0, 'app-files', ?)`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return FileStorageSettings{}, err
	}
	var result FileStorageSettings
	var enabled int
	err := s.db.QueryRow(`SELECT enabled, endpoint, bucket, region, access_key, secret_key, public_base_url, key_prefix FROM file_storage_settings WHERE id = 'default'`).Scan(&enabled, &result.Endpoint, &result.Bucket, &result.Region, &result.AccessKey, &result.SecretKey, &result.PublicBaseURL, &result.KeyPrefix)
	if err != nil {
		return FileStorageSettings{}, err
	}
	// The Go runtime currently persists files on the local filesystem only.
	// Keep the legacy TOS fields readable for database compatibility, but never
	// let them change the active provider.
	_ = enabled
	result.Enabled = false
	result.Provider = "local"
	result.SecretConfigured = result.SecretKey != ""
	result.SecretKey = ""
	return result, nil
}

func (s *Store) UpdateFileStorageSettings(input FileStorageSettings, secretKey string) (FileStorageSettings, error) {
	if input.Enabled {
		return FileStorageSettings{}, errors.New("当前版本仅支持本地文件存储")
	}
	input.Enabled = false
	if input.KeyPrefix == "" {
		input.KeyPrefix = "app-files"
	}
	input.KeyPrefix = strings.Trim(input.KeyPrefix, "/")
	for _, part := range strings.Split(input.KeyPrefix, "/") {
		if part == "." || part == ".." {
			return FileStorageSettings{}, errors.New("存储路径前缀不能包含 . 或 .. 路径段")
		}
	}
	if secretKey == "" {
		var current string
		_ = s.db.QueryRow(`SELECT secret_key FROM file_storage_settings WHERE id = 'default'`).Scan(&current)
		secretKey = current
	}
	_, err := s.db.Exec(`UPDATE file_storage_settings SET enabled = ?, endpoint = ?, bucket = ?, region = ?, access_key = ?, secret_key = ?, public_base_url = ?, key_prefix = ?, updated_at = ? WHERE id = 'default'`, boolInt(input.Enabled), strings.TrimSpace(input.Endpoint), strings.TrimSpace(input.Bucket), strings.TrimSpace(input.Region), strings.TrimSpace(input.AccessKey), secretKey, strings.TrimRight(strings.TrimSpace(input.PublicBaseURL), "/"), input.KeyPrefix, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return FileStorageSettings{}, err
	}
	return s.GetFileStorageSettings()
}

func (s *Store) ListRateLimitRules() ([]RateLimitRule, error) {
	rows, err := s.db.Query(`SELECT id, url_pattern, max_requests, interval_seconds, target_user FROM rate_limit_rules ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []RateLimitRule
	for rows.Next() {
		var item RateLimitRule
		if err := rows.Scan(&item.ID, &item.URLPattern, &item.MaxRequests, &item.IntervalSeconds, &item.TargetUser); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) ReplaceRateLimitRules(rules []RateLimitRule) ([]RateLimitRule, error) {
	if len(rules) > 1000 {
		return nil, errors.New("限速规则最多允许 1000 条")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM rate_limit_rules`); err != nil {
		return nil, err
	}
	for index := range rules {
		rule := &rules[index]
		if rule.ID == "" {
			rule.ID = mustRandomID()
		}
		if rule.URLPattern == "" || rule.MaxRequests < 1 || rule.IntervalSeconds < 1 {
			return nil, errors.New("限速规则参数无效")
		}
		if _, err := regexp.Compile(rule.URLPattern); err != nil {
			return nil, fmt.Errorf("URL 正则无效：%s", rule.URLPattern)
		}
		if rule.TargetUser != "authenticated" && rule.TargetUser != "anonymous" {
			rule.TargetUser = "all"
		}
		if _, err := tx.Exec(`INSERT INTO rate_limit_rules (id, url_pattern, max_requests, interval_seconds, target_user, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, rule.ID, rule.URLPattern, rule.MaxRequests, rule.IntervalSeconds, rule.TargetUser, now, now); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.ListRateLimitRules()
}

func (s *Store) GetIPBlacklist(currentIP string) (IPBlacklistSettings, error) {
	rows, err := s.db.Query(`SELECT rule FROM ip_blacklist_entries ORDER BY created_at ASC`)
	if err != nil {
		return IPBlacklistSettings{}, err
	}
	defer rows.Close()
	result := IPBlacklistSettings{Entries: []string{}, CurrentIP: currentIP}
	for rows.Next() {
		var rule string
		if err := rows.Scan(&rule); err != nil {
			return IPBlacklistSettings{}, err
		}
		result.Entries = append(result.Entries, rule)
	}
	return result, rows.Err()
}

func (s *Store) ReplaceIPBlacklist(entries []string, currentIP string) (IPBlacklistSettings, error) {
	entries = uniqueStrings(entries)
	for _, entry := range entries {
		if entry == currentIP {
			return IPBlacklistSettings{}, fmt.Errorf("不能将当前管理端 IP（%s）加入黑名单", currentIP)
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return IPBlacklistSettings{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM ip_blacklist_entries`); err != nil {
		return IPBlacklistSettings{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, entry := range entries {
		if _, err := tx.Exec(`INSERT INTO ip_blacklist_entries (rule, created_at) VALUES (?, ?)`, entry, now); err != nil {
			return IPBlacklistSettings{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return IPBlacklistSettings{}, err
	}
	return s.GetIPBlacklist(currentIP)
}

func (s *Store) IsIPBlacklisted(ip string) bool {
	settings, err := s.GetIPBlacklist(ip)
	if err != nil {
		return false
	}
	for _, rule := range settings.Entries {
		if rule == ip {
			return true
		}
		if network, err := regexp.Compile("^" + strings.ReplaceAll(regexp.QuoteMeta(rule), `\*`, ".*") + "$"); err == nil && network.MatchString(ip) {
			return true
		}
	}
	return false
}

func (s *Store) CreateAccessLog(record AccessLog) error {
	_, err := s.db.Exec(`INSERT INTO site_access_logs (ip, user_id, username, method, path, user_agent, status_code, duration_ms, accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, record.IP, record.UserID, record.Username, record.Method, record.Path, record.UserAgent, record.StatusCode, record.DurationMS, record.AccessedAt)
	return err
}

func (s *Store) ListAccessLogs(page, pageSize int, ip, username, method string) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	where := []string{"1 = 1"}
	args := []any{}
	if ip != "" {
		where = append(where, "ip = ?")
		args = append(args, ip)
	}
	if username != "" {
		where = append(where, "LOWER(username) LIKE ?")
		args = append(args, "%"+strings.ToLower(username)+"%")
	}
	if method != "" {
		where = append(where, "method = ?")
		args = append(args, method)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM site_access_logs WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, ip, user_id, username, method, path, user_agent, status_code, duration_ms, accessed_at FROM site_access_logs WHERE `+whereSQL+` ORDER BY accessed_at DESC, id DESC LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []AccessLog
	for rows.Next() {
		var item AccessLog
		var id int64
		if err := rows.Scan(&id, &item.IP, &item.UserID, &item.Username, &item.Method, &item.Path, &item.UserAgent, &item.StatusCode, &item.DurationMS, &item.AccessedAt); err != nil {
			return nil, err
		}
		item.ID = fmt.Sprint(id)
		items = append(items, item)
	}
	return map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total}, rows.Err()
}

func (s *Store) GetAccessLogSettings() (map[string]any, error) {
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO site_access_log_settings (id, retention_days, updated_at) VALUES ('default', 7, ?)`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return nil, err
	}
	var retention int
	if err := s.db.QueryRow(`SELECT retention_days FROM site_access_log_settings WHERE id = 'default'`).Scan(&retention); err != nil {
		return nil, err
	}
	return map[string]any{"retentionDays": retention}, nil
}

func (s *Store) UpdateAccessLogSettings(retention int) (map[string]any, error) {
	if retention < 1 || retention > 3650 {
		return nil, errors.New("日志保留天数无效")
	}
	if _, err := s.db.Exec(`UPDATE site_access_log_settings SET retention_days = ?, updated_at = ? WHERE id = 'default'`, retention, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return nil, err
	}
	return s.GetAccessLogSettings()
}
