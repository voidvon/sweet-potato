package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type TalkingVideoHistory struct {
	ID              string         `json:"id"`
	Status          string         `json:"status"`
	Phase           string         `json:"phase"`
	Reasoning       string         `json:"reasoning"`
	Prompt          string         `json:"prompt"`
	ErrorMessage    string         `json:"errorMessage"`
	Metrics         map[string]any `json:"metrics"`
	ServerTimings   map[string]any `json:"serverTimings"`
	SourceVideo     map[string]any `json:"sourceVideo"`
	ReferenceImages []any          `json:"referenceImages"`
	DeepThink       bool           `json:"deepThink"`
	CreatedAt       string         `json:"createdAt"`
	UpdatedAt       string         `json:"updatedAt"`
}

func (s *Store) ListTalkingVideoHistory(userID string, limit int) ([]TalkingVideoHistory, error) {
	if limit < 1 || limit > 10 {
		limit = 10
	}
	rows, err := s.db.Query(`SELECT id, status, phase, reasoning, prompt, error_message, metrics, server_timings, source_video, reference_images, deep_think, created_at, updated_at FROM talking_video_prompt_history WHERE user_id = ? ORDER BY created_at DESC, updated_at DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []TalkingVideoHistory{}
	for rows.Next() {
		item, _, err := scanTalkingVideoHistory(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) FindTalkingVideoHistory(id, userID string) (TalkingVideoHistory, bool, error) {
	row := s.db.QueryRow(`SELECT id, status, phase, reasoning, prompt, error_message, metrics, server_timings, source_video, reference_images, deep_think, created_at, updated_at FROM talking_video_prompt_history WHERE id = ? AND user_id = ?`, id, userID)
	return scanTalkingVideoHistory(row)
}

func scanTalkingVideoHistory(scanner rowScanner) (TalkingVideoHistory, bool, error) {
	var item TalkingVideoHistory
	var metrics, timings, source, images string
	var deepThink int
	if err := scanner.Scan(&item.ID, &item.Status, &item.Phase, &item.Reasoning, &item.Prompt, &item.ErrorMessage, &metrics, &timings, &source, &images, &deepThink, &item.CreatedAt, &item.UpdatedAt); errors.Is(err, sql.ErrNoRows) {
		return TalkingVideoHistory{}, false, nil
	} else if err != nil {
		return TalkingVideoHistory{}, false, err
	}
	item.Metrics = decodeObject(metrics)
	item.ServerTimings = decodeObject(timings)
	item.SourceVideo = decodeObject(source)
	item.ReferenceImages = decodeJSONAnyList(images)
	item.DeepThink = deepThink != 0
	return item, true, nil
}

func (s *Store) UpsertTalkingVideoHistory(userID string, item TalkingVideoHistory) (TalkingVideoHistory, error) {
	if item.ID == "" {
		item.ID = mustRandomID()
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if item.CreatedAt == "" {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	if item.Metrics == nil {
		item.Metrics = map[string]any{}
	}
	if item.ServerTimings == nil {
		item.ServerTimings = map[string]any{}
	}
	if item.SourceVideo == nil {
		item.SourceVideo = map[string]any{}
	}
	if item.ReferenceImages == nil {
		item.ReferenceImages = []any{}
	}
	_, err := s.db.Exec(`INSERT INTO talking_video_prompt_history (id, user_id, status, phase, reasoning, prompt, error_message, metrics, server_timings, source_video, reference_images, deep_think, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, status = excluded.status, phase = excluded.phase, reasoning = excluded.reasoning, prompt = excluded.prompt, error_message = excluded.error_message, metrics = excluded.metrics, server_timings = excluded.server_timings, source_video = excluded.source_video, reference_images = excluded.reference_images, deep_think = excluded.deep_think, updated_at = excluded.updated_at WHERE talking_video_prompt_history.user_id = excluded.user_id`, item.ID, userID, item.Status, item.Phase, item.Reasoning, item.Prompt, item.ErrorMessage, encodeJSON(item.Metrics), encodeJSON(item.ServerTimings), encodeJSON(item.SourceVideo), encodeJSON(item.ReferenceImages), boolInt(item.DeepThink), item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return TalkingVideoHistory{}, err
	}
	_, found, err := s.FindTalkingVideoHistory(item.ID, userID)
	if err != nil {
		return TalkingVideoHistory{}, err
	}
	if !found {
		return TalkingVideoHistory{}, errors.New("口播任务保存失败")
	}
	return item, nil
}

func (s *Store) UpdateTalkingVideoHistory(userID, id string, patch TalkingVideoHistory) (TalkingVideoHistory, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE talking_video_prompt_history SET status = ?, phase = ?, reasoning = ?, prompt = ?, error_message = ?, metrics = ?, server_timings = ?, updated_at = ? WHERE id = ? AND user_id = ?`, patch.Status, patch.Phase, patch.Reasoning, patch.Prompt, patch.ErrorMessage, encodeJSON(patch.Metrics), encodeJSON(patch.ServerTimings), now, id, userID)
	if err != nil {
		return TalkingVideoHistory{}, false, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return TalkingVideoHistory{}, false, nil
	}
	return s.FindTalkingVideoHistory(id, userID)
}

func decodeJSONAnyList(value string) []any {
	var result []any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return []any{}
	}
	return result
}
