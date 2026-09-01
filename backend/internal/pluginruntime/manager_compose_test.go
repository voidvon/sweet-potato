package pluginruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestComposeCallsManagedPlugin(t *testing.T) {
	plugin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/compose" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode compose request: %v", err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if body["presetId"] != "clean-marketing" {
			t.Errorf("compose body = %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"renderRequest": map[string]any{"compositionId": "JsonVideo"},
		})
	}))
	defer plugin.Close()

	manager := &Manager{status: Status{State: "running", Endpoint: plugin.URL}}
	result, err := manager.Compose(context.Background(), RemotionPluginKey, map[string]any{
		"presetId": "clean-marketing",
	})
	if err != nil {
		t.Fatalf("compose: %v", err)
	}
	renderRequest, ok := result["renderRequest"].(map[string]any)
	if !ok || renderRequest["compositionId"] != "JsonVideo" {
		t.Fatalf("compose result = %#v", result)
	}
}
