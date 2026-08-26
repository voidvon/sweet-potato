package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var ErrInsufficientCredits = errors.New("积分余额不足")

type LLMUsageSettlement struct {
	ModelConfigID      string
	SourceType         string
	SourceID           string
	PromptTokens       int64
	CompletionTokens   int64
	CachedPromptTokens int64
	UsageRaw           map[string]any
	BillingSnapshot    map[string]any
}

// ReserveCredits atomically removes a provisional amount from the user's
// balance. The amount is returned by SettleLLMReservation after the provider
// reports actual usage, or restored by ReleaseCredits on failure.
func (s *Store) ReserveCredits(userID, sourceType, sourceID string, amount float64, snapshot map[string]any) (string, error) {
	if amount < 0 {
		amount = 0
	}
	snapshotJSON, _ := json.Marshal(snapshot)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	reservationID := mustRandomID()
	tx, err := s.db.Begin()
	if err != nil {
		return "", fmt.Errorf("begin credit reservation: %w", err)
	}
	defer tx.Rollback()
	var balance float64
	if err := tx.QueryRow(`SELECT credit_balance FROM users WHERE id = ?`, userID).Scan(&balance); err != nil {
		return "", fmt.Errorf("load credit balance: %w", err)
	}
	if balance+1e-9 < amount {
		return "", ErrInsufficientCredits
	}
	if _, err := tx.Exec(`UPDATE users SET credit_balance = credit_balance - ? WHERE id = ?`, amount, userID); err != nil {
		return "", fmt.Errorf("reserve credit balance: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO credit_reservations (id, user_id, source_type, source_id, reserved_credits, status, snapshot, created_at) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)`, reservationID, userID, sourceType, sourceID, amount, string(snapshotJSON), now); err != nil {
		return "", fmt.Errorf("create credit reservation: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO credit_ledger (id, user_id, type, credit_delta, credit_balance_after, source_type, source_id, snapshot, created_at) VALUES (?, ?, 'reservation', ?, ?, ?, ?, ?, ?)`, mustRandomID(), userID, -amount, balance-amount, sourceType, sourceID, string(snapshotJSON), now); err != nil {
		return "", fmt.Errorf("write reservation ledger: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit credit reservation: %w", err)
	}
	return reservationID, nil
}

func (s *Store) ReleaseCredits(reservationID, userID string) error {
	if reservationID == "" {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var amount float64
	var sourceType, sourceID, snapshot string
	if err := tx.QueryRow(`SELECT reserved_credits, source_type, source_id, snapshot FROM credit_reservations WHERE id = ? AND user_id = ? AND status = 'reserved'`, reservationID, userID).Scan(&amount, &sourceType, &sourceID, &snapshot); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	var balance float64
	if err := tx.QueryRow(`SELECT credit_balance FROM users WHERE id = ?`, userID).Scan(&balance); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`UPDATE users SET credit_balance = credit_balance + ? WHERE id = ?`, amount, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE credit_reservations SET status = 'released', settled_at = ? WHERE id = ?`, now, reservationID); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO credit_ledger (id, user_id, type, credit_delta, credit_balance_after, source_type, source_id, snapshot, created_at) VALUES (?, ?, 'reservation_release', ?, ?, ?, ?, ?, ?)`, mustRandomID(), userID, amount, balance+amount, sourceType, sourceID, snapshot, now); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SettleLLMReservation(reservationID, userID string, actual float64, usage LLMUsageSettlement) error {
	if actual < 0 {
		actual = 0
	}
	usageJSON, _ := json.Marshal(usage.UsageRaw)
	billingJSON, _ := json.Marshal(usage.BillingSnapshot)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var reserved float64
	var sourceType, sourceID, reservationSnapshot string
	if err := tx.QueryRow(`SELECT reserved_credits, source_type, source_id, snapshot FROM credit_reservations WHERE id = ? AND user_id = ? AND status = 'reserved'`, reservationID, userID).Scan(&reserved, &sourceType, &sourceID, &reservationSnapshot); err != nil {
		return err
	}
	var balance float64
	if err := tx.QueryRow(`SELECT credit_balance FROM users WHERE id = ?`, userID).Scan(&balance); err != nil {
		return err
	}
	delta := reserved - actual
	now := time.Now().UTC().Format(time.RFC3339Nano)
	finalBalance := balance + delta
	if _, err := tx.Exec(`UPDATE users SET credit_balance = ? WHERE id = ?`, finalBalance, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE credit_reservations SET status = 'settled', settled_at = ? WHERE id = ?`, now, reservationID); err != nil {
		return err
	}
	if reserved > 1e-9 {
		if _, err := tx.Exec(`INSERT INTO credit_ledger (id, user_id, type, credit_delta, credit_balance_after, source_type, source_id, snapshot, created_at) VALUES (?, ?, 'reservation_release', ?, ?, ?, ?, ?, ?)`, mustRandomID(), userID, reserved, balance+reserved, sourceType, sourceID, reservationSnapshot, now); err != nil {
			return err
		}
	}
	if actual > 1e-9 {
		if _, err := tx.Exec(`INSERT INTO credit_ledger (id, user_id, type, credit_delta, credit_balance_after, source_type, source_id, credit_base_cost, credit_billed_cost, snapshot, created_at) VALUES (?, ?, 'usage', ?, ?, ?, ?, ?, ?, ?, ?)`, mustRandomID(), userID, -actual, finalBalance, sourceType, sourceID, actual, actual, reservationSnapshot, now); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO llm_usage_records (id, user_id, model_config_id, source_type, source_id, prompt_tokens, completion_tokens, cached_prompt_tokens, usage_raw, billing_snapshot, credit_base_cost, credit_billed_cost, credit_cost, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'settled', ?)`, mustRandomID(), userID, usage.ModelConfigID, usage.SourceType, usage.SourceID, usage.PromptTokens, usage.CompletionTokens, usage.CachedPromptTokens, string(usageJSON), string(billingJSON), actual, actual, actual, now); err != nil {
		return err
	}
	return tx.Commit()
}
