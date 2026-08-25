package store

import "testing"

func TestFoundationPricingIncludesContextMetadata(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	pricing, found, err := dataStore.FindPricing("openai", "gpt-5.6-sol")
	if err != nil {
		t.Fatalf("find pricing: %v", err)
	}
	if !found {
		t.Fatal("gpt-5.6-sol metadata was not seeded")
	}
	if pricing.ContextWindowTokens != 272000 || pricing.EffectiveWindowPercent != 95 {
		t.Fatalf("pricing context metadata = %#v", pricing)
	}
}

func TestSavePricingPersistsContextMetadata(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	saved, err := dataStore.SavePricing(LlmModelPricing{
		ID:                     "custom:model",
		Provider:               "custom",
		ProviderName:           "Custom",
		Model:                  "model",
		DisplayName:            "Model",
		DefaultBaseURL:         "https://example.com/v1",
		Currency:               "USD",
		ContextWindowTokens:    64000,
		EffectiveWindowPercent: 90,
		PriceSource:            "manual",
	}, true)
	if err != nil {
		t.Fatalf("save pricing: %v", err)
	}
	if saved.ContextWindowTokens != 64000 || saved.EffectiveWindowPercent != 90 {
		t.Fatalf("saved pricing = %#v", saved)
	}
}
