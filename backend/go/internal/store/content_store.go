package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ContentAssetGroup struct {
	ID           string         `json:"id"`
	UserID       string         `json:"userId"`
	Username     string         `json:"username,omitempty"`
	ResourceType string         `json:"resourceType"`
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	Metadata     map[string]any `json:"metadata"`
	AssetCount   int            `json:"assetCount"`
	CoverAssets  []ContentAsset `json:"coverAssets,omitempty"`
	CreatedAt    string         `json:"createdAt"`
	UpdatedAt    string         `json:"updatedAt"`
}

type ContentAsset struct {
	ID               string         `json:"id"`
	UserID           string         `json:"userId"`
	GroupID          string         `json:"groupId"`
	ResourceType     string         `json:"resourceType"`
	Type             string         `json:"type,omitempty"`
	Name             string         `json:"name"`
	Description      string         `json:"description"`
	SourceURL        *string        `json:"sourceUrl,omitempty"`
	OriginalFileName string         `json:"originalFileName"`
	StoredFileName   string         `json:"storedFileName"`
	MimeType         string         `json:"mimeType"`
	FileSize         int64          `json:"fileSize"`
	Size             int64          `json:"size,omitempty"`
	FilePath         string         `json:"filePath"`
	FileURL          string         `json:"fileUrl"`
	AssetKind        string         `json:"assetKind,omitempty"`
	LifecycleStatus  string         `json:"lifecycleStatus,omitempty"`
	ParentAssetID    *string        `json:"parentAssetId,omitempty"`
	ExpiresAt        *string        `json:"expiresAt,omitempty"`
	RetainedAt       *string        `json:"retainedAt,omitempty"`
	Metadata         map[string]any `json:"metadata"`
	CreatedAt        string         `json:"createdAt"`
	UpdatedAt        string         `json:"updatedAt"`
}

type VideoGenerationTask struct {
	ID                   string         `json:"id"`
	UserID               string         `json:"userId"`
	SourceURL            string         `json:"sourceUrl"`
	Prompt               string         `json:"prompt,omitempty"`
	Title                string         `json:"title"`
	Status               string         `json:"status"`
	RawParseResult       map[string]any `json:"rawParseResult"`
	EditableParseResult  map[string]any `json:"editableParseResult"`
	SelectedSkillIDs     []string       `json:"selectedSkillIds,omitempty"`
	ExpertContext        map[string]any `json:"expertContext,omitempty"`
	SelectedDigitalHuman *string        `json:"selectedDigitalHumanId,omitempty"`
	SelectedVoice        *string        `json:"selectedVoiceId,omitempty"`
	SelectedScene        *string        `json:"selectedSceneId,omitempty"`
	GeneratedVideoURL    *string        `json:"generatedVideoUrl,omitempty"`
	GeneratedCoverURL    *string        `json:"generatedCoverUrl,omitempty"`
	AspectRatio          string         `json:"aspectRatio,omitempty"`
	FailureReason        *string        `json:"failureReason,omitempty"`
	CreatedAt            string         `json:"createdAt"`
	UpdatedAt            string         `json:"updatedAt"`
}

type DiscoverCategory struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	SortOrder int    `json:"sortOrder"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type DiscoverItem struct {
	ID                string  `json:"id"`
	CategoryID        string  `json:"categoryId"`
	SourceAssetID     string  `json:"sourceAssetId"`
	Title             string  `json:"title"`
	Description       string  `json:"description"`
	MediaType         string  `json:"mediaType"`
	MimeType          string  `json:"mimeType"`
	FileURL           string  `json:"fileUrl"`
	CoverURL          string  `json:"coverUrl"`
	OriginalFileName  string  `json:"originalFileName"`
	FileSize          int64   `json:"fileSize"`
	LikeCount         int     `json:"likeCount"`
	ViewCount         int     `json:"viewCount"`
	Duration          float64 `json:"duration"`
	ReferenceAssets   []any   `json:"referenceAssets"`
	AspectRatio       string  `json:"aspectRatio"`
	SourceCreatedAt   *string `json:"sourceCreatedAt,omitempty"`
	SourceCompletedAt *string `json:"sourceCompletedAt,omitempty"`
	PublishedAt       *string `json:"publishedAt,omitempty"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

func metadataOrEmpty(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func nullableStringValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullStringPointer(value sql.NullString) *string {
	if !value.Valid || value.String == "" {
		return nil
	}
	return &value.String
}

func (s *Store) ListContentGroups(userID, resourceType string, page, pageSize int) ([]ContentAssetGroup, map[string]any, error) {
	where := []string{"1 = 1"}
	args := []any{}
	if userID != "" {
		where = append(where, "g.user_id = ?")
		args = append(args, userID)
	}
	if resourceType != "" {
		where = append(where, "g.resource_type = ?")
		args = append(args, resourceType)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM content_asset_groups g WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, nil, fmt.Errorf("count content groups: %w", err)
	}
	query := `SELECT g.id, g.user_id, g.resource_type, g.name, g.description, g.metadata, g.created_at, g.updated_at, (SELECT COUNT(*) FROM content_assets a WHERE a.group_id = g.id) AS asset_count FROM content_asset_groups g WHERE ` + whereSQL + ` ORDER BY g.updated_at DESC, g.created_at DESC`
	queryArgs := append([]any{}, args...)
	paginated := page > 0 || pageSize > 0
	if paginated {
		if page < 1 {
			page = 1
		}
		if pageSize < 1 {
			pageSize = 20
		}
		if pageSize > 100 {
			pageSize = 100
		}
		query += ` LIMIT ? OFFSET ?`
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, nil, fmt.Errorf("list content groups: %w", err)
	}
	defer rows.Close()
	var result []ContentAssetGroup
	for rows.Next() {
		var group ContentAssetGroup
		var metadata string
		if err := rows.Scan(&group.ID, &group.UserID, &group.ResourceType, &group.Name, &group.Description, &metadata, &group.CreatedAt, &group.UpdatedAt, &group.AssetCount); err != nil {
			return nil, nil, err
		}
		group.Metadata = decodeObject(metadata)
		result = append(result, group)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if paginated {
		return result, map[string]any{"items": result, "page": page, "pageSize": pageSize, "total": total}, nil
	}
	return result, nil, nil
}

func (s *Store) FindContentGroup(id string) (ContentAssetGroup, bool, error) {
	var group ContentAssetGroup
	var metadata string
	err := s.db.QueryRow(`SELECT g.id, g.user_id, g.resource_type, g.name, g.description, g.metadata, g.created_at, g.updated_at, (SELECT COUNT(*) FROM content_assets a WHERE a.group_id = g.id) FROM content_asset_groups g WHERE g.id = ?`, id).Scan(&group.ID, &group.UserID, &group.ResourceType, &group.Name, &group.Description, &metadata, &group.CreatedAt, &group.UpdatedAt, &group.AssetCount)
	if errors.Is(err, sql.ErrNoRows) {
		return ContentAssetGroup{}, false, nil
	}
	if err != nil {
		return ContentAssetGroup{}, false, err
	}
	group.Metadata = decodeObject(metadata)
	return group, true, nil
}

func (s *Store) CreateContentGroup(userID, resourceType, name, description string, metadata map[string]any) (ContentAssetGroup, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(resourceType) == "" || strings.TrimSpace(name) == "" {
		return ContentAssetGroup{}, errors.New("素材分组参数不完整")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := mustRandomID()
	encoded, _ := json.Marshal(metadataOrEmpty(metadata))
	if _, err := s.db.Exec(`INSERT INTO content_asset_groups (id, user_id, resource_type, name, description, metadata, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`, id, userID, resourceType, strings.TrimSpace(name), strings.TrimSpace(description), string(encoded), now, now); err != nil {
		return ContentAssetGroup{}, fmt.Errorf("create content group: %w", err)
	}
	group, _, err := s.FindContentGroup(id)
	return group, err
}

func (s *Store) UpdateContentGroup(id, userID, name, description string, metadata map[string]any) (ContentAssetGroup, error) {
	group, found, err := s.FindContentGroup(id)
	if err != nil {
		return ContentAssetGroup{}, err
	}
	if !found || group.UserID != userID {
		return ContentAssetGroup{}, errors.New("分组不存在")
	}
	if name == "" {
		name = group.Name
	}
	if metadata == nil {
		metadata = group.Metadata
	}
	encoded, _ := json.Marshal(metadataOrEmpty(metadata))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE content_asset_groups SET name = ?, description = ?, metadata = ?, updated_at = ? WHERE id = ? AND user_id = ?`, strings.TrimSpace(name), strings.TrimSpace(description), string(encoded), now, id, userID); err != nil {
		return ContentAssetGroup{}, err
	}
	group, _, err = s.FindContentGroup(id)
	return group, err
}

func (s *Store) DeleteContentGroup(id, userID string) error {
	group, found, err := s.FindContentGroup(id)
	if err != nil {
		return err
	}
	if !found || group.UserID != userID {
		return errors.New("分组不存在")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM content_asset_references WHERE asset_id IN (SELECT id FROM content_assets WHERE group_id = ?)`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM content_assets WHERE group_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM content_asset_groups WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ListContentAssets(userID, groupID, resourceType string, page, pageSize int) ([]ContentAsset, map[string]any, error) {
	where := []string{"1 = 1"}
	args := []any{}
	if userID != "" {
		where = append(where, "a.user_id = ?")
		args = append(args, userID)
	}
	if groupID != "" {
		where = append(where, "a.group_id = ?")
		args = append(args, groupID)
	}
	if resourceType != "" {
		where = append(where, "a.resource_type = ?")
		args = append(args, resourceType)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM content_assets a WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, nil, err
	}
	query := `SELECT a.id, a.user_id, a.group_id, a.resource_type, a.type, a.name, a.description, a.source_url, a.original_file_name, a.stored_file_name, a.mime_type, a.file_size, a.size, a.file_path, a.file_url, a.asset_kind, a.lifecycle_status, a.parent_asset_id, a.expires_at, a.retained_at, a.metadata, a.created_at, a.updated_at FROM content_assets a WHERE ` + whereSQL + ` ORDER BY a.updated_at DESC, a.created_at DESC`
	queryArgs := append([]any{}, args...)
	paginated := page > 0 || pageSize > 0
	if paginated {
		if page < 1 {
			page = 1
		}
		if pageSize < 1 {
			pageSize = 50
		}
		if pageSize > 100 {
			pageSize = 100
		}
		query += ` LIMIT ? OFFSET ?`
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var result []ContentAsset
	for rows.Next() {
		asset, err := scanContentAsset(rows)
		if err != nil {
			return nil, nil, err
		}
		result = append(result, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if paginated {
		return result, map[string]any{"items": result, "page": page, "pageSize": pageSize, "total": total}, nil
	}
	return result, nil, nil
}

func scanContentAsset(scanner rowScanner) (ContentAsset, error) {
	var asset ContentAsset
	var sourceURL, parentID, expiresAt, retainedAt sql.NullString
	var metadata string
	if err := scanner.Scan(&asset.ID, &asset.UserID, &asset.GroupID, &asset.ResourceType, &asset.Type, &asset.Name, &asset.Description, &sourceURL, &asset.OriginalFileName, &asset.StoredFileName, &asset.MimeType, &asset.FileSize, &asset.Size, &asset.FilePath, &asset.FileURL, &asset.AssetKind, &asset.LifecycleStatus, &parentID, &expiresAt, &retainedAt, &metadata, &asset.CreatedAt, &asset.UpdatedAt); err != nil {
		return ContentAsset{}, err
	}
	if sourceURL.Valid {
		asset.SourceURL = &sourceURL.String
	}
	if parentID.Valid {
		asset.ParentAssetID = &parentID.String
	}
	if expiresAt.Valid {
		asset.ExpiresAt = &expiresAt.String
	}
	if retainedAt.Valid {
		asset.RetainedAt = &retainedAt.String
	}
	asset.Metadata = decodeObject(metadata)
	return asset, nil
}

func (s *Store) FindContentAsset(id string) (ContentAsset, bool, error) {
	row := s.db.QueryRow(`SELECT a.id, a.user_id, a.group_id, a.resource_type, a.type, a.name, a.description, a.source_url, a.original_file_name, a.stored_file_name, a.mime_type, a.file_size, a.size, a.file_path, a.file_url, a.asset_kind, a.lifecycle_status, a.parent_asset_id, a.expires_at, a.retained_at, a.metadata, a.created_at, a.updated_at FROM content_assets a WHERE a.id = ?`, id)
	asset, err := scanContentAsset(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ContentAsset{}, false, nil
	}
	return asset, err == nil, err
}

func (s *Store) CreateContentAsset(asset ContentAsset) (ContentAsset, error) {
	if asset.ID == "" {
		asset.ID = mustRandomID()
	}
	if asset.Type == "" {
		asset.Type = "file"
	}
	if asset.AssetKind == "" {
		asset.AssetKind = "library"
	}
	if asset.LifecycleStatus == "" {
		asset.LifecycleStatus = "permanent"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if asset.CreatedAt == "" {
		asset.CreatedAt = now
	}
	asset.UpdatedAt = now
	metadata, _ := json.Marshal(metadataOrEmpty(asset.Metadata))
	_, err := s.db.Exec(`INSERT INTO content_assets (id, group_id, user_id, resource_type, type, name, description, source_url, original_file_name, stored_file_name, mime_type, file_size, size, file_path, file_url, asset_kind, lifecycle_status, parent_asset_id, expires_at, retained_at, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, asset.ID, asset.GroupID, asset.UserID, asset.ResourceType, asset.Type, asset.Name, asset.Description, nullableStringValue(asset.SourceURL), asset.OriginalFileName, asset.StoredFileName, asset.MimeType, asset.FileSize, asset.Size, asset.FilePath, asset.FileURL, asset.AssetKind, asset.LifecycleStatus, nullableStringValue(asset.ParentAssetID), nullableStringValue(asset.ExpiresAt), nullableStringValue(asset.RetainedAt), string(metadata), asset.CreatedAt, asset.UpdatedAt)
	if err != nil {
		return ContentAsset{}, fmt.Errorf("create content asset: %w", err)
	}
	result, _, err := s.FindContentAsset(asset.ID)
	return result, err
}

func (s *Store) DeleteContentAsset(id, userID string) (ContentAsset, error) {
	asset, found, err := s.FindContentAsset(id)
	if err != nil {
		return ContentAsset{}, err
	}
	if !found || asset.UserID != userID {
		return ContentAsset{}, errors.New("素材不存在")
	}
	if _, err := s.db.Exec(`DELETE FROM content_asset_references WHERE asset_id = ?`, id); err != nil {
		return ContentAsset{}, err
	}
	if _, err := s.db.Exec(`DELETE FROM content_assets WHERE id = ?`, id); err != nil {
		return ContentAsset{}, err
	}
	return asset, nil
}

func (s *Store) UpdateContentAsset(id, userID string, input map[string]any) (ContentAsset, error) {
	asset, found, err := s.FindContentAsset(id)
	if err != nil {
		return ContentAsset{}, err
	}
	if !found || (userID != "" && asset.UserID != userID) {
		return ContentAsset{}, errors.New("素材不存在")
	}
	name := asset.Name
	if value, ok := input["name"].(string); ok && strings.TrimSpace(value) != "" {
		name = strings.TrimSpace(value)
	}
	description := asset.Description
	if value, ok := input["description"].(string); ok {
		description = strings.TrimSpace(value)
	}
	groupID := asset.GroupID
	if value, ok := input["groupId"].(string); ok && strings.TrimSpace(value) != "" {
		groupID = strings.TrimSpace(value)
	}
	resourceType := asset.ResourceType
	if value, ok := input["resourceType"].(string); ok && strings.TrimSpace(value) != "" {
		resourceType = strings.TrimSpace(value)
	}
	fileURL := asset.FileURL
	if value, ok := input["fileUrl"].(string); ok && strings.TrimSpace(value) != "" {
		fileURL = strings.TrimSpace(value)
	}
	metadata := asset.Metadata
	if value, ok := input["metadata"].(map[string]any); ok {
		metadata = value
	}
	encoded, _ := json.Marshal(metadataOrEmpty(metadata))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE content_assets SET group_id = ?, resource_type = ?, name = ?, description = ?, file_url = ?, metadata = ?, updated_at = ? WHERE id = ?`, groupID, resourceType, name, description, fileURL, string(encoded), now, id); err != nil {
		return ContentAsset{}, err
	}
	asset, _, err = s.FindContentAsset(id)
	return asset, err
}

func (s *Store) ListVideoProductions(userID string, filters map[string]string, page, pageSize int) ([]VideoGenerationTask, map[string]any, error) {
	where := []string{"user_id = ?"}
	args := []any{userID}
	if value := strings.TrimSpace(filters["search"]); value != "" {
		where = append(where, "(LOWER(title) LIKE ? OR LOWER(prompt) LIKE ?)")
		pattern := "%" + strings.ToLower(value) + "%"
		args = append(args, pattern, pattern)
	}
	if value := strings.TrimSpace(filters["status"]); value != "" {
		where = append(where, "status = ?")
		args = append(args, value)
	}
	if value := strings.TrimSpace(filters["ratio"]); value != "" {
		where = append(where, "aspect_ratio = ?")
		args = append(args, value)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM video_generation_tasks WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, nil, err
	}
	query := `SELECT id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result, selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id, generated_video_url, generated_cover_url, aspect_ratio, failure_reason, created_at, updated_at FROM video_generation_tasks WHERE ` + whereSQL + ` ORDER BY updated_at DESC, created_at DESC`
	queryArgs := append([]any{}, args...)
	paginated := page > 0 || pageSize > 0
	if paginated {
		if page < 1 {
			page = 1
		}
		if pageSize < 1 {
			pageSize = 20
		}
		if pageSize > 100 {
			pageSize = 100
		}
		query += ` LIMIT ? OFFSET ?`
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var result []VideoGenerationTask
	for rows.Next() {
		task, err := scanVideoTask(rows)
		if err != nil {
			return nil, nil, err
		}
		result = append(result, task)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if paginated {
		return result, map[string]any{"items": result, "page": page, "pageSize": pageSize, "total": total}, nil
	}
	return result, nil, nil
}

func (s *Store) ListVideoTasks(userID string) ([]VideoGenerationTask, error) {
	rows, err := s.db.Query(`SELECT id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result, selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id, generated_video_url, generated_cover_url, aspect_ratio, failure_reason, created_at, updated_at FROM video_generation_tasks WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []VideoGenerationTask
	for rows.Next() {
		task, err := scanVideoTask(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, task)
	}
	return result, rows.Err()
}

func scanVideoTask(scanner rowScanner) (VideoGenerationTask, error) {
	var task VideoGenerationTask
	var selectedDigitalHuman, selectedVoice, selectedScene, generatedVideo, generatedCover, failure sql.NullString
	var selectedSkills, expertContext, rawResult, editableResult string
	if err := scanner.Scan(&task.ID, &task.UserID, &task.SourceURL, &task.Prompt, &task.Title, &task.Status, &rawResult, &editableResult, &selectedSkills, &expertContext, &selectedDigitalHuman, &selectedVoice, &selectedScene, &generatedVideo, &generatedCover, &task.AspectRatio, &failure, &task.CreatedAt, &task.UpdatedAt); err != nil {
		return VideoGenerationTask{}, err
	}
	task.RawParseResult = decodeObject(rawResult)
	task.EditableParseResult = decodeObject(editableResult)
	var skillList []string
	_ = json.Unmarshal([]byte(selectedSkills), &skillList)
	if skillList == nil {
		skillList = []string{}
	}
	task.SelectedSkillIDs = skillList
	task.ExpertContext = decodeObject(expertContext)
	task.SelectedDigitalHuman = nullStringPointer(selectedDigitalHuman)
	task.SelectedVoice = nullStringPointer(selectedVoice)
	task.SelectedScene = nullStringPointer(selectedScene)
	task.GeneratedVideoURL = nullStringPointer(generatedVideo)
	task.GeneratedCoverURL = nullStringPointer(generatedCover)
	task.FailureReason = nullStringPointer(failure)
	return task, nil
}

func (s *Store) FindVideoTask(id, userID string) (VideoGenerationTask, bool, error) {
	row := s.db.QueryRow(`SELECT id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result, selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id, generated_video_url, generated_cover_url, aspect_ratio, failure_reason, created_at, updated_at FROM video_generation_tasks WHERE id = ? AND user_id = ?`, id, userID)
	task, err := scanVideoTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return VideoGenerationTask{}, false, nil
	}
	return task, err == nil, err
}

func (s *Store) SaveVideoTask(task VideoGenerationTask, insert bool) (VideoGenerationTask, error) {
	if task.ID == "" {
		task.ID = mustRandomID()
	}
	if task.Status == "" {
		task.Status = "pending"
	}
	if task.RawParseResult == nil {
		task.RawParseResult = map[string]any{}
	}
	if task.EditableParseResult == nil {
		task.EditableParseResult = map[string]any{}
	}
	if task.SelectedSkillIDs == nil {
		task.SelectedSkillIDs = []string{}
	}
	if task.ExpertContext == nil {
		task.ExpertContext = map[string]any{}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if task.CreatedAt == "" {
		task.CreatedAt = now
	}
	task.UpdatedAt = now
	raw, _ := json.Marshal(task.RawParseResult)
	editable, _ := json.Marshal(task.EditableParseResult)
	skills, _ := json.Marshal(task.SelectedSkillIDs)
	expert, _ := json.Marshal(task.ExpertContext)
	args := []any{task.ID, task.UserID, task.SourceURL, task.Prompt, task.Title, task.Status, string(raw), string(editable), string(skills), string(expert), nullableStringValue(task.SelectedDigitalHuman), nullableStringValue(task.SelectedVoice), nullableStringValue(task.SelectedScene), nullableStringValue(task.GeneratedVideoURL), nullableStringValue(task.GeneratedCoverURL), task.AspectRatio, nullableStringValue(task.FailureReason), task.CreatedAt, task.UpdatedAt}
	var err error
	if insert {
		_, err = s.db.Exec(`INSERT INTO video_generation_tasks (id, user_id, source_url, prompt, title, status, raw_parse_result, editable_parse_result, selected_skill_ids, expert_context, selected_digital_human_id, selected_voice_id, selected_scene_id, generated_video_url, generated_cover_url, aspect_ratio, failure_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args...)
	} else {
		_, err = s.db.Exec(`UPDATE video_generation_tasks SET source_url = ?, prompt = ?, title = ?, status = ?, raw_parse_result = ?, editable_parse_result = ?, selected_skill_ids = ?, expert_context = ?, selected_digital_human_id = ?, selected_voice_id = ?, selected_scene_id = ?, generated_video_url = ?, generated_cover_url = ?, aspect_ratio = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?`, task.SourceURL, task.Prompt, task.Title, task.Status, string(raw), string(editable), string(skills), string(expert), nullableStringValue(task.SelectedDigitalHuman), nullableStringValue(task.SelectedVoice), nullableStringValue(task.SelectedScene), nullableStringValue(task.GeneratedVideoURL), nullableStringValue(task.GeneratedCoverURL), task.AspectRatio, nullableStringValue(task.FailureReason), task.UpdatedAt, task.ID, task.UserID)
	}
	if err != nil {
		return VideoGenerationTask{}, err
	}
	result, found, err := s.FindVideoTask(task.ID, task.UserID)
	if err != nil {
		return VideoGenerationTask{}, err
	}
	if !found {
		return VideoGenerationTask{}, sql.ErrNoRows
	}
	return result, nil
}

func (s *Store) DeleteVideoTask(id, userID string) error {
	result, err := s.db.Exec(`DELETE FROM video_generation_tasks WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return errors.New("视频任务不存在")
	}
	return nil
}
