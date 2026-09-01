package store

import (
	"errors"
	"math"
	"testing"
)

func TestLLMCreditReservationChecksThresholdAndSettlesActualUsage(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	user, err := dataStore.CreateUser("billing-user", "password123", "Billing User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := dataStore.AdjustCredits(user.ID, user.ID, 5); err != nil {
		t.Fatalf("add credits: %v", err)
	}
	if _, err := dataStore.ReserveCredits(user.ID, "chat_llm", "message-1", 6, nil); !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("reserve error = %v, want insufficient credits", err)
	}
	reservationID, err := dataStore.ReserveCredits(user.ID, "chat_llm", "message-1", 4, nil)
	if err != nil {
		t.Fatalf("reserve credits: %v", err)
	}
	if err := dataStore.SettleLLMReservation(reservationID, user.ID, 1.25, LLMUsageSettlement{
		ModelConfigID: "llm-1", SourceType: "chat_llm", SourceID: "message-1",
		PromptTokens: 100, CompletionTokens: 20,
	}); err != nil {
		t.Fatalf("settle credits: %v", err)
	}
	updated, found, err := dataStore.FindUserByID(user.ID)
	if err != nil || !found {
		t.Fatalf("reload user: found=%v err=%v", found, err)
	}
	if math.Abs(updated.CreditBalance-3.75) > 1e-9 {
		t.Fatalf("balance = %v, want 3.75", updated.CreditBalance)
	}
	totals, err := dataStore.creditSummary(user.ID)
	if err != nil {
		t.Fatalf("credit summary: %v", err)
	}
	if math.Abs(totals.recharge-5) > 1e-9 || math.Abs(totals.usage-1.25) > 1e-9 {
		t.Fatalf("summary = %#v, want recharge=5 usage=1.25", totals)
	}
	var usageCount int
	if err := dataStore.db.QueryRow(`SELECT COUNT(*) FROM llm_usage_records WHERE user_id = ? AND status = 'settled'`, user.ID).Scan(&usageCount); err != nil {
		t.Fatalf("count usage: %v", err)
	}
	if usageCount != 1 {
		t.Fatalf("usage count = %d, want 1", usageCount)
	}
	var ledgerType string
	var ledgerCount int
	if err := dataStore.db.QueryRow(`SELECT MIN(type), COUNT(*) FROM credit_ledger WHERE user_id = ? AND source_type = 'chat_llm'`, user.ID).Scan(&ledgerType, &ledgerCount); err != nil {
		t.Fatalf("load settled ledger: %v", err)
	}
	if ledgerType != "usage_debit" || ledgerCount != 1 {
		t.Fatalf("settled ledger type=%q count=%d, want usage_debit and 1", ledgerType, ledgerCount)
	}
}

func TestReleaseCreditsRestoresFailedLLMReservation(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	user, _ := dataStore.CreateUser("release-user", "password123", "Release User")
	_, _ = dataStore.AdjustCredits(user.ID, user.ID, 10)
	reservationID, err := dataStore.ReserveCredits(user.ID, "chat_llm", "message-2", 7, nil)
	if err != nil {
		t.Fatalf("reserve credits: %v", err)
	}
	if err := dataStore.ReleaseCredits(reservationID, user.ID); err != nil {
		t.Fatalf("release credits: %v", err)
	}
	updated, _, _ := dataStore.FindUserByID(user.ID)
	if updated.CreditBalance != 10 {
		t.Fatalf("balance = %v, want 10", updated.CreditBalance)
	}
	entries, err := dataStore.ListLedger(user.ID, 20)
	if err != nil {
		t.Fatalf("list ledger: %v", err)
	}
	for _, entry := range entries {
		if entry.SourceType != nil && *entry.SourceType == "chat_llm" {
			t.Fatalf("released reservation remained in user ledger: %#v", entry)
		}
	}
}

func TestBillableReservationSettlesActualSuccessfulQuantity(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	user, _ := dataStore.CreateUser("image-billing-user", "password123", "Image Billing User")
	_, _ = dataStore.AdjustCredits(user.ID, user.ID, 10)
	reservationID, err := dataStore.ReserveCredits(user.ID, "image_generation", "request-1", 4, map[string]any{"creditsPerRequest": 1, "expectedCount": 4})
	if err != nil {
		t.Fatalf("reserve credits: %v", err)
	}
	if err := dataStore.SettleBillableReservation(reservationID, user.ID, 2, BillableUsageSettlement{
		Category: "image", ModelConfigID: "image-1", Provider: "test", Model: "test-image",
		SourceType: "image_generation", SourceID: "request-1", PricingMode: "per_request",
		QuantitySnapshot: map[string]any{"expectedCount": 4, "successfulCount": 2},
	}); err != nil {
		t.Fatalf("settle image credits: %v", err)
	}
	updated, _, _ := dataStore.FindUserByID(user.ID)
	if updated.CreditBalance != 8 {
		t.Fatalf("balance = %v, want 8", updated.CreditBalance)
	}
	var cost float64
	var successfulCount int
	if err := dataStore.db.QueryRow(`SELECT credit_cost, json_extract(quantity_snapshot, '$.successfulCount') FROM billable_usage_records WHERE user_id = ?`, user.ID).Scan(&cost, &successfulCount); err != nil {
		t.Fatalf("load billable usage: %v", err)
	}
	if cost != 2 || successfulCount != 2 {
		t.Fatalf("usage cost=%v successfulCount=%d, want 2 and 2", cost, successfulCount)
	}
}

func TestListLedgerCollapsesLegacyReservationTriples(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	user, _ := dataStore.CreateUser("legacy-ledger-user", "password123", "Legacy Ledger User")
	rows := []struct {
		id, entryType string
		delta         float64
		createdAt     string
	}{
		{"reserve", "reservation", -1, "2026-01-01T00:00:00Z"},
		{"release", "reservation_release", 1, "2026-01-01T00:00:01Z"},
		{"usage", "usage", -0.25, "2026-01-01T00:00:01Z"},
	}
	for _, row := range rows {
		if _, err := dataStore.db.Exec(`INSERT INTO credit_ledger (id, user_id, type, credit_delta, credit_balance_after, source_type, source_id, snapshot, created_at) VALUES (?, ?, ?, ?, 9.75, 'chat_image_decision', 'message-1', '{}', ?)`, row.id, user.ID, row.entryType, row.delta, row.createdAt); err != nil {
			t.Fatalf("insert legacy ledger: %v", err)
		}
	}
	entries, err := dataStore.ListLedger(user.ID, 20)
	if err != nil {
		t.Fatalf("list ledger: %v", err)
	}
	if len(entries) != 1 || entries[0].Type != "usage_debit" || entries[0].CreditDelta != -0.25 {
		t.Fatalf("collapsed entries = %#v", entries)
	}
}
