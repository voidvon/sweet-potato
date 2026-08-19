package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type BatchSheet struct {
	ID            string         `json:"id"`
	UserID        string         `json:"userId"`
	Name          string         `json:"name"`
	CapabilityKey string         `json:"capabilityKey"`
	MediaKind     string         `json:"mediaKind"`
	GlobalParams  map[string]any `json:"globalParams"`
	SchemaVersion int            `json:"schemaVersion"`
	SortOrder     int            `json:"sortOrder"`
	Revision      int            `json:"revision"`
	CreatedAt     string         `json:"createdAt"`
	UpdatedAt     string         `json:"updatedAt"`
}

type BatchSheetSummary struct {
	BatchSheet
	RowCount       int `json:"rowCount"`
	CompletedCount int `json:"completedCount"`
	FailedCount    int `json:"failedCount"`
	RunningCount   int `json:"runningCount"`
}

type BatchRow struct {
	ID               string         `json:"id"`
	SheetID          string         `json:"sheetId"`
	Position         int            `json:"position"`
	Params           map[string]any `json:"params"`
	ValidationStatus string         `json:"validationStatus"`
	ValidationErrors []string       `json:"validationErrors"`
	ExecutionStatus  string         `json:"executionStatus"`
	LatestAttemptID  *string        `json:"latestAttemptId"`
	ActualCredits    float64        `json:"actualCredits"`
	Revision         int            `json:"revision"`
	CreatedAt        string         `json:"createdAt"`
	UpdatedAt        string         `json:"updatedAt"`
}

type BatchRun struct {
	ID               string  `json:"id"`
	SheetID          string  `json:"sheetId"`
	UserID           string  `json:"userId"`
	Status           string  `json:"status"`
	TotalCount       int     `json:"totalCount"`
	CompletedCount   int     `json:"completedCount"`
	FailedCount      int     `json:"failedCount"`
	EstimatedCredits float64 `json:"estimatedCredits"`
	ActualCredits    float64 `json:"actualCredits"`
	CreatedAt        string  `json:"createdAt"`
	StartedAt        *string `json:"startedAt"`
	CompletedAt      *string `json:"completedAt"`
	UpdatedAt        string  `json:"updatedAt"`
}

type BatchAttempt struct {
	ID                  string         `json:"id"`
	RunID               string         `json:"runId"`
	RowID               string         `json:"rowId"`
	AttemptNo           int            `json:"attemptNo"`
	Status              string         `json:"status"`
	EffectiveParams     map[string]any `json:"effectiveParams"`
	ModelConfigSnapshot map[string]any `json:"modelConfigSnapshot"`
	GenerationJobID     *string        `json:"generationJobId"`
	EstimatedCredits    float64        `json:"estimatedCredits"`
	ActualCredits       float64        `json:"actualCredits"`
	ErrorCode           *string        `json:"errorCode"`
	ErrorMessage        *string        `json:"errorMessage"`
	QueuedAt            string         `json:"queuedAt"`
	StartedAt           *string        `json:"startedAt"`
	CompletedAt         *string        `json:"completedAt"`
	UpdatedAt           string         `json:"updatedAt"`
}

type BatchOutput struct {
	ID        string         `json:"id"`
	AttemptID string         `json:"attemptId"`
	SlotIndex int            `json:"slotIndex"`
	AssetID   string         `json:"assetId"`
	MediaKind string         `json:"mediaKind"`
	Metadata  map[string]any `json:"metadata"`
	CreatedAt string         `json:"createdAt"`
}

type BatchAttemptDetail struct {
	BatchAttempt
	Outputs []BatchOutput `json:"outputs"`
}

type BatchRunDetail struct {
	BatchRun
	Attempts []BatchAttemptDetail `json:"attempts"`
}

type BatchSheetDetail struct {
	Sheet          BatchSheet           `json:"sheet"`
	Rows           []BatchRow           `json:"rows"`
	LatestAttempts []BatchAttemptDetail `json:"latestAttempts"`
	Stats          map[string]any       `json:"stats"`
}

func (s *Store) ListBatchSheets(userID string) ([]BatchSheetSummary, error) {
	rows, err := s.db.Query(`
SELECT sh.id, sh.user_id, sh.name, sh.capability_key, sh.media_kind, sh.global_params,
       sh.schema_version, sh.sort_order, sh.revision, sh.created_at, sh.updated_at,
       COUNT(r.id),
       SUM(CASE WHEN r.execution_status = 'completed' THEN 1 ELSE 0 END),
       SUM(CASE WHEN r.execution_status IN ('failed', 'partial_failed') THEN 1 ELSE 0 END),
       SUM(CASE WHEN r.execution_status IN ('queued', 'running') THEN 1 ELSE 0 END)
FROM batch_generation_sheets sh
LEFT JOIN batch_generation_rows r ON r.sheet_id = sh.id
WHERE sh.user_id = ?
GROUP BY sh.id
ORDER BY sh.sort_order ASC, sh.created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BatchSheetSummary{}
	for rows.Next() {
		var item BatchSheetSummary
		var params string
		if err := rows.Scan(&item.ID, &item.UserID, &item.Name, &item.CapabilityKey, &item.MediaKind, &params, &item.SchemaVersion, &item.SortOrder, &item.Revision, &item.CreatedAt, &item.UpdatedAt, &item.RowCount, &item.CompletedCount, &item.FailedCount, &item.RunningCount); err != nil {
			return nil, err
		}
		item.GlobalParams = decodeObject(params)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) FindBatchSheet(id, userID string) (BatchSheet, bool, error) {
	row := s.db.QueryRow(`SELECT id, user_id, name, capability_key, media_kind, global_params, schema_version, sort_order, revision, created_at, updated_at FROM batch_generation_sheets WHERE id = ? AND user_id = ?`, id, userID)
	var item BatchSheet
	var params string
	if err := row.Scan(&item.ID, &item.UserID, &item.Name, &item.CapabilityKey, &item.MediaKind, &params, &item.SchemaVersion, &item.SortOrder, &item.Revision, &item.CreatedAt, &item.UpdatedAt); errors.Is(err, sql.ErrNoRows) {
		return BatchSheet{}, false, nil
	} else if err != nil {
		return BatchSheet{}, false, err
	}
	item.GlobalParams = decodeObject(params)
	return item, true, nil
}

func (s *Store) CreateBatchSheet(item BatchSheet) (BatchSheet, error) {
	if item.ID == "" {
		item.ID = mustRandomID()
	}
	if item.CreatedAt == "" {
		item.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if item.UpdatedAt == "" {
		item.UpdatedAt = item.CreatedAt
	}
	if item.GlobalParams == nil {
		item.GlobalParams = map[string]any{}
	}
	if item.SchemaVersion < 1 {
		item.SchemaVersion = 1
	}
	if item.Revision < 1 {
		item.Revision = 1
	}
	_, err := s.db.Exec(`INSERT INTO batch_generation_sheets (id, user_id, name, capability_key, media_kind, global_params, schema_version, sort_order, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.ID, item.UserID, item.Name, item.CapabilityKey, item.MediaKind, encodeJSON(item.GlobalParams), item.SchemaVersion, item.SortOrder, item.Revision, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return BatchSheet{}, err
	}
	return item, nil
}

func (s *Store) UpdateBatchSheet(item BatchSheet, expectedRevision int) (BatchSheet, bool, error) {
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE batch_generation_sheets SET name = ?, global_params = ?, sort_order = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?`, item.Name, encodeJSON(item.GlobalParams), item.SortOrder, item.UpdatedAt, item.ID, item.UserID, expectedRevision)
	if err != nil {
		return BatchSheet{}, false, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return BatchSheet{}, false, nil
	}
	updated, found, err := s.FindBatchSheet(item.ID, item.UserID)
	return updated, found, err
}

func (s *Store) DeleteBatchSheet(id, userID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM batch_generation_sheets WHERE id = ? AND user_id = ?`, id, userID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return errors.New("表格不存在")
	}
	for _, query := range []string{
		`DELETE FROM batch_generation_outputs WHERE attempt_id IN (SELECT id FROM batch_generation_attempts WHERE run_id IN (SELECT id FROM batch_generation_runs WHERE sheet_id = ?))`,
		`DELETE FROM batch_generation_attempts WHERE run_id IN (SELECT id FROM batch_generation_runs WHERE sheet_id = ?)`,
		`DELETE FROM batch_generation_runs WHERE sheet_id = ?`,
		`DELETE FROM batch_generation_rows WHERE sheet_id = ?`,
		`DELETE FROM batch_generation_sheets WHERE id = ? AND user_id = ?`,
	} {
		if query == `DELETE FROM batch_generation_sheets WHERE id = ? AND user_id = ?` {
			if _, err := tx.Exec(query, id, userID); err != nil {
				return err
			}
		} else if _, err := tx.Exec(query, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListBatchRows(sheetID string) ([]BatchRow, error) {
	rows, err := s.db.Query(`SELECT id, sheet_id, position, params, validation_status, validation_errors, execution_status, latest_attempt_id, actual_credits, revision, created_at, updated_at FROM batch_generation_rows WHERE sheet_id = ? ORDER BY position ASC`, sheetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BatchRow{}
	for rows.Next() {
		var item BatchRow
		var params, validationErrors string
		var latest sql.NullString
		if err := rows.Scan(&item.ID, &item.SheetID, &item.Position, &params, &item.ValidationStatus, &validationErrors, &item.ExecutionStatus, &latest, &item.ActualCredits, &item.Revision, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Params = decodeObject(params)
		item.ValidationErrors = decodeStringList(validationErrors)
		if latest.Valid {
			item.LatestAttemptID = &latest.String
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) FindBatchRow(id, sheetID string) (BatchRow, bool, error) {
	rows, err := s.ListBatchRows(sheetID)
	if err != nil {
		return BatchRow{}, false, err
	}
	for _, item := range rows {
		if item.ID == id {
			return item, true, nil
		}
	}
	return BatchRow{}, false, nil
}

func (s *Store) AddBatchRows(sheetID string, items []BatchRow, insertAt int) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE batch_generation_rows SET position = position + ? WHERE sheet_id = ? AND position >= ?`, len(items), sheetID, insertAt); err != nil {
		return err
	}
	for index, item := range items {
		if item.ID == "" {
			item.ID = mustRandomID()
		}
		if item.CreatedAt == "" {
			item.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		}
		if item.UpdatedAt == "" {
			item.UpdatedAt = item.CreatedAt
		}
		if item.Params == nil {
			item.Params = map[string]any{}
		}
		if item.ValidationErrors == nil {
			item.ValidationErrors = []string{}
		}
		if item.Revision < 1 {
			item.Revision = 1
		}
		if _, err := tx.Exec(`INSERT INTO batch_generation_rows (id, sheet_id, position, params, validation_status, validation_errors, execution_status, latest_attempt_id, actual_credits, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.ID, sheetID, insertAt+index, encodeJSON(item.Params), "draft", encodeJSON(item.ValidationErrors), "idle", nil, 0, item.Revision, item.CreatedAt, item.UpdatedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) UpdateBatchRow(item BatchRow, expectedRevision int) (BatchRow, bool, error) {
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE batch_generation_rows SET params = ?, validation_status = ?, validation_errors = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND sheet_id = ? AND revision = ?`, encodeJSON(item.Params), item.ValidationStatus, encodeJSON(item.ValidationErrors), item.UpdatedAt, item.ID, item.SheetID, expectedRevision)
	if err != nil {
		return BatchRow{}, false, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return BatchRow{}, false, nil
	}
	return s.FindBatchRow(item.ID, item.SheetID)
}

func (s *Store) DeleteBatchRow(id, sheetID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var position int
	if err := tx.QueryRow(`SELECT position FROM batch_generation_rows WHERE id = ? AND sheet_id = ?`, id, sheetID).Scan(&position); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("表格行不存在")
		}
		return err
	}
	if _, err := tx.Exec(`DELETE FROM batch_generation_rows WHERE id = ? AND sheet_id = ?`, id, sheetID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE batch_generation_rows SET position = position - 1 WHERE sheet_id = ? AND position > ?`, sheetID, position); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CreateBatchRun(run BatchRun, attempts []BatchAttempt) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO batch_generation_runs (id, sheet_id, user_id, status, total_count, completed_count, failed_count, estimated_credits, actual_credits, created_at, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, run.ID, run.SheetID, run.UserID, run.Status, run.TotalCount, run.CompletedCount, run.FailedCount, run.EstimatedCredits, run.ActualCredits, run.CreatedAt, nullableStringValue(run.StartedAt), nullableStringValue(run.CompletedAt), run.UpdatedAt); err != nil {
		return err
	}
	for _, item := range attempts {
		if _, err := tx.Exec(`INSERT INTO batch_generation_attempts (id, run_id, row_id, attempt_no, status, effective_params, model_config_snapshot, generation_job_id, estimated_credits, actual_credits, error_code, error_message, queued_at, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item.ID, item.RunID, item.RowID, item.AttemptNo, item.Status, encodeJSON(item.EffectiveParams), encodeJSON(item.ModelConfigSnapshot), nullableStringValue(item.GenerationJobID), item.EstimatedCredits, item.ActualCredits, nullableStringValue(item.ErrorCode), nullableStringValue(item.ErrorMessage), item.QueuedAt, nullableStringValue(item.StartedAt), nullableStringValue(item.CompletedAt), item.UpdatedAt); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE batch_generation_rows SET execution_status = 'queued', latest_attempt_id = ?, updated_at = ? WHERE id = ? AND sheet_id = ?`, item.ID, item.UpdatedAt, item.RowID, run.SheetID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) FindBatchRun(id, userID string) (BatchRun, bool, error) {
	row := s.db.QueryRow(`SELECT id, sheet_id, user_id, status, total_count, completed_count, failed_count, estimated_credits, actual_credits, created_at, started_at, completed_at, updated_at FROM batch_generation_runs WHERE id = ? AND user_id = ?`, id, userID)
	return scanBatchRun(row)
}

func scanBatchRun(scanner rowScanner) (BatchRun, bool, error) {
	var item BatchRun
	var started, completed sql.NullString
	if err := scanner.Scan(&item.ID, &item.SheetID, &item.UserID, &item.Status, &item.TotalCount, &item.CompletedCount, &item.FailedCount, &item.EstimatedCredits, &item.ActualCredits, &item.CreatedAt, &started, &completed, &item.UpdatedAt); errors.Is(err, sql.ErrNoRows) {
		return BatchRun{}, false, nil
	} else if err != nil {
		return BatchRun{}, false, err
	}
	if started.Valid {
		item.StartedAt = &started.String
	}
	if completed.Valid {
		item.CompletedAt = &completed.String
	}
	return item, true, nil
}

func (s *Store) ListBatchRuns(sheetID, userID string) ([]BatchRun, error) {
	rows, err := s.db.Query(`SELECT id, sheet_id, user_id, status, total_count, completed_count, failed_count, estimated_credits, actual_credits, created_at, started_at, completed_at, updated_at FROM batch_generation_runs WHERE sheet_id = ? AND user_id = ? ORDER BY created_at DESC`, sheetID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BatchRun{}
	for rows.Next() {
		item, _, err := scanBatchRun(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) ListBatchAttempts(runID string) ([]BatchAttempt, error) {
	rows, err := s.db.Query(`SELECT id, run_id, row_id, attempt_no, status, effective_params, model_config_snapshot, generation_job_id, estimated_credits, actual_credits, error_code, error_message, queued_at, started_at, completed_at, updated_at FROM batch_generation_attempts WHERE run_id = ? ORDER BY row_id, attempt_no`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BatchAttempt{}
	for rows.Next() {
		item, err := scanBatchAttempt(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanBatchAttempt(scanner rowScanner) (BatchAttempt, error) {
	var item BatchAttempt
	var params, snapshot string
	var jobID, code, message, started, completed sql.NullString
	if err := scanner.Scan(&item.ID, &item.RunID, &item.RowID, &item.AttemptNo, &item.Status, &params, &snapshot, &jobID, &item.EstimatedCredits, &item.ActualCredits, &code, &message, &item.QueuedAt, &started, &completed, &item.UpdatedAt); err != nil {
		return BatchAttempt{}, err
	}
	item.EffectiveParams, item.ModelConfigSnapshot = decodeObject(params), decodeObject(snapshot)
	if jobID.Valid {
		item.GenerationJobID = &jobID.String
	}
	if code.Valid {
		item.ErrorCode = &code.String
	}
	if message.Valid {
		item.ErrorMessage = &message.String
	}
	if started.Valid {
		item.StartedAt = &started.String
	}
	if completed.Valid {
		item.CompletedAt = &completed.String
	}
	return item, nil
}

func (s *Store) ListBatchOutputs(attemptID string) ([]BatchOutput, error) {
	rows, err := s.db.Query(`SELECT id, attempt_id, slot_index, asset_id, media_kind, metadata, created_at FROM batch_generation_outputs WHERE attempt_id = ? ORDER BY slot_index ASC`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BatchOutput{}
	for rows.Next() {
		var item BatchOutput
		var metadata string
		if err := rows.Scan(&item.ID, &item.AttemptID, &item.SlotIndex, &item.AssetID, &item.MediaKind, &metadata, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Metadata = decodeObject(metadata)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) BatchRunDetail(id, userID string) (BatchRunDetail, bool, error) {
	run, found, err := s.FindBatchRun(id, userID)
	if err != nil || !found {
		return BatchRunDetail{}, found, err
	}
	attempts, err := s.ListBatchAttempts(id)
	if err != nil {
		return BatchRunDetail{}, false, err
	}
	detail := BatchRunDetail{BatchRun: run, Attempts: []BatchAttemptDetail{}}
	for _, attempt := range attempts {
		outputs, err := s.ListBatchOutputs(attempt.ID)
		if err != nil {
			return BatchRunDetail{}, false, err
		}
		detail.Attempts = append(detail.Attempts, BatchAttemptDetail{BatchAttempt: attempt, Outputs: outputs})
	}
	return detail, true, nil
}

func (s *Store) BatchSheetDetail(sheet BatchSheet) (BatchSheetDetail, error) {
	rows, err := s.ListBatchRows(sheet.ID)
	if err != nil {
		return BatchSheetDetail{}, err
	}
	latest := []BatchAttemptDetail{}
	for _, row := range rows {
		if row.LatestAttemptID == nil {
			continue
		}
		attemptRows, err := s.db.Query(`SELECT id, run_id, row_id, attempt_no, status, effective_params, model_config_snapshot, generation_job_id, estimated_credits, actual_credits, error_code, error_message, queued_at, started_at, completed_at, updated_at FROM batch_generation_attempts WHERE id = ?`, *row.LatestAttemptID)
		if err != nil {
			return BatchSheetDetail{}, err
		}
		if attemptRows.Next() {
			attempt, scanErr := scanBatchAttempt(attemptRows)
			attemptRows.Close()
			if scanErr != nil {
				return BatchSheetDetail{}, scanErr
			}
			outputs, outErr := s.ListBatchOutputs(attempt.ID)
			if outErr != nil {
				return BatchSheetDetail{}, outErr
			}
			latest = append(latest, BatchAttemptDetail{BatchAttempt: attempt, Outputs: outputs})
		} else {
			attemptRows.Close()
		}
	}
	stats := map[string]any{"total": len(rows), "completed": 0, "failed": 0, "queued": 0, "running": 0, "idle": 0, "actualCredits": float64(0)}
	for _, row := range rows {
		switch row.ExecutionStatus {
		case "completed":
			stats["completed"] = stats["completed"].(int) + 1
		case "failed", "partial_failed":
			stats["failed"] = stats["failed"].(int) + 1
		case "queued":
			stats["queued"] = stats["queued"].(int) + 1
		case "running":
			stats["running"] = stats["running"].(int) + 1
		default:
			stats["idle"] = stats["idle"].(int) + 1
		}
		stats["actualCredits"] = stats["actualCredits"].(float64) + row.ActualCredits
	}
	return BatchSheetDetail{Sheet: sheet, Rows: rows, LatestAttempts: latest, Stats: stats}, nil
}

func (s *Store) NextBatchAttemptNo(rowID string) (int, error) {
	var value int
	err := s.db.QueryRow(`SELECT COALESCE(MAX(attempt_no), 0) + 1 FROM batch_generation_attempts WHERE row_id = ?`, rowID).Scan(&value)
	return value, err
}

func (s *Store) MarkBatchRunRunning(id, userID string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.Exec(`UPDATE batch_generation_runs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND user_id = ?`, now, now, id, userID)
	return err
}

func (s *Store) MarkBatchAttemptRunning(id string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.Exec(`UPDATE batch_generation_attempts SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`, now, now, id)
	return err
}

func (s *Store) CompleteBatchAttempt(attemptID, rowID, runID string, status string, actualCredits float64, outputs []BatchOutput) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE batch_generation_attempts SET status = ?, actual_credits = ?, completed_at = ?, updated_at = ? WHERE id = ?`, status, actualCredits, now, now, attemptID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE batch_generation_rows SET execution_status = ?, actual_credits = ?, revision = revision + 1, updated_at = ? WHERE id = ?`, status, actualCredits, now, rowID); err != nil {
		return err
	}
	for _, output := range outputs {
		if _, err := tx.Exec(`INSERT INTO batch_generation_outputs (id, attempt_id, slot_index, asset_id, media_kind, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, output.ID, attemptID, output.SlotIndex, output.AssetID, output.MediaKind, encodeJSON(output.Metadata), now); err != nil {
			return err
		}
	}
	if err := recountBatchRunTx(tx, runID, now); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) FailBatchAttempt(attemptID, rowID, runID, code, message string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE batch_generation_attempts SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`, code, message, now, now, attemptID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE batch_generation_rows SET execution_status = 'failed', revision = revision + 1, updated_at = ? WHERE id = ?`, now, rowID); err != nil {
		return err
	}
	if err := recountBatchRunTx(tx, runID, now); err != nil {
		return err
	}
	return tx.Commit()
}

func recountBatchRunTx(tx *sql.Tx, runID, now string) error {
	var total, completed, failed, running, queued int
	if err := tx.QueryRow(`SELECT COUNT(*), SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), SUM(CASE WHEN status IN ('failed', 'partial_failed') THEN 1 ELSE 0 END), SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) FROM batch_generation_attempts WHERE run_id = ?`, runID).Scan(&total, &completed, &failed, &running, &queued); err != nil {
		return err
	}
	status := "running"
	var completedAt any
	if completed+failed >= total && total > 0 {
		if failed == 0 {
			status = "completed"
		} else if completed > 0 {
			status = "partial_failed"
		} else {
			status = "failed"
		}
		completedAt = now
	} else if running == 0 && queued > 0 {
		status = "queued"
	}
	_, err := tx.Exec(`UPDATE batch_generation_runs SET status = ?, total_count = ?, completed_count = ?, failed_count = ?, actual_credits = COALESCE((SELECT SUM(actual_credits) FROM batch_generation_attempts WHERE run_id = ?), 0), completed_at = ?, updated_at = ? WHERE id = ?`, status, total, completed, failed, runID, completedAt, now, runID)
	return err
}

func (s *Store) RecoverBatchRuns() ([]string, error) {
	rows, err := s.db.Query(`SELECT id FROM batch_generation_runs WHERE status IN ('queued', 'running')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func (s *Store) ResetBatchRunningAttempts(runID string) error {
	_, err := s.db.Exec(`UPDATE batch_generation_attempts SET status = 'queued', started_at = NULL, updated_at = ? WHERE run_id = ? AND status = 'running'`, time.Now().UTC().Format(time.RFC3339Nano), runID)
	return err
}

func decodeStringList(value string) []string {
	var raw []any
	if err := json.Unmarshal([]byte(value), &raw); err != nil || raw == nil {
		raw = []any{}
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		result = append(result, fmt.Sprint(item))
	}
	return result
}
