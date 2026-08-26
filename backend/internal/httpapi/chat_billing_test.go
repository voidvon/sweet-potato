package httpapi

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestBillableChatLLMRejectsBelowConfiguredThresholdBeforeUpstream(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, _ := server.store.CreateUser("threshold-user", "password123", "Threshold User")
	_, _ = server.store.AdjustCredits(user.ID, user.ID, 1)
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls++
	}))
	defer upstream.Close()
	model := store.ModelConfig{ID: "llm-threshold", Type: "llm", Provider: "test", Model: "test", APIKey: "test", BaseURL: upstream.URL, Settings: map[string]any{
		"billing": map[string]any{"multiplier": 1, "inputCreditsPer1M": 1, "outputCreditsPer1M": 2, "maxOutputCreditsForReserve": 2},
	}}
	_, err = server.callBillableResponses(context.Background(), user.ID, "chat_image_decision", "message-1", model, []map[string]any{{"role": "user", "content": "hello"}}, nil)
	if !errors.Is(err, store.ErrInsufficientCredits) {
		t.Fatalf("error = %v, want insufficient credits", err)
	}
	if upstreamCalls != 0 {
		t.Fatalf("upstream calls = %d, want 0", upstreamCalls)
	}
}

func TestBillableChatLLMSettlesProviderTokenUsage(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, _ := server.store.CreateUser("settlement-user", "password123", "Settlement User")
	_, _ = server.store.AdjustCredits(user.ID, user.ID, 10)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"ok\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"ok\"}]}],\"usage\":{\"input_tokens\":100,\"input_tokens_details\":{\"cached_tokens\":20},\"output_tokens\":50,\"total_tokens\":150}}}\n\n"))
	}))
	defer upstream.Close()
	model := store.ModelConfig{ID: "llm-settlement", Type: "llm", Provider: "test", Model: "test", APIKey: "test", BaseURL: upstream.URL, Settings: map[string]any{
		"billing": map[string]any{"multiplier": 2, "inputCreditsPer1M": 10, "cachedInputCreditsPer1M": 1, "outputCreditsPer1M": 20, "maxOutputCreditsForReserve": 3},
	}}
	if _, err := server.callBillableResponses(context.Background(), user.ID, "chat_response", "message-2", model, []map[string]any{{"role": "user", "content": "hello"}}, nil); err != nil {
		t.Fatalf("call billable responses: %v", err)
	}
	updated, _, _ := server.store.FindUserByID(user.ID)
	wantCost := (float64(80)*10/1_000_000 + float64(20)*1/1_000_000 + float64(50)*20/1_000_000) * 2
	if math.Abs(updated.CreditBalance-(10-wantCost)) > 1e-9 {
		t.Fatalf("balance = %.9f, want %.9f", updated.CreditBalance, 10-wantCost)
	}
}
