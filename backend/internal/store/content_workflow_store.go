package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

type ContentWorkflow struct {
	ID            string         `json:"id"`
	UserID        string         `json:"userId"`
	ModuleKey     string         `json:"moduleKey"`
	RecordKey     string         `json:"recordKey"`
	Title         string         `json:"title"`
	Status        string         `json:"status"`
	CurrentStep   string         `json:"currentStep"`
	State         map[string]any `json:"state"`
	SchemaVersion int            `json:"schemaVersion"`
	Revision      int            `json:"revision"`
	CompletedAt   *string        `json:"completedAt,omitempty"`
	DeletedAt     *string        `json:"deletedAt,omitempty"`
	CreatedAt     string         `json:"createdAt"`
	UpdatedAt     string         `json:"updatedAt"`
}

func (s *Store) UpsertContentWorkflow(item ContentWorkflow) (ContentWorkflow, error) {
	item.UserID = strings.TrimSpace(item.UserID)
	item.ModuleKey = strings.TrimSpace(item.ModuleKey)
	item.RecordKey = strings.TrimSpace(item.RecordKey)
	if item.ID == "" {
		item.ID = mustRandomID()
	}
	if item.RecordKey == "" {
		item.RecordKey = "default"
	}
	if item.Status == "" {
		item.Status = "draft"
	}
	if item.State == nil {
		item.State = map[string]any{}
	}
	if item.SchemaVersion < 1 {
		item.SchemaVersion = 1
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if item.Status == "completed" && item.CompletedAt == nil {
		item.CompletedAt = &now
	}
	_, err := s.db.Exec(`INSERT INTO content_workflows (
      id, user_id, module_key, record_key, title, status, current_step, state,
      schema_version, revision, completed_at, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
    ON CONFLICT(user_id, module_key, record_key) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      current_step = excluded.current_step,
      state = excluded.state,
      schema_version = excluded.schema_version,
      revision = content_workflows.revision + 1,
      completed_at = excluded.completed_at,
      deleted_at = NULL,
      updated_at = excluded.updated_at`,
		item.ID, item.UserID, item.ModuleKey, item.RecordKey, item.Title, item.Status,
		item.CurrentStep, encodeJSON(item.State), item.SchemaVersion, item.CompletedAt, now, now)
	if err != nil {
		return ContentWorkflow{}, err
	}
	result, found, err := s.FindContentWorkflowByRecord(item.UserID, item.ModuleKey, item.RecordKey)
	if err != nil {
		return ContentWorkflow{}, err
	}
	if !found {
		return ContentWorkflow{}, errors.New("工作流保存失败")
	}
	return result, nil
}

func (s *Store) FindContentWorkflow(id, userID string) (ContentWorkflow, bool, error) {
	row := s.db.QueryRow(contentWorkflowSelect+` WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, id, userID)
	return scanContentWorkflow(row)
}

func (s *Store) FindContentWorkflowByRecord(userID, moduleKey, recordKey string) (ContentWorkflow, bool, error) {
	row := s.db.QueryRow(contentWorkflowSelect+` WHERE user_id = ? AND module_key = ? AND record_key = ? AND deleted_at IS NULL`, userID, moduleKey, recordKey)
	return scanContentWorkflow(row)
}

func (s *Store) ListContentWorkflows(userID, moduleKey string, limit int) ([]ContentWorkflow, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := contentWorkflowSelect + ` WHERE user_id = ? AND deleted_at IS NULL`
	args := []any{userID}
	if strings.TrimSpace(moduleKey) != "" {
		query += ` AND module_key = ?`
		args = append(args, strings.TrimSpace(moduleKey))
	}
	query += ` ORDER BY updated_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ContentWorkflow{}
	for rows.Next() {
		item, _, scanErr := scanContentWorkflow(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) DeleteContentWorkflow(id, userID string) (bool, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE content_workflows SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, now, now, id, userID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

const contentWorkflowSelect = `SELECT id, user_id, module_key, record_key, title, status, current_step, state, schema_version, revision, completed_at, deleted_at, created_at, updated_at FROM content_workflows`

func scanContentWorkflow(scanner rowScanner) (ContentWorkflow, bool, error) {
	var item ContentWorkflow
	var state string
	var completedAt, deletedAt sql.NullString
	err := scanner.Scan(&item.ID, &item.UserID, &item.ModuleKey, &item.RecordKey, &item.Title, &item.Status, &item.CurrentStep, &state, &item.SchemaVersion, &item.Revision, &completedAt, &deletedAt, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ContentWorkflow{}, false, nil
	}
	if err != nil {
		return ContentWorkflow{}, false, err
	}
	item.State = decodeObject(state)
	item.CompletedAt = nullStringPointer(completedAt)
	item.DeletedAt = nullStringPointer(deletedAt)
	return item, true, nil
}
