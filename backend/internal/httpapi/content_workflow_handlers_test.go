package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
)

func TestContentWorkflowAPIUpsertsListsAndDeletes(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir(), AuthTokenSecret: "test-secret"})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	user, err := server.store.CreateUser("workflow-user", "password123", "Workflow User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token := server.tokens.Create(user.ID, user.Role, user.AuthVersion)
	payload := map[string]any{
		"moduleKey": "lightweight-marketing-video", "recordKey": "record-1",
		"title": "Campaign", "status": "processing", "currentStep": "attachment_parsing",
		"schemaVersion": 1, "state": map[string]any{"brief": "Launch"},
	}
	created := authenticatedWorkflowRequest(t, server, token, http.MethodPost, "/api/content/workflows", payload)
	if created.Code != http.StatusOK {
		t.Fatalf("create status = %d body=%s", created.Code, created.Body.String())
	}
	var workflow store.ContentWorkflow
	if err := json.NewDecoder(created.Body).Decode(&workflow); err != nil || workflow.RecordKey != "record-1" {
		t.Fatalf("created workflow=%#v err=%v", workflow, err)
	}

	payload["status"] = "paused"
	payload["currentStep"] = "ai_analysis"
	updated := authenticatedWorkflowRequest(t, server, token, http.MethodPost, "/api/content/workflows", payload)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d body=%s", updated.Code, updated.Body.String())
	}
	var revised store.ContentWorkflow
	_ = json.NewDecoder(updated.Body).Decode(&revised)
	if revised.ID != workflow.ID || revised.Revision != 2 || revised.CurrentStep != "ai_analysis" {
		t.Fatalf("updated workflow=%#v", revised)
	}

	listed := authenticatedWorkflowRequest(t, server, token, http.MethodGet, "/api/content/workflows?moduleKey=lightweight-marketing-video", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list status = %d body=%s", listed.Code, listed.Body.String())
	}
	var items []store.ContentWorkflow
	_ = json.NewDecoder(listed.Body).Decode(&items)
	if len(items) != 1 || items[0].ID != workflow.ID {
		t.Fatalf("listed workflows=%#v", items)
	}

	deleted := authenticatedWorkflowRequest(t, server, token, http.MethodDelete, "/api/content/workflows/"+workflow.ID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d body=%s", deleted.Code, deleted.Body.String())
	}
}

func authenticatedWorkflowRequest(t *testing.T, server *Server, token, method, target string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	if payload != nil {
		if err := json.NewEncoder(&body).Encode(payload); err != nil {
			t.Fatalf("encode payload: %v", err)
		}
	}
	request := httptest.NewRequest(method, target, &body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cookie", (&http.Cookie{Name: authCookieName, Value: token}).String())
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}
