package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type AssetExtraction struct {
	ID              string         `json:"id"`
	AssetID         string         `json:"assetId"`
	UserID          string         `json:"userId"`
	Parser          string         `json:"parser"`
	ParserVersion   string         `json:"parserVersion"`
	OptionsHash     string         `json:"optionsHash"`
	ContentHash     string         `json:"contentHash,omitempty"`
	Status          string         `json:"status"`
	Result          map[string]any `json:"result"`
	DerivedAssetIDs []string       `json:"derivedAssetIds"`
	ErrorCode       *string        `json:"errorCode,omitempty"`
	ErrorMessage    *string        `json:"errorMessage,omitempty"`
	StartedAt       *string        `json:"startedAt,omitempty"`
	CompletedAt     *string        `json:"completedAt,omitempty"`
	CreatedAt       string         `json:"createdAt"`
	UpdatedAt       string         `json:"updatedAt"`
}

func (s *Store) CreateAssetExtraction(item AssetExtraction) (AssetExtraction, error) {
	if item.ID == "" {
		item.ID = mustRandomID()
	}
	item.AssetID = strings.TrimSpace(item.AssetID)
	item.UserID = strings.TrimSpace(item.UserID)
	item.Parser = strings.TrimSpace(item.Parser)
	item.ParserVersion = strings.TrimSpace(item.ParserVersion)
	if item.OptionsHash == "" {
		item.OptionsHash = "default"
	}
	if item.Status == "" {
		item.Status = "queued"
	}
	if item.Result == nil {
		item.Result = map[string]any{}
	}
	if item.DerivedAssetIDs == nil {
		item.DerivedAssetIDs = []string{}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	item.CreatedAt = now
	item.UpdatedAt = now
	_, err := s.db.Exec(`INSERT INTO asset_extractions (id, asset_id, user_id, parser, parser_version, options_hash, content_hash, status, result, derived_asset_ids, error_code, error_message, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`, item.ID, item.AssetID, item.UserID, item.Parser, item.ParserVersion, item.OptionsHash, item.ContentHash, item.Status, encodeJSON(item.Result), encodeJSON(item.DerivedAssetIDs), now, now)
	if err != nil {
		return AssetExtraction{}, err
	}
	return item, nil
}

func (s *Store) FindAssetExtraction(id, userID string) (AssetExtraction, bool, error) {
	row := s.db.QueryRow(`SELECT id, asset_id, user_id, parser, parser_version, options_hash, content_hash, status, result, derived_asset_ids, error_code, error_message, started_at, completed_at, created_at, updated_at FROM asset_extractions WHERE id = ? AND user_id = ?`, id, userID)
	return scanAssetExtraction(row)
}

func (s *Store) FindLatestAssetExtraction(assetID, userID string) (AssetExtraction, bool, error) {
	row := s.db.QueryRow(`SELECT id, asset_id, user_id, parser, parser_version, options_hash, content_hash, status, result, derived_asset_ids, error_code, error_message, started_at, completed_at, created_at, updated_at FROM asset_extractions WHERE asset_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`, assetID, userID)
	return scanAssetExtraction(row)
}

func (s *Store) FindLatestCompletedAssetExtraction(assetID, userID string) (AssetExtraction, bool, error) {
	row := s.db.QueryRow(`SELECT id, asset_id, user_id, parser, parser_version, options_hash, content_hash, status, result, derived_asset_ids, error_code, error_message, started_at, completed_at, created_at, updated_at FROM asset_extractions WHERE asset_id = ? AND user_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`, assetID, userID)
	return scanAssetExtraction(row)
}

func scanAssetExtraction(scanner rowScanner) (AssetExtraction, bool, error) {
	var item AssetExtraction
	var result, derivedAssetIDs string
	var errorCode, errorMessage, startedAt, completedAt sql.NullString
	if err := scanner.Scan(&item.ID, &item.AssetID, &item.UserID, &item.Parser, &item.ParserVersion, &item.OptionsHash, &item.ContentHash, &item.Status, &result, &derivedAssetIDs, &errorCode, &errorMessage, &startedAt, &completedAt, &item.CreatedAt, &item.UpdatedAt); errors.Is(err, sql.ErrNoRows) {
		return AssetExtraction{}, false, nil
	} else if err != nil {
		return AssetExtraction{}, false, err
	}
	item.Result = decodeObject(result)
	_ = json.Unmarshal([]byte(derivedAssetIDs), &item.DerivedAssetIDs)
	if item.DerivedAssetIDs == nil {
		item.DerivedAssetIDs = []string{}
	}
	item.ErrorCode = nullStringPointer(errorCode)
	item.ErrorMessage = nullStringPointer(errorMessage)
	item.StartedAt = nullStringPointer(startedAt)
	item.CompletedAt = nullStringPointer(completedAt)
	return item, true, nil
}

func (s *Store) MarkAssetExtractionRunning(id, userID, contentHash string) (AssetExtraction, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE asset_extractions SET status = 'running', content_hash = ?, error_code = NULL, error_message = NULL, started_at = COALESCE(started_at, ?), completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?`, strings.TrimSpace(contentHash), now, now, id, userID); err != nil {
		return AssetExtraction{}, err
	}
	item, found, err := s.FindAssetExtraction(id, userID)
	if err != nil {
		return AssetExtraction{}, err
	}
	if !found {
		return AssetExtraction{}, errors.New("解析任务不存在")
	}
	return item, nil
}

func (s *Store) CompleteAssetExtraction(id, userID string, result map[string]any, derivedAssetIDs []string) (AssetExtraction, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if result == nil {
		result = map[string]any{}
	}
	if derivedAssetIDs == nil {
		derivedAssetIDs = []string{}
	}
	if _, err := s.db.Exec(`UPDATE asset_extractions SET status = 'completed', result = ?, derived_asset_ids = ?, error_code = NULL, error_message = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, encodeJSON(result), encodeJSON(derivedAssetIDs), now, now, id, userID); err != nil {
		return AssetExtraction{}, err
	}
	item, found, err := s.FindAssetExtraction(id, userID)
	if err != nil {
		return AssetExtraction{}, err
	}
	if !found {
		return AssetExtraction{}, errors.New("解析任务不存在")
	}
	return item, nil
}

func (s *Store) FailAssetExtraction(id, userID, code, message string) (AssetExtraction, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE asset_extractions SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, strings.TrimSpace(code), strings.TrimSpace(message), now, now, id, userID); err != nil {
		return AssetExtraction{}, err
	}
	item, found, err := s.FindAssetExtraction(id, userID)
	if err != nil {
		return AssetExtraction{}, err
	}
	if !found {
		return AssetExtraction{}, errors.New("解析任务不存在")
	}
	return item, nil
}

func (s *Store) FailInterruptedAssetExtractions() error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.Exec(`UPDATE asset_extractions SET status = 'failed', error_code = 'service_restarted', error_message = '服务重启前解析任务未完成，请重新发起', completed_at = ?, updated_at = ? WHERE status IN ('queued', 'running')`, now, now)
	return err
}
