package store

import (
	"database/sql"
	"errors"
	"time"
)

type FileUploadIntent struct {
	ID               string
	UserID           string
	GroupID          string
	ResourceType     string
	OriginalFileName string
	StoredFileName   string
	MimeType         string
	FileSize         int64
	Name             string
	Description      string
	AssetKind        string
	LifecycleStatus  string
	Metadata         map[string]any
	Status           string
	AssetID          string
	ExpiresAt        string
	CreatedAt        string
	CompletedAt      string
}

func (s *Store) CreateFileUploadIntent(intent FileUploadIntent) (FileUploadIntent, error) {
	if intent.ID == "" {
		intent.ID = mustRandomID()
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if intent.CreatedAt == "" {
		intent.CreatedAt = now
	}
	if intent.Status == "" {
		intent.Status = "pending"
	}
	if intent.Metadata == nil {
		intent.Metadata = map[string]any{}
	}
	if _, err := s.db.Exec(`INSERT INTO file_upload_intents (id, user_id, group_id, provider, bucket, object_key, public_file_url, resource_type, original_file_name, stored_file_name, mime_type, file_size, name, description, asset_kind, lifecycle_status, metadata, status, asset_id, expires_at, created_at, completed_at) VALUES (?, ?, ?, 'local', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, intent.ID, intent.UserID, intent.GroupID, intent.StoredFileName, "/files/"+intent.StoredFileName, intent.ResourceType, intent.OriginalFileName, intent.StoredFileName, intent.MimeType, intent.FileSize, intent.Name, intent.Description, intent.AssetKind, intent.LifecycleStatus, encodeJSON(intent.Metadata), intent.Status, nullableString(intent.AssetID), intent.ExpiresAt, intent.CreatedAt, nullableString(intent.CompletedAt)); err != nil {
		return FileUploadIntent{}, err
	}
	result, found, err := s.FindFileUploadIntent(intent.ID, intent.UserID)
	if err != nil {
		return FileUploadIntent{}, err
	}
	if !found {
		return FileUploadIntent{}, errors.New("上传任务创建失败")
	}
	return result, nil
}

func (s *Store) FindFileUploadIntent(id, userID string) (FileUploadIntent, bool, error) {
	query := `SELECT id, user_id, group_id, resource_type, original_file_name, stored_file_name, mime_type, file_size, name, description, asset_kind, lifecycle_status, metadata, status, asset_id, expires_at, created_at, completed_at FROM file_upload_intents WHERE id = ?`
	args := []any{id}
	if userID != "" {
		query += ` AND user_id = ?`
		args = append(args, userID)
	}
	row := s.db.QueryRow(query, args...)
	var item FileUploadIntent
	var metadata, assetID, completedAt sql.NullString
	if err := row.Scan(&item.ID, &item.UserID, &item.GroupID, &item.ResourceType, &item.OriginalFileName, &item.StoredFileName, &item.MimeType, &item.FileSize, &item.Name, &item.Description, &item.AssetKind, &item.LifecycleStatus, &metadata, &item.Status, &assetID, &item.ExpiresAt, &item.CreatedAt, &completedAt); errors.Is(err, sql.ErrNoRows) {
		return FileUploadIntent{}, false, nil
	} else if err != nil {
		return FileUploadIntent{}, false, err
	}
	item.Metadata = decodeObject(metadata.String)
	if assetID.Valid {
		item.AssetID = assetID.String
	}
	if completedAt.Valid {
		item.CompletedAt = completedAt.String
	}
	return item, true, nil
}

func (s *Store) CompleteFileUploadIntent(id, userID, assetID string) error {
	completedAt := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE file_upload_intents SET status = 'completed', asset_id = ?, completed_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'`, assetID, completedAt, id, userID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return errors.New("上传任务已完成或不存在")
	}
	return nil
}

func (s *Store) DeleteFileUploadIntent(id, userID string) error {
	_, err := s.db.Exec(`DELETE FROM file_upload_intents WHERE id = ? AND user_id = ?`, id, userID)
	return err
}
