package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func decodeArray(value string) []any {
	var result []any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return []any{}
	}
	return result
}

func (s *Store) ListDiscoverCategories(includeDisabled bool) ([]DiscoverCategory, error) {
	query := `SELECT id, name, slug, sort_order, status, created_at, updated_at FROM discover_categories`
	if !includeDisabled {
		query += ` WHERE status = 'active'`
	}
	query += ` ORDER BY sort_order ASC, name ASC`
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]DiscoverCategory, 0)
	for rows.Next() {
		var item DiscoverCategory
		if err := rows.Scan(&item.ID, &item.Name, &item.Slug, &item.SortOrder, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) FindDiscoverCategory(id string) (DiscoverCategory, bool, error) {
	var item DiscoverCategory
	err := s.db.QueryRow(`SELECT id, name, slug, sort_order, status, created_at, updated_at FROM discover_categories WHERE id = ?`, id).Scan(&item.ID, &item.Name, &item.Slug, &item.SortOrder, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return DiscoverCategory{}, false, nil
	}
	return item, err == nil, err
}

func (s *Store) SaveDiscoverCategory(id string, input map[string]any) (DiscoverCategory, error) {
	current, found, err := s.FindDiscoverCategory(id)
	if err != nil {
		return DiscoverCategory{}, err
	}
	name := strings.TrimSpace(stringFromMap(input, "name"))
	slug := strings.TrimSpace(stringFromMap(input, "slug"))
	if id == "" {
		if name == "" {
			return DiscoverCategory{}, errors.New("分类名称不能为空")
		}
		id = mustRandomID()
		if slug == "" {
			slug = slugify(name, id[:8])
		}
		current = DiscoverCategory{ID: id, Name: name, Slug: slug, Status: "active", SortOrder: int(numberFromMap(input, "sortOrder"))}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_, err := s.db.Exec(`INSERT INTO discover_categories (id, name, slug, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`, id, name, slug, current.SortOrder, now, now)
		if err != nil {
			return DiscoverCategory{}, fmt.Errorf("create discover category: %w", err)
		}
		result, _, err := s.FindDiscoverCategory(id)
		return result, err
	}
	if !found {
		return DiscoverCategory{}, errors.New("分类不存在")
	}
	if name == "" {
		name = current.Name
	}
	if slug == "" {
		slug = current.Slug
	}
	sortOrder := current.SortOrder
	if _, ok := input["sortOrder"]; ok {
		sortOrder = int(numberFromMap(input, "sortOrder"))
	}
	status := current.Status
	if value := strings.TrimSpace(stringFromMap(input, "status")); value == "active" || value == "disabled" {
		status = value
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE discover_categories SET name = ?, slug = ?, sort_order = ?, status = ?, updated_at = ? WHERE id = ?`, name, slug, sortOrder, status, now, id); err != nil {
		return DiscoverCategory{}, err
	}
	result, _, err := s.FindDiscoverCategory(id)
	return result, err
}

func (s *Store) DeleteDiscoverCategory(id string) error {
	result, err := s.db.Exec(`DELETE FROM discover_categories WHERE id = ? AND NOT EXISTS (SELECT 1 FROM discover_items WHERE category_id = ?)`, id, id)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return errors.New("分类不存在或仍包含作品")
	}
	return nil
}

func scanDiscoverItem(scanner rowScanner) (DiscoverItem, error) {
	var item DiscoverItem
	var coverURL, sourceCreatedAt, sourceCompletedAt, publishedAt sql.NullString
	var references string
	if err := scanner.Scan(&item.ID, &item.CategoryID, &item.SourceAssetID, &item.Title, &item.Description, &item.MediaType, &item.MimeType, &item.FileURL, &coverURL, &item.OriginalFileName, &item.FileSize, &item.LikeCount, &item.ViewCount, &item.Duration, &sourceCreatedAt, &sourceCompletedAt, &references, &item.AspectRatio, &publishedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return DiscoverItem{}, err
	}
	item.CoverURL = coverURL.String
	item.ReferenceAssets = decodeArray(references)
	item.SourceCreatedAt = nullStringPointer(sourceCreatedAt)
	item.SourceCompletedAt = nullStringPointer(sourceCompletedAt)
	item.PublishedAt = nullStringPointer(publishedAt)
	return item, nil
}

const discoverItemSelect = `SELECT id, category_id, source_asset_id, title, description, media_type, mime_type, file_url, cover_url, original_file_name, file_size, like_count, view_count, duration, source_created_at, source_completed_at, reference_assets, aspect_ratio, published_at, created_at, updated_at FROM discover_items`

func (s *Store) ListDiscoverItems(public bool, page, pageSize int, categoryID, mediaType, search string) ([]DiscoverItem, map[string]any, error) {
	where := []string{"1 = 1"}
	args := []any{}
	if public {
		where = append(where, `EXISTS (SELECT 1 FROM discover_categories c WHERE c.id = discover_items.category_id AND c.status = 'active')`)
	}
	if categoryID != "" {
		where = append(where, "category_id = ?")
		args = append(args, categoryID)
	}
	if mediaType == "image" || mediaType == "video" {
		where = append(where, "media_type = ?")
		args = append(args, mediaType)
	}
	if search != "" {
		where = append(where, "(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)")
		pattern := "%" + strings.ToLower(search) + "%"
		args = append(args, pattern, pattern)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM discover_items WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, nil, err
	}
	query := discoverItemSelect + ` WHERE ` + whereSQL + ` ORDER BY published_at DESC, updated_at DESC, id DESC`
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	args = append(args, pageSize, (page-1)*pageSize)
	query += ` LIMIT ? OFFSET ?`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	// Keep collection responses as JSON arrays even when the query has no rows.
	result := make([]DiscoverItem, 0)
	for rows.Next() {
		item, err := scanDiscoverItem(rows)
		if err != nil {
			return nil, nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return result, map[string]any{"items": result, "page": page, "pageSize": pageSize, "total": total}, nil
}

func (s *Store) FindDiscoverItem(id string) (DiscoverItem, bool, error) {
	item, err := scanDiscoverItem(s.db.QueryRow(discoverItemSelect+` WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return DiscoverItem{}, false, nil
	}
	return item, err == nil, err
}

func (s *Store) CreateDiscoverItem(input DiscoverItem) (DiscoverItem, error) {
	if input.ID == "" {
		input.ID = mustRandomID()
	}
	if input.MediaType != "image" && input.MediaType != "video" {
		return DiscoverItem{}, errors.New("发现条目媒体类型无效")
	}
	if input.ReferenceAssets == nil {
		input.ReferenceAssets = []any{}
	}
	encoded, _ := json.Marshal(input.ReferenceAssets)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if input.CreatedAt == "" {
		input.CreatedAt = now
	}
	input.UpdatedAt = now
	if input.PublishedAt == nil {
		input.PublishedAt = &now
	}
	_, err := s.db.Exec(`INSERT INTO discover_items (id, category_id, source_asset_id, title, description, media_type, mime_type, file_url, cover_url, original_file_name, file_size, like_count, view_count, duration, source_created_at, source_completed_at, reference_assets, aspect_ratio, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, input.ID, input.CategoryID, input.SourceAssetID, input.Title, input.Description, input.MediaType, input.MimeType, input.FileURL, input.CoverURL, input.OriginalFileName, input.FileSize, input.LikeCount, input.ViewCount, input.Duration, nullableStringValue(input.SourceCreatedAt), nullableStringValue(input.SourceCompletedAt), string(encoded), input.AspectRatio, nullableStringValue(input.PublishedAt), input.CreatedAt, input.UpdatedAt)
	if err != nil {
		return DiscoverItem{}, err
	}
	result, _, err := s.FindDiscoverItem(input.ID)
	return result, err
}

func (s *Store) UpdateDiscoverItem(id string, input map[string]any) (DiscoverItem, error) {
	current, found, err := s.FindDiscoverItem(id)
	if err != nil {
		return DiscoverItem{}, err
	}
	if !found {
		return DiscoverItem{}, errors.New("发现条目不存在")
	}
	if value := strings.TrimSpace(stringFromMap(input, "categoryId")); value != "" {
		current.CategoryID = value
	}
	if value, ok := input["title"].(string); ok {
		current.Title = strings.TrimSpace(value)
	}
	if value, ok := input["description"].(string); ok {
		current.Description = strings.TrimSpace(value)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.Exec(`UPDATE discover_items SET category_id = ?, title = ?, description = ?, updated_at = ? WHERE id = ?`, current.CategoryID, current.Title, current.Description, now, id)
	if err != nil {
		return DiscoverItem{}, err
	}
	current, _, err = s.FindDiscoverItem(id)
	return current, err
}

func (s *Store) DeleteDiscoverItem(id string) error {
	result, err := s.db.Exec(`DELETE FROM discover_items WHERE id = ?`, id)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return errors.New("发现条目不存在")
	}
	return nil
}

func (s *Store) IncrementDiscoverCount(id, column string) (map[string]int, bool, error) {
	if column != "like_count" && column != "view_count" {
		return nil, false, errors.New("发现计数类型无效")
	}
	result, err := s.db.Exec(`UPDATE discover_items SET `+column+` = `+column+` + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM discover_categories c WHERE c.id = discover_items.category_id AND c.status = 'active')`, id)
	if err != nil {
		return nil, false, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return nil, false, nil
	}
	var likes, views int
	if err := s.db.QueryRow(`SELECT like_count, view_count FROM discover_items WHERE id = ?`, id).Scan(&likes, &views); err != nil {
		return nil, false, err
	}
	return map[string]int{"likeCount": likes, "viewCount": views}, true, nil
}

func stringFromMap(input map[string]any, key string) string {
	value, ok := input[key]
	if !ok || value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func numberFromMap(input map[string]any, key string) float64 {
	value, ok := input[key]
	if !ok || value == nil {
		return 0
	}
	switch number := value.(type) {
	case float64:
		return number
	case int:
		return float64(number)
	case json.Number:
		parsed, _ := number.Float64()
		return parsed
	default:
		var parsed float64
		_, _ = fmt.Sscan(fmt.Sprint(value), &parsed)
		return parsed
	}
}
