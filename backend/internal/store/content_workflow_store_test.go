package store

import "testing"

func TestContentWorkflowUpsertListAndDelete(t *testing.T) {
	dataStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()
	first, err := dataStore.UpsertContentWorkflow(ContentWorkflow{
		UserID: "user-1", ModuleKey: "marketing-video", RecordKey: "default",
		Title: "营销视频草稿", Status: "draft", CurrentStep: "materials",
		State: map[string]any{"prompt": "first"}, SchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("create workflow: %v", err)
	}
	updated, err := dataStore.UpsertContentWorkflow(ContentWorkflow{
		UserID: "user-1", ModuleKey: "marketing-video", RecordKey: "default",
		Title: "营销视频草稿", Status: "processing", CurrentStep: "storyboard",
		State: map[string]any{"prompt": "updated"}, SchemaVersion: 2,
	})
	if err != nil {
		t.Fatalf("update workflow: %v", err)
	}
	if updated.ID != first.ID || updated.Revision != 2 || updated.State["prompt"] != "updated" {
		t.Fatalf("updated workflow = %#v", updated)
	}
	items, err := dataStore.ListContentWorkflows("user-1", "marketing-video", 10)
	if err != nil || len(items) != 1 {
		t.Fatalf("list workflows: items=%#v err=%v", items, err)
	}
	deleted, err := dataStore.DeleteContentWorkflow(first.ID, "user-1")
	if err != nil || !deleted {
		t.Fatalf("delete workflow: deleted=%v err=%v", deleted, err)
	}
	if _, found, err := dataStore.FindContentWorkflow(first.ID, "user-1"); err != nil || found {
		t.Fatalf("deleted workflow still visible: found=%v err=%v", found, err)
	}
}
