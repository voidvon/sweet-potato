package store

import "strings"

type AdminWork struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MediaType   string `json:"mediaType"`
	MimeType    string `json:"mimeType"`
	FileURL     string `json:"fileUrl"`
	CoverURL    string `json:"coverUrl"`
	FileSize    int64  `json:"fileSize"`
	Mode        string `json:"mode"`
	ModeTitle   string `json:"modeTitle"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	GeneratedAt string `json:"generatedAt"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func (s *Store) ListAdminWorks(page, pageSize int, username, search string) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	where := []string{`a.resource_type = 'finished_video'`, `TRIM(COALESCE(a.file_url, '')) <> ''`, `LOWER(COALESCE(json_extract(a.metadata, '$.generationStatus'), '')) NOT IN ('pending', 'queued', 'running', 'generating', 'failed')`}
	args := []any{}
	if value := strings.TrimSpace(username); value != "" {
		where = append(where, `LOWER(COALESCE(u.username, '')) LIKE ?`)
		args = append(args, "%"+strings.ToLower(value)+"%")
	}
	if value := strings.TrimSpace(search); value != "" {
		where = append(where, `(LOWER(a.name) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR LOWER(COALESCE(u.display_name, '')) LIKE ?)`)
		pattern := "%" + strings.ToLower(value) + "%"
		args = append(args, pattern, pattern, pattern)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM content_assets a LEFT JOIN users u ON u.id = a.user_id WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(`SELECT a.id, a.user_id, COALESCE(u.username, ''), COALESCE(u.display_name, ''), a.name, a.description, a.mime_type, a.file_url, a.file_size, a.metadata, a.created_at, a.updated_at FROM content_assets a LEFT JOIN users u ON u.id = a.user_id WHERE `+whereSQL+` ORDER BY a.updated_at DESC, a.id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AdminWork{}
	for rows.Next() {
		var item AdminWork
		var metadata string
		if err := rows.Scan(&item.ID, &item.UserID, &item.Username, &item.DisplayName, &item.Name, &item.Description, &item.MimeType, &item.FileURL, &item.FileSize, &metadata, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.MediaType = "video"
		if strings.HasPrefix(item.MimeType, "image/") {
			item.MediaType = "image"
		}
		meta := decodeObject(metadata)
		item.CoverURL = stringMetadata(meta, "coverUrl")
		item.Mode = stringMetadata(meta, "mode")
		item.ModeTitle = stringMetadata(meta, "modeTitle")
		item.Provider = stringMetadata(meta, "provider")
		item.Model = stringMetadata(meta, "model")
		item.GeneratedAt = stringMetadata(meta, "generatedAt")
		if item.GeneratedAt == "" {
			item.GeneratedAt = stringMetadata(meta, "completedAt")
		}
		if item.GeneratedAt == "" {
			item.GeneratedAt = item.UpdatedAt
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "page": page, "pageSize": pageSize, "total": total}, nil
}

func stringMetadata(metadata map[string]any, key string) string {
	value, _ := metadata[key].(string)
	return strings.TrimSpace(value)
}
