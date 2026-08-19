package imagegen

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"ai-marketing-go/internal/store"
)

func TestGenerateOpenAIImageFromBase64(t *testing.T) {
	want := []byte("png-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/images/generations" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("missing authorization header")
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["model"] != "gpt-image-1" || body["prompt"] != "draw a tree" || body["n"] != float64(2) {
			t.Fatalf("unexpected request: %#v", body)
		}
		if body["background"] != "opaque" {
			t.Fatalf("background = %#v, want opaque", body["background"])
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString(want)},
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString(want)},
		}})
	}))
	defer server.Close()

	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-1"}).Generate(t.Context(), GenerateInput{Prompt: "draw a tree", Count: 2, Background: "opaque"})
	if err != nil {
		t.Fatalf("generate image: %v", err)
	}
	if len(results) != 2 || string(results[0].Bytes) != string(want) || results[0].MimeType != "image/png" {
		t.Fatalf("unexpected results: %+v", results)
	}
}

func TestGenerateSeedreamIncludesReferenceImages(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "reference.png")
	if err := os.WriteFile(path, []byte("reference"), 0o644); err != nil {
		t.Fatalf("write reference: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["sequential_image_generation"] != "auto" {
			t.Fatalf("missing sequential mode: %#v", body)
		}
		if _, ok := body["image"].(string); !ok {
			t.Fatalf("missing inline reference image: %#v", body)
		}
		encoded := base64.StdEncoding.EncodeToString([]byte("generated"))
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": encoded},
			map[string]any{"b64_json": encoded},
		}})
	}))
	defer server.Close()

	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "volcengine-seedream", Model: "doubao-seedream-5-0-lite"}).Generate(t.Context(), GenerateInput{
		Prompt: "product photo",
		Count:  2,
		References: []store.ContentAsset{{
			FilePath: path,
			MimeType: "image/png",
		}},
	})
	if err != nil {
		t.Fatalf("generate image: %v", err)
	}
	if len(results) != 2 || string(results[0].Bytes) != "generated" {
		t.Fatalf("unexpected results: %+v", results)
	}
}

func TestGenerateRequiresCredentials(t *testing.T) {
	_, err := (Client{Model: "gpt-image-1"}).Generate(t.Context(), GenerateInput{Prompt: "test"})
	if err == nil {
		t.Fatal("expected missing API key error")
	}
}
