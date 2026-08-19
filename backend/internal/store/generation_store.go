package store

import (
	"database/sql"
	"errors"
	"time"
)

type GenerationJob struct {
	ID                 string         `json:"id"`
	UserID             string         `json:"userId"`
	Kind               string         `json:"kind"`
	SourceModule       string         `json:"sourceModule"`
	ConversationID     *string        `json:"conversationId"`
	UserMessageID      *string        `json:"userMessageId"`
	AssistantMessageID *string        `json:"assistantMessageId"`
	Status             string         `json:"status"`
	ExpectedCount      int            `json:"expectedCount"`
	CompletedCount     int            `json:"completedCount"`
	FailedCount        int            `json:"failedCount"`
	Payload            map[string]any `json:"payload"`
	Result             map[string]any `json:"result"`
	Error              *string        `json:"error"`
	CreatedAt          string         `json:"createdAt"`
	UpdatedAt          string         `json:"updatedAt"`
}

type GenerationJobItem struct {
	ID           string         `json:"id"`
	JobID        string         `json:"jobId"`
	SlotIndex    int            `json:"slotIndex"`
	Status       string         `json:"status"`
	Input        map[string]any `json:"input"`
	AttachmentID *string        `json:"attachmentId"`
	Error        *string        `json:"error"`
	StartedAt    *string        `json:"startedAt"`
	CompletedAt  *string        `json:"completedAt"`
	UpdatedAt    string         `json:"updatedAt"`
}

func (s *Store) CreateGenerationJob(userID, kind, sourceModule string, expected int, payload map[string]any, conversationID, userMessageID, assistantMessageID *string) (GenerationJob, error) {
	if expected < 1 {
		expected = 1
	}
	if payload == nil {
		payload = map[string]any{}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	item := GenerationJob{ID: mustRandomID(), UserID: userID, Kind: kind, SourceModule: sourceModule, ConversationID: conversationID, UserMessageID: userMessageID, AssistantMessageID: assistantMessageID, Status: "queued", ExpectedCount: expected, Payload: payload, Result: map[string]any{}, CreatedAt: now, UpdatedAt: now}
	tx, err := s.db.Begin()
	if err != nil {
		return GenerationJob{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO generation_jobs (id, user_id, kind, source_module, conversation_id, user_message_id, assistant_message_id, status, expected_count, completed_count, failed_count, payload, result, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.ID, item.UserID, item.Kind, item.SourceModule, nullableStringValue(item.ConversationID), nullableStringValue(item.UserMessageID), nullableStringValue(item.AssistantMessageID), item.Status, item.ExpectedCount, 0, 0, encodeJSON(item.Payload), encodeJSON(item.Result), nil, item.CreatedAt, item.UpdatedAt); err != nil {
		return GenerationJob{}, err
	}
	for index := 0; index < expected; index++ {
		if _, err := tx.Exec(`INSERT INTO generation_job_items (id, job_id, slot_index, status, input, attachment_id, error, started_at, completed_at, updated_at) VALUES (?, ?, ?, 'queued', '{}', NULL, NULL, NULL, NULL, ?)`, mustRandomID(), item.ID, index, now); err != nil {
			return GenerationJob{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return GenerationJob{}, err
	}
	return item, nil
}

func (s *Store) FindGenerationJob(id, userID string) (GenerationJob, bool, error) {
	row := s.db.QueryRow(`SELECT id, user_id, kind, source_module, conversation_id, user_message_id, assistant_message_id, status, expected_count, completed_count, failed_count, payload, result, error, created_at, updated_at FROM generation_jobs WHERE id = ? AND user_id = ?`, id, userID)
	return scanGenerationJob(row)
}

func scanGenerationJob(scanner rowScanner) (GenerationJob, bool, error) {
	var item GenerationJob
	var conversationID, userMessageID, assistantMessageID, errorMessage sql.NullString
	var payload, result string
	if err := scanner.Scan(&item.ID, &item.UserID, &item.Kind, &item.SourceModule, &conversationID, &userMessageID, &assistantMessageID, &item.Status, &item.ExpectedCount, &item.CompletedCount, &item.FailedCount, &payload, &result, &errorMessage, &item.CreatedAt, &item.UpdatedAt); errors.Is(err, sql.ErrNoRows) {
		return GenerationJob{}, false, nil
	} else if err != nil {
		return GenerationJob{}, false, err
	}
	item.ConversationID = nullStringPointer(conversationID)
	item.UserMessageID = nullStringPointer(userMessageID)
	item.AssistantMessageID = nullStringPointer(assistantMessageID)
	item.Error = nullStringPointer(errorMessage)
	item.Payload = decodeObject(payload)
	item.Result = decodeObject(result)
	return item, true, nil
}

func (s *Store) ListGenerationItems(jobID string) ([]GenerationJobItem, error) {
	rows, err := s.db.Query(`SELECT id, job_id, slot_index, status, input, attachment_id, error, started_at, completed_at, updated_at FROM generation_job_items WHERE job_id = ? ORDER BY slot_index ASC`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []GenerationJobItem{}
	for rows.Next() {
		var item GenerationJobItem
		var input string
		var attachmentID, errorMessage, started, completed sql.NullString
		if err := rows.Scan(&item.ID, &item.JobID, &item.SlotIndex, &item.Status, &input, &attachmentID, &errorMessage, &started, &completed, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Input = decodeObject(input)
		item.AttachmentID = nullStringPointer(attachmentID)
		item.Error = nullStringPointer(errorMessage)
		item.StartedAt = nullStringPointer(started)
		item.CompletedAt = nullStringPointer(completed)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) MarkGenerationJobRunning(id, userID string) (GenerationJob, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE generation_jobs SET status = 'running', updated_at = ? WHERE id = ? AND user_id = ?`, now, id, userID); err != nil {
		return GenerationJob{}, err
	}
	if _, err := s.db.Exec(`UPDATE generation_job_items SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE job_id = ? AND status = 'queued'`, now, now, id); err != nil {
		return GenerationJob{}, err
	}
	item, found, err := s.FindGenerationJob(id, userID)
	if err != nil {
		return GenerationJob{}, err
	}
	if !found {
		return GenerationJob{}, errors.New("任务不存在")
	}
	return item, nil
}

func (s *Store) UpdateGenerationItem(jobID string, slotIndex int, status string, attachmentID *string, message *string) (GenerationJob, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE generation_job_items SET status = ?, attachment_id = ?, error = ?, started_at = COALESCE(started_at, ?), completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END, updated_at = ? WHERE job_id = ? AND slot_index = ?`, status, nullableStringValue(attachmentID), nullableStringValue(message), now, status, now, now, jobID, slotIndex); err != nil {
		return GenerationJob{}, err
	}
	if err := s.recountGenerationJob(jobID, "", nil); err != nil {
		return GenerationJob{}, err
	}
	return s.findGenerationJobAnyUser(jobID)
}

func (s *Store) FinalizeGenerationJob(id, userID, status string, result map[string]any, message *string) (GenerationJob, error) {
	if status == "" {
		status = "completed"
	}
	if result == nil {
		result = map[string]any{}
	}
	if _, err := s.db.Exec(`UPDATE generation_jobs SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ? AND user_id = ?`, status, encodeJSON(result), nullableStringValue(message), time.Now().UTC().Format(time.RFC3339Nano), id, userID); err != nil {
		return GenerationJob{}, err
	}
	item, found, err := s.FindGenerationJob(id, userID)
	if err != nil {
		return GenerationJob{}, err
	}
	if !found {
		return GenerationJob{}, errors.New("任务不存在")
	}
	return item, nil
}

func (s *Store) recountGenerationJob(jobID, status string, message *string) error {
	var completed, failed, total int
	if err := s.db.QueryRow(`SELECT SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), COUNT(*) FROM generation_job_items WHERE job_id = ?`, jobID).Scan(&completed, &failed, &total); err != nil {
		return err
	}
	if status == "" && completed+failed >= total && total > 0 {
		if failed == 0 {
			status = "completed"
		} else if completed > 0 {
			status = "partial_failed"
		} else {
			status = "failed"
		}
	}
	if status == "" {
		status = "running"
	}
	_, err := s.db.Exec(`UPDATE generation_jobs SET status = ?, completed_count = ?, failed_count = ?, expected_count = ?, error = ?, updated_at = ? WHERE id = ?`, status, completed, failed, total, nullableStringValue(message), time.Now().UTC().Format(time.RFC3339Nano), jobID)
	return err
}

func (s *Store) findGenerationJobAnyUser(id string) (GenerationJob, error) {
	row := s.db.QueryRow(`SELECT id, user_id, kind, source_module, conversation_id, user_message_id, assistant_message_id, status, expected_count, completed_count, failed_count, payload, result, error, created_at, updated_at FROM generation_jobs WHERE id = ?`, id)
	item, found, err := scanGenerationJob(row)
	if err != nil {
		return GenerationJob{}, err
	}
	if !found {
		return GenerationJob{}, errors.New("任务不存在")
	}
	return item, nil
}
