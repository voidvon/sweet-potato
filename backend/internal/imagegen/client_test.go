package imagegen

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"sweet-potato-go/internal/store"
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

func TestGenerateCompatibleImagesInChunksUpToTwelve(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		count := int(body["n"].(float64))
		if count < 1 || count > 4 {
			t.Fatalf("chunk count = %d, want 1..4", count)
		}
		items := make([]any, count)
		for index := range items {
			items[index] = map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated"))}
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": items})
	}))
	defer server.Close()

	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "compatible", Model: "image-model"}).Generate(
		t.Context(),
		GenerateInput{Prompt: "draw products", Count: 12},
	)
	if err != nil {
		t.Fatalf("generate images: %v", err)
	}
	if len(results) != 12 || requestCount != 3 {
		t.Fatalf("results = %d, requests = %d, want 12 results in 3 requests", len(results), requestCount)
	}
}

func TestGenerateGPTImage2OmitsImageCountFromInitialRequests(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		if request.URL.Path != "/v1/images/generations" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if _, exists := body["n"]; exists {
			t.Fatalf("gpt-image-2 request must omit n: %#v", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated"))},
		}})
	}))
	defer server.Close()

	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-2"}).Generate(
		t.Context(), GenerateInput{Prompt: "draw products", Count: 2},
	)
	if err != nil {
		t.Fatalf("generate images: %v", err)
	}
	if len(results) != 2 || requestCount != 2 {
		t.Fatalf("results = %d, requests = %d, want 2 results in 2 requests", len(results), requestCount)
	}
}

func TestGenerateOpenAIImageFromSSE(t *testing.T) {
	preview := base64.StdEncoding.EncodeToString([]byte("preview"))
	completed := base64.StdEncoding.EncodeToString([]byte("completed"))
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: image_generation.partial_image\n" +
			"data: {\"type\":\"image_generation.partial_image\",\"partial_image_index\":0,\"b64_json\":\"" + preview + "\"}\n\n" +
			"event: image_generation.completed\n" +
			"data: {\"type\":\"image_generation.completed\",\"partial_image_index\":0,\"b64_json\":\"" + completed + "\"}\n\n" +
			"data: [DONE]\n\n"))
	}))
	defer server.Close()

	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-2"}).Generate(t.Context(), GenerateInput{Prompt: "draw a tree"})
	if err != nil {
		t.Fatalf("generate image: %v", err)
	}
	if len(results) != 1 || string(results[0].Bytes) != "completed" {
		t.Fatalf("unexpected results: %+v", results)
	}
}

func TestGenerateReturnsWhenSSETerminalEventArrivesWithoutWaitingForConnectionClose(t *testing.T) {
	requestClosed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write([]byte("event: image_generation.completed\n" +
			"data: {\"type\":\"image_generation.completed\",\"b64_json\":\"" + base64.StdEncoding.EncodeToString([]byte("completed")) + "\"}\n\n"))
		writer.(http.Flusher).Flush()
		<-request.Context().Done()
		close(requestClosed)
	}))
	defer server.Close()

	done := make(chan error, 1)
	go func() {
		results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-2"}).Generate(t.Context(), GenerateInput{Prompt: "draw a tree"})
		if err == nil && (len(results) != 1 || string(results[0].Bytes) != "completed") {
			err = fmt.Errorf("unexpected results: %+v", results)
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("generate image: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("client waited for SSE connection close after terminal event")
	}
	select {
	case <-requestClosed:
	case <-time.After(time.Second):
		t.Fatal("client did not close completed SSE request")
	}
}

func TestGenerateWithProgressEmitsEachReferenceEditBeforeStartingNext(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "reference.png")
	if err := os.WriteFile(path, []byte("reference"), 0o644); err != nil {
		t.Fatalf("write reference: %v", err)
	}
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount.Add(1)
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated"))},
		}})
	}))
	defer server.Close()

	callbackCount := 0
	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-2"}).GenerateWithProgress(
		t.Context(),
		GenerateInput{
			Prompt: "product details",
			Count:  2,
			References: []store.ContentAsset{{
				OriginalFileName: "reference.png",
				FilePath:         path,
				MimeType:         "image/png",
			}},
		},
		func(_ Output, slotIndex int) error {
			callbackCount++
			if got := int(requestCount.Load()); got != slotIndex+1 {
				return fmt.Errorf("slot %d emitted after %d requests", slotIndex, got)
			}
			return nil
		},
	)
	if err != nil {
		t.Fatalf("generate images: %v", err)
	}
	if len(results) != 2 || callbackCount != 2 {
		t.Fatalf("results = %d, callbacks = %d", len(results), callbackCount)
	}
}

func TestGenerateReportsSSEErrorMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte("event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"unsupported size\"}}\n\n"))
	}))
	defer server.Close()

	_, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-2"}).Generate(t.Context(), GenerateInput{Prompt: "draw a tree"})
	if err == nil || !strings.Contains(err.Error(), "unsupported size") {
		t.Fatalf("error = %v, want upstream SSE message", err)
	}
}

func TestGenerateRejectsSSEDeclaredAsJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte("event: image_generation.completed\ndata: {}\n\n"))
	}))
	defer server.Close()

	_, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-2"}).Generate(t.Context(), GenerateInput{Prompt: "draw a tree"})
	if err == nil || !strings.Contains(err.Error(), "declared application/json") {
		t.Fatalf("error = %v, want declared Content-Type mismatch", err)
	}
}

func TestGenerateRetriesWithOpaqueBackgroundWhenTransparentIsUnsupported(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		writer.Header().Set("Content-Type", "application/json")
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if requests == 1 {
			if body["background"] != "transparent" {
				t.Fatalf("first background = %#v, want transparent", body["background"])
			}
			writer.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"error": map[string]any{"message": "Transparent background is not supported for this model."},
			})
			return
		}
		if body["background"] != "opaque" {
			t.Fatalf("retry background = %#v, want opaque", body["background"])
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated"))},
		}})
	}))
	defer server.Close()

	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "compatible-image-model"}).Generate(t.Context(), GenerateInput{
		Prompt:     "design a logo",
		Count:      1,
		Background: "transparent",
	})
	if err != nil {
		t.Fatalf("generate image: %v", err)
	}
	if requests != 2 || len(results) != 1 || string(results[0].Bytes) != "generated" {
		t.Fatalf("requests = %d, results = %+v", requests, results)
	}
}

func TestGenerateSeedreamIncludesReferenceImages(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "reference.png")
	if err := os.WriteFile(path, []byte("reference"), 0o644); err != nil {
		t.Fatalf("write reference: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
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

func TestGenerateOpenAIEditPreservesReferenceMIMEType(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "reference.png")
	if err := os.WriteFile(path, []byte("reference"), 0o644); err != nil {
		t.Fatalf("write reference: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.URL.Path != "/v1/images/edits" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		reader, err := request.MultipartReader()
		if err != nil {
			t.Fatalf("multipart reader: %v", err)
		}
		foundImage := false
		for {
			part, nextErr := reader.NextPart()
			if nextErr == io.EOF {
				break
			}
			if nextErr != nil {
				t.Fatalf("next multipart part: %v", nextErr)
			}
			if part.FormName() == "n" {
				t.Fatal("gpt-image-2 edit request must omit n")
			}
			if part.FormName() != "image[]" {
				continue
			}
			foundImage = true
			if got := part.Header.Get("Content-Type"); got != "image/png" {
				t.Fatalf("image content type = %q, want image/png", got)
			}
		}
		if !foundImage {
			t.Fatal("missing image multipart part")
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"data": []any{
			map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("generated"))},
		}})
	}))
	defer server.Close()

	results, err := (Client{BaseURL: server.URL + "/v1", APIKey: "test-key", Provider: "openai-images", Model: "gpt-image-2"}).Generate(t.Context(), GenerateInput{
		Prompt: "remove the text",
		Count:  1,
		References: []store.ContentAsset{{
			OriginalFileName: "reference.png",
			FilePath:         path,
			MimeType:         "image/png",
		}},
	})
	if err != nil {
		t.Fatalf("generate image edit: %v", err)
	}
	if len(results) != 1 || string(results[0].Bytes) != "generated" {
		t.Fatalf("unexpected results: %+v", results)
	}
}

func TestGenerateRequiresCredentials(t *testing.T) {
	_, err := (Client{Model: "gpt-image-1"}).Generate(t.Context(), GenerateInput{Prompt: "test"})
	if err == nil {
		t.Fatal("expected missing API key error")
	}
}
