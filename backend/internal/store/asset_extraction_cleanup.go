package store

import (
	"database/sql"
	"fmt"
	"time"
)

const (
	assetExtractionStaleAfter          = 24 * time.Hour
	assetExtractionFailedRetention     = 7 * 24 * time.Hour
	assetExtractionCompletedRetention  = 30 * 24 * time.Hour
	assetExtractionMaxTerminalPerAsset = 3
)

type AssetExtractionCleanupStats struct {
	StaleFailed       int64 `json:"staleFailed"`
	OrphansDeleted    int64 `json:"orphansDeleted"`
	FailuresDeleted   int64 `json:"failuresDeleted"`
	SupersededDeleted int64 `json:"supersededDeleted"`
	HistoryCapDeleted int64 `json:"historyCapDeleted"`
}

func (s *Store) CleanupAssetExtractions(now time.Time) (AssetExtractionCleanupStats, error) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	now = now.UTC()
	stats := AssetExtractionCleanupStats{}
	tx, err := s.db.Begin()
	if err != nil {
		return stats, err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`UPDATE asset_extractions SET status = 'failed', error_code = 'task_timeout', error_message = '解析任务超过 24 小时未完成', completed_at = ?, updated_at = ? WHERE status IN ('queued', 'running') AND updated_at < ?`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Add(-assetExtractionStaleAfter).Format(time.RFC3339Nano))
	if err != nil {
		return stats, err
	}
	stats.StaleFailed, _ = result.RowsAffected()

	result, err = tx.Exec(`DELETE FROM asset_extractions WHERE NOT EXISTS (SELECT 1 FROM content_assets a WHERE a.id = asset_extractions.asset_id)`)
	if err != nil {
		return stats, err
	}
	stats.OrphansDeleted, _ = result.RowsAffected()

	result, err = tx.Exec(`DELETE FROM asset_extractions WHERE status = 'failed' AND completed_at IS NOT NULL AND completed_at < ?`, now.Add(-assetExtractionFailedRetention).Format(time.RFC3339Nano))
	if err != nil {
		return stats, err
	}
	stats.FailuresDeleted, _ = result.RowsAffected()

	result, err = tx.Exec(`DELETE FROM asset_extractions AS current WHERE current.status = 'completed' AND current.completed_at IS NOT NULL AND current.completed_at < ? AND current.id <> COALESCE((SELECT latest.id FROM asset_extractions AS latest WHERE latest.asset_id = current.asset_id AND latest.user_id = current.user_id AND latest.status = 'completed' ORDER BY latest.created_at DESC LIMIT 1), '')`, now.Add(-assetExtractionCompletedRetention).Format(time.RFC3339Nano))
	if err != nil {
		return stats, err
	}
	stats.SupersededDeleted, _ = result.RowsAffected()

	rows, err := tx.Query(`SELECT DISTINCT asset_id, user_id FROM asset_extractions WHERE status IN ('completed', 'failed')`)
	if err != nil {
		return stats, err
	}
	type owner struct{ assetID, userID string }
	owners := []owner{}
	for rows.Next() {
		var item owner
		if err := rows.Scan(&item.assetID, &item.userID); err != nil {
			rows.Close()
			return stats, err
		}
		owners = append(owners, item)
	}
	if err := rows.Close(); err != nil {
		return stats, err
	}
	for _, item := range owners {
		deleted, err := pruneAssetExtractionHistoryTx(tx, item.assetID, item.userID, assetExtractionMaxTerminalPerAsset)
		if err != nil {
			return stats, err
		}
		stats.HistoryCapDeleted += int64(deleted)
	}
	if err := tx.Commit(); err != nil {
		return stats, err
	}
	return stats, nil
}

func (s *Store) PruneAssetExtractionHistory(assetID, userID string, maxTerminal int) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	deleted, err := pruneAssetExtractionHistoryTx(tx, assetID, userID, maxTerminal)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return deleted, nil
}

func pruneAssetExtractionHistoryTx(tx *sql.Tx, assetID, userID string, maxTerminal int) (int, error) {
	if maxTerminal < 1 {
		maxTerminal = 1
	}
	rows, err := tx.Query(`SELECT id, status FROM asset_extractions WHERE asset_id = ? AND user_id = ? AND status IN ('completed', 'failed') ORDER BY created_at DESC`, assetID, userID)
	if err != nil {
		return 0, err
	}
	type record struct{ id, status string }
	records := []record{}
	for rows.Next() {
		var item record
		if err := rows.Scan(&item.id, &item.status); err != nil {
			rows.Close()
			return 0, err
		}
		records = append(records, item)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if len(records) <= maxTerminal {
		return 0, nil
	}
	keep := map[string]bool{}
	for _, item := range records {
		if item.status == "completed" {
			keep[item.id] = true
			break
		}
	}
	for _, item := range records {
		if len(keep) >= maxTerminal {
			break
		}
		keep[item.id] = true
	}
	deleted := 0
	for _, item := range records {
		if keep[item.id] {
			continue
		}
		result, err := tx.Exec(`DELETE FROM asset_extractions WHERE id = ?`, item.id)
		if err != nil {
			return deleted, fmt.Errorf("delete extraction history: %w", err)
		}
		count, _ := result.RowsAffected()
		deleted += int(count)
	}
	return deleted, nil
}
