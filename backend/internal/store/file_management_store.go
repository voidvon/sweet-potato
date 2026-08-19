package store

import (
	"database/sql"
	"strings"
)

type ManagedFile struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	OriginalFileName string `json:"originalFileName"`
	MimeType         string `json:"mimeType"`
	FileSize         int64  `json:"fileSize"`
	FileURL          string `json:"fileUrl"`
	CoverURL         string `json:"coverUrl"`
	ResourceType     string `json:"resourceType"`
	AssetKind        string `json:"assetKind"`
	LifecycleStatus  string `json:"lifecycleStatus"`
	StorageProvider  string `json:"storageProvider"`
	StorageKey       string `json:"storageKey"`
	StorageBucket    string `json:"storageBucket"`
	MediaType        string `json:"mediaType"`
	ReferenceCount   int    `json:"referenceCount"`
	UserID           string `json:"userId"`
	Username         string `json:"username"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type ManagedFileSummary struct {
	TotalCount int   `json:"totalCount"`
	TotalBytes int64 `json:"totalBytes"`
	LocalCount int   `json:"localCount"`
	LocalBytes int64 `json:"localBytes"`
	TOSCount   int   `json:"tosCount"`
	TOSBytes   int64 `json:"tosBytes"`
}

type ManagedFileListFilters struct {
	Page            int
	PageSize        int
	Search          string
	StorageProvider string
	MediaType       string
	LifecycleStatus string
	CreatedAtFrom   string
	CreatedAtTo     string
}

type ManagedFileListResult struct {
	Items    []ManagedFile      `json:"items"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
	Total    int                `json:"total"`
	Summary  ManagedFileSummary `json:"summary"`
}

type managedFileRow struct {
	ID               string
	Name             string
	OriginalFileName string
	MimeType         string
	FileSize         int64
	FileURL          string
	ResourceType     string
	AssetKind        string
	LifecycleStatus  string
	StoredFileName   string
	Metadata         string
	ReferenceCount   int
	UserID           string
	Username         string
	CreatedAt        string
	UpdatedAt        string
}

func (s *Store) ListManagedFiles(input ManagedFileListFilters) (ManagedFileListResult, error) {
	page := input.Page
	if page < 1 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	where, args := managedFileFilters(input)
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM content_assets a LEFT JOIN users u ON u.id = a.user_id`+whereSQL, args...).Scan(&total); err != nil {
		return ManagedFileListResult{}, err
	}

	query := `SELECT
		a.id, a.name, a.original_file_name, a.mime_type, a.file_size, a.file_url,
		a.resource_type, a.asset_kind, a.lifecycle_status, a.stored_file_name, a.metadata,
		(SELECT COUNT(*) FROM content_asset_references r WHERE r.asset_id = a.id),
		a.user_id, COALESCE(u.username, ''), a.created_at, a.updated_at
		FROM content_assets a
		LEFT JOIN users u ON u.id = a.user_id` + whereSQL + `
		ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return ManagedFileListResult{}, err
	}
	defer rows.Close()

	items := make([]ManagedFile, 0)
	for rows.Next() {
		var row managedFileRow
		if err := rows.Scan(
			&row.ID, &row.Name, &row.OriginalFileName, &row.MimeType, &row.FileSize, &row.FileURL,
			&row.ResourceType, &row.AssetKind, &row.LifecycleStatus, &row.StoredFileName, &row.Metadata,
			&row.ReferenceCount, &row.UserID, &row.Username, &row.CreatedAt, &row.UpdatedAt,
		); err != nil {
			return ManagedFileListResult{}, err
		}
		items = append(items, mapManagedFile(row))
	}
	if err := rows.Err(); err != nil {
		return ManagedFileListResult{}, err
	}

	var summary ManagedFileSummary
	if err := s.db.QueryRow(`SELECT
		COUNT(*), COALESCE(SUM(file_size), 0), COUNT(*), COALESCE(SUM(file_size), 0), 0, 0
		FROM content_assets`).Scan(
		&summary.TotalCount, &summary.TotalBytes, &summary.LocalCount, &summary.LocalBytes,
		&summary.TOSCount, &summary.TOSBytes,
	); err != nil {
		return ManagedFileListResult{}, err
	}

	return ManagedFileListResult{
		Items: items, Page: page, PageSize: pageSize, Total: total, Summary: summary,
	}, nil
}

func managedFileFilters(input ManagedFileListFilters) ([]string, []any) {
	where := make([]string, 0, 6)
	args := make([]any, 0, 6)
	if search := strings.ToLower(strings.TrimSpace(input.Search)); search != "" {
		pattern := "%" + search + "%"
		where = append(where, `(LOWER(a.name) LIKE ? OR LOWER(a.original_file_name) LIKE ? OR LOWER(a.stored_file_name) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ?)`)
		args = append(args, pattern, pattern, pattern, pattern)
	}
	if provider := strings.ToLower(strings.TrimSpace(input.StorageProvider)); provider != "" && provider == "local" {
		// All files are local while TOS support is disabled.
	} else if provider != "" {
		where = append(where, "1 = 0")
	}
	if mediaType := strings.ToLower(strings.TrimSpace(input.MediaType)); mediaType != "" {
		where = append(where, mediaTypeFilterSQL(mediaType))
	}
	if lifecycle := strings.TrimSpace(input.LifecycleStatus); lifecycle != "" {
		where = append(where, "a.lifecycle_status = ?")
		args = append(args, lifecycle)
	}
	if from := strings.TrimSpace(input.CreatedAtFrom); from != "" {
		where = append(where, "a.created_at >= ?")
		args = append(args, from)
	}
	if to := strings.TrimSpace(input.CreatedAtTo); to != "" {
		where = append(where, "a.created_at <= ?")
		args = append(args, to)
	}
	return where, args
}

func mediaTypeFilterSQL(value string) string {
	switch value {
	case "image":
		return "a.mime_type LIKE 'image/%'"
	case "video":
		return "a.mime_type LIKE 'video/%'"
	case "audio":
		return "a.mime_type LIKE 'audio/%'"
	case "document":
		return "(a.mime_type LIKE 'text/%' OR a.mime_type LIKE 'application/%')"
	case "other":
		return "(a.mime_type NOT LIKE 'image/%' AND a.mime_type NOT LIKE 'video/%' AND a.mime_type NOT LIKE 'audio/%' AND a.mime_type NOT LIKE 'text/%' AND a.mime_type NOT LIKE 'application/%')"
	default:
		return "1 = 0"
	}
}

func mapManagedFile(row managedFileRow) ManagedFile {
	metadata := decodeObject(row.Metadata)
	storageKey := row.StoredFileName
	if value, ok := metadata["storageKey"].(string); ok && strings.TrimSpace(value) != "" {
		storageKey = strings.TrimSpace(value)
	}
	coverURL, _ := metadata["coverUrl"].(string)
	return ManagedFile{
		ID: row.ID, Name: row.Name, OriginalFileName: row.OriginalFileName, MimeType: row.MimeType,
		FileSize: row.FileSize, FileURL: row.FileURL, CoverURL: strings.TrimSpace(coverURL),
		ResourceType: row.ResourceType, AssetKind: row.AssetKind, LifecycleStatus: row.LifecycleStatus,
		StorageProvider: "local", StorageKey: storageKey, MediaType: managedFileMediaType(row.MimeType),
		ReferenceCount: row.ReferenceCount, UserID: row.UserID, Username: row.Username,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func managedFileMediaType(mimeType string) string {
	lower := strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(lower, "image/"):
		return "image"
	case strings.HasPrefix(lower, "video/"):
		return "video"
	case strings.HasPrefix(lower, "audio/"):
		return "audio"
	case strings.HasPrefix(lower, "text/"), strings.HasPrefix(lower, "application/"):
		return "document"
	default:
		return "other"
	}
}

func (s *Store) FindContentAssetByStorageKey(storageKey string) (ContentAsset, bool, error) {
	storageKey = strings.TrimSpace(storageKey)
	if storageKey == "" {
		return ContentAsset{}, false, nil
	}
	row := s.db.QueryRow(`SELECT a.id, a.user_id, a.group_id, a.resource_type, a.type, a.name, a.description, a.source_url, a.original_file_name, a.stored_file_name, a.mime_type, a.file_size, a.size, a.file_path, a.file_url, a.asset_kind, a.lifecycle_status, a.parent_asset_id, a.expires_at, a.retained_at, a.metadata, a.created_at, a.updated_at FROM content_assets a WHERE json_valid(a.metadata) AND json_extract(a.metadata, '$.storageKey') = ? LIMIT 1`, storageKey)
	asset, err := scanContentAsset(row)
	if err == sql.ErrNoRows {
		return ContentAsset{}, false, nil
	}
	return asset, err == nil, err
}
