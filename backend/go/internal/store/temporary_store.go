package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

type TemporaryAssetCleanupSettings struct {
	RetentionHours         float64 `json:"retentionHours"`
	CleanupIntervalMinutes int     `json:"cleanupIntervalMinutes"`
}

type TemporaryAssetCleanupLog struct {
	ID          int64   `json:"id"`
	AssetID     string  `json:"assetId"`
	UserID      string  `json:"userId"`
	Username    string  `json:"username"`
	AssetKind   string  `json:"assetKind"`
	Name        string  `json:"name"`
	FileURL     string  `json:"fileUrl"`
	FileSize    int64   `json:"fileSize"`
	ExpiresAt   *string `json:"expiresAt"`
	TriggerType string  `json:"triggerType"`
	CleanedAt   string  `json:"cleanedAt"`
}

func (s *Store) GetTemporaryAssetCleanupSettings() (TemporaryAssetCleanupSettings, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO temporary_asset_settings (id, retention_hours, cleanup_interval_minutes, updated_at) VALUES ('default', 24, 60, ?)`, now); err != nil {
		return TemporaryAssetCleanupSettings{}, err
	}
	var result TemporaryAssetCleanupSettings
	if err := s.db.QueryRow(`SELECT retention_hours, cleanup_interval_minutes FROM temporary_asset_settings WHERE id = 'default'`).Scan(&result.RetentionHours, &result.CleanupIntervalMinutes); err != nil {
		return TemporaryAssetCleanupSettings{}, err
	}
	return result, nil
}

func (s *Store) UpdateTemporaryAssetCleanupSettings(input TemporaryAssetCleanupSettings) (TemporaryAssetCleanupSettings, error) {
	if input.RetentionHours < 1 || input.RetentionHours > 24*365 {
		return TemporaryAssetCleanupSettings{}, errors.New("临时素材保留时长无效")
	}
	if input.CleanupIntervalMinutes < 1 || input.CleanupIntervalMinutes > 24*60 {
		return TemporaryAssetCleanupSettings{}, errors.New("临时素材清理间隔无效")
	}
	if _, err := s.db.Exec(`UPDATE temporary_asset_settings SET retention_hours = ?, cleanup_interval_minutes = ?, updated_at = ? WHERE id = 'default'`, input.RetentionHours, input.CleanupIntervalMinutes, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return TemporaryAssetCleanupSettings{}, err
	}
	return s.GetTemporaryAssetCleanupSettings()
}

func (s *Store) ListTemporaryAssetCleanupCandidates(page, pageSize int) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM content_assets WHERE lifecycle_status = 'temporary' AND expires_at IS NOT NULL`).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT a.id, a.user_id, COALESCE(u.username, ''), a.asset_kind, a.name, a.mime_type, a.file_size, a.file_url, a.parent_asset_id, a.expires_at, a.created_at FROM content_assets a LEFT JOIN users u ON u.id = a.user_id WHERE a.lifecycle_status = 'temporary' AND a.expires_at IS NOT NULL ORDER BY a.expires_at ASC, a.created_at ASC LIMIT ? OFFSET ?`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, userID, username, assetKind, name, mimeType, fileURL, createdAt string
		var fileSize int64
		var parentID, expiresAt sql.NullString
		if err := rows.Scan(&id, &userID, &username, &assetKind, &name, &mimeType, &fileSize, &fileURL, &parentID, &expiresAt, &createdAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "userId": userID, "username": username, "assetKind": assetKind, "name": name, "mimeType": mimeType, "fileSize": fileSize, "fileUrl": fileURL, "parentAssetId": nullStringPointer(parentID), "expiresAt": expiresAt.String, "createdAt": createdAt})
	}
	return map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total}, rows.Err()
}

func (s *Store) ListTemporaryAssetCleanupLogs() ([]TemporaryAssetCleanupLog, error) {
	rows, err := s.db.Query(`SELECT id, asset_id, user_id, username, asset_kind, name, file_url, file_size, expires_at, trigger_type, cleaned_at FROM temporary_asset_cleanup_logs ORDER BY cleaned_at DESC, id DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []TemporaryAssetCleanupLog{}
	for rows.Next() {
		var item TemporaryAssetCleanupLog
		if err := rows.Scan(&item.ID, &item.AssetID, &item.UserID, &item.Username, &item.AssetKind, &item.Name, &item.FileURL, &item.FileSize, &item.ExpiresAt, &item.TriggerType, &item.CleanedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) DeleteTemporaryAsset(id string, requireExpired bool) (ContentAsset, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	query := `SELECT a.id, a.user_id, a.group_id, a.resource_type, a.type, a.name, a.description, a.source_url, a.original_file_name, a.stored_file_name, a.mime_type, a.file_size, a.size, a.file_path, a.file_url, a.asset_kind, a.lifecycle_status, a.parent_asset_id, a.expires_at, a.retained_at, a.metadata, a.created_at, a.updated_at FROM content_assets a WHERE a.id = ? AND a.lifecycle_status = 'temporary' AND a.expires_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM content_asset_references r WHERE r.asset_id = a.id)`
	args := []any{id}
	if requireExpired {
		query += ` AND a.expires_at <= ?`
		args = append(args, now)
	}
	asset, err := scanContentAsset(s.db.QueryRow(query, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return ContentAsset{}, false, nil
	}
	if err != nil {
		return ContentAsset{}, false, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return ContentAsset{}, false, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM content_asset_references WHERE asset_id = ?`, id); err != nil {
		return ContentAsset{}, false, err
	}
	if _, err := tx.Exec(`DELETE FROM content_assets WHERE id = ?`, id); err != nil {
		return ContentAsset{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return ContentAsset{}, false, err
	}
	return asset, true, nil
}

func (s *Store) RecordTemporaryAssetCleanup(asset ContentAsset, triggerType string) error {
	var username string
	_ = s.db.QueryRow(`SELECT username FROM users WHERE id = ?`, asset.UserID).Scan(&username)
	_, err := s.db.Exec(`INSERT INTO temporary_asset_cleanup_logs (asset_id, user_id, username, asset_kind, name, file_url, file_size, expires_at, trigger_type, cleaned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, asset.ID, asset.UserID, username, asset.AssetKind, asset.Name, asset.FileURL, asset.FileSize, nullableStringValue(asset.ExpiresAt), triggerType, time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Store) ListManagedFilePaths() ([]string, error) {
	rows, err := s.db.Query(`SELECT file_path FROM content_assets WHERE file_path <> '' UNION SELECT file_path FROM skill_files WHERE file_path <> ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func normalizeTemporaryRelativePath(value string) string {
	return strings.Trim(strings.ReplaceAll(value, "\\", "/"), "/")
}
