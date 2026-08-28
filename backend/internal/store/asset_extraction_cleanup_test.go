package store

import (
	"testing"
	"time"
)

func TestCleanupAssetExtractionsAppliesRetentionAndPreservesLatestSuccess(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	user, err := dataStore.CreateUser("cleanup-extraction-user", "password123", "Cleanup User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	asset, err := dataStore.CreateContentAsset(ContentAsset{UserID: user.ID, OriginalFileName: "source.pptx", StoredFileName: "source.pptx", MimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"})
	if err != nil {
		t.Fatalf("create asset: %v", err)
	}
	now := time.Now().UTC()
	oldSuccess := createExtractionAt(t, dataStore, asset.ID, user.ID, "completed", now.Add(-40*24*time.Hour))
	latestSuccess := createExtractionAt(t, dataStore, asset.ID, user.ID, "completed", now.Add(-24*time.Hour))
	oldFailure := createExtractionAt(t, dataStore, asset.ID, user.ID, "failed", now.Add(-8*24*time.Hour))
	recentFailure := createExtractionAt(t, dataStore, asset.ID, user.ID, "failed", now.Add(-time.Hour))
	orphan := createExtractionAt(t, dataStore, "missing-asset", user.ID, "completed", now.Add(-time.Hour))
	stale := createExtractionAt(t, dataStore, asset.ID+"-stale", user.ID, "queued", now.Add(-25*time.Hour))
	if _, err := dataStore.CreateContentAsset(ContentAsset{ID: asset.ID + "-stale", UserID: user.ID, OriginalFileName: "stale.pdf", StoredFileName: "stale.pdf", MimeType: "application/pdf"}); err != nil {
		t.Fatalf("create stale source: %v", err)
	}

	stats, err := dataStore.CleanupAssetExtractions(now)
	if err != nil {
		t.Fatalf("cleanup extractions: %v", err)
	}
	if stats.StaleFailed != 1 || stats.OrphansDeleted != 1 || stats.FailuresDeleted != 1 || stats.SupersededDeleted != 1 {
		t.Fatalf("cleanup stats = %#v", stats)
	}
	for _, deleted := range []AssetExtraction{oldSuccess, oldFailure, orphan} {
		if _, found, err := dataStore.FindAssetExtraction(deleted.ID, deleted.UserID); err != nil || found {
			t.Fatalf("deleted extraction %s found=%v err=%v", deleted.ID, found, err)
		}
	}
	for _, retained := range []AssetExtraction{latestSuccess, recentFailure} {
		if _, found, err := dataStore.FindAssetExtraction(retained.ID, retained.UserID); err != nil || !found {
			t.Fatalf("retained extraction %s found=%v err=%v", retained.ID, found, err)
		}
	}
	staleResult, found, err := dataStore.FindAssetExtraction(stale.ID, stale.UserID)
	if err != nil || !found || staleResult.Status != "failed" || staleResult.ErrorCode == nil || *staleResult.ErrorCode != "task_timeout" {
		t.Fatalf("stale extraction = %#v, found=%v, err=%v", staleResult, found, err)
	}
}

func TestPruneAssetExtractionHistoryKeepsLatestSuccessWithinCap(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	now := time.Now().UTC()
	latestSuccess := createExtractionAt(t, dataStore, "asset-cap", "user-cap", "completed", now.Add(-10*time.Hour))
	for index := 0; index < 5; index++ {
		createExtractionAt(t, dataStore, "asset-cap", "user-cap", "failed", now.Add(-time.Duration(index)*time.Hour))
	}
	deleted, err := dataStore.PruneAssetExtractionHistory("asset-cap", "user-cap", 3)
	if err != nil {
		t.Fatalf("prune history: %v", err)
	}
	if deleted != 3 {
		t.Fatalf("deleted = %d, want 3", deleted)
	}
	if _, found, err := dataStore.FindAssetExtraction(latestSuccess.ID, latestSuccess.UserID); err != nil || !found {
		t.Fatalf("latest success was not preserved: found=%v err=%v", found, err)
	}
	var count int
	if err := dataStore.db.QueryRow(`SELECT COUNT(*) FROM asset_extractions WHERE asset_id = 'asset-cap'`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("remaining count = %d, err=%v", count, err)
	}
}

func TestDeleteContentAssetTreeRemovesDerivedAssetsAndExtractions(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	parent, err := dataStore.CreateContentAsset(ContentAsset{ID: "parent", UserID: "user", OriginalFileName: "source.pdf", StoredFileName: "source.pdf", MimeType: "application/pdf"})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	parentID := parent.ID
	child, err := dataStore.CreateContentAsset(ContentAsset{ID: "child", UserID: "user", ParentAssetID: &parentID, OriginalFileName: "page.png", StoredFileName: "page.png", MimeType: "image/png"})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	childID := child.ID
	if _, err := dataStore.CreateContentAsset(ContentAsset{ID: "grandchild", UserID: "user", ParentAssetID: &childID, OriginalFileName: "nested.png", StoredFileName: "nested.png", MimeType: "image/png"}); err != nil {
		t.Fatalf("create grandchild: %v", err)
	}
	extraction, err := dataStore.CreateAssetExtraction(AssetExtraction{AssetID: parent.ID, UserID: "user", Parser: "pdf-page-renderer", ParserVersion: "1"})
	if err != nil {
		t.Fatalf("create extraction: %v", err)
	}
	removed, err := dataStore.DeleteContentAssetTree(parent.ID, "user")
	if err != nil {
		t.Fatalf("delete asset tree: %v", err)
	}
	if len(removed) != 3 {
		t.Fatalf("removed assets = %#v", removed)
	}
	for _, id := range []string{"parent", "child", "grandchild"} {
		if _, found, err := dataStore.FindContentAsset(id); err != nil || found {
			t.Fatalf("asset %s found=%v err=%v", id, found, err)
		}
	}
	if _, found, err := dataStore.FindAssetExtraction(extraction.ID, extraction.UserID); err != nil || found {
		t.Fatalf("extraction found=%v err=%v", found, err)
	}
}

func createExtractionAt(t *testing.T, dataStore *Store, assetID, userID, status string, timestamp time.Time) AssetExtraction {
	t.Helper()
	item, err := dataStore.CreateAssetExtraction(AssetExtraction{AssetID: assetID, UserID: userID, Parser: "test-parser", ParserVersion: "1", Status: status})
	if err != nil {
		t.Fatalf("create extraction: %v", err)
	}
	formatted := timestamp.UTC().Format(time.RFC3339Nano)
	var completed any
	if status == "completed" || status == "failed" {
		completed = formatted
	}
	if _, err := dataStore.db.Exec(`UPDATE asset_extractions SET created_at = ?, updated_at = ?, completed_at = ? WHERE id = ?`, formatted, formatted, completed, item.ID); err != nil {
		t.Fatalf("set extraction timestamp: %v", err)
	}
	item.CreatedAt = formatted
	item.UpdatedAt = formatted
	return item
}
