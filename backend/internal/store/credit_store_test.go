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
}
