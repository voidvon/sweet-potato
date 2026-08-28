package store

import "testing"

func TestAssetExtractionLifecycleAndInterruptedRecovery(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	created, err := dataStore.CreateAssetExtraction(AssetExtraction{
		AssetID: "asset-1", UserID: "user-1", Parser: "pptx-openxml", ParserVersion: "1",
	})
	if err != nil {
		t.Fatalf("create extraction: %v", err)
	}
	if created.Status != "queued" || created.OptionsHash != "default" || len(created.DerivedAssetIDs) != 0 {
		t.Fatalf("created extraction = %#v", created)
	}
	running, err := dataStore.MarkAssetExtractionRunning(created.ID, created.UserID, "sha256-value")
	if err != nil {
		t.Fatalf("mark running: %v", err)
	}
	if running.Status != "running" || running.ContentHash != "sha256-value" || running.StartedAt == nil {
		t.Fatalf("running extraction = %#v", running)
	}
	completed, err := dataStore.CompleteAssetExtraction(created.ID, created.UserID, map[string]any{"text": "campaign"}, []string{"derived-1"})
	if err != nil {
		t.Fatalf("complete extraction: %v", err)
	}
	if completed.Status != "completed" || completed.CompletedAt == nil || completed.Result["text"] != "campaign" || len(completed.DerivedAssetIDs) != 1 {
		t.Fatalf("completed extraction = %#v", completed)
	}
	latest, found, err := dataStore.FindLatestAssetExtraction(created.AssetID, created.UserID)
	if err != nil || !found || latest.ID != created.ID {
		t.Fatalf("latest extraction = %#v, found=%v, err=%v", latest, found, err)
	}

	interrupted, err := dataStore.CreateAssetExtraction(AssetExtraction{
		AssetID: "asset-2", UserID: "user-1", Parser: "pdf-page-renderer", ParserVersion: "1",
	})
	if err != nil {
		t.Fatalf("create interrupted extraction: %v", err)
	}
	if err := dataStore.FailInterruptedAssetExtractions(); err != nil {
		t.Fatalf("recover interrupted extractions: %v", err)
	}
	recovered, found, err := dataStore.FindAssetExtraction(interrupted.ID, interrupted.UserID)
	if err != nil || !found || recovered.Status != "failed" || recovered.ErrorCode == nil || *recovered.ErrorCode != "service_restarted" {
		t.Fatalf("recovered extraction = %#v, found=%v, err=%v", recovered, found, err)
	}
}
