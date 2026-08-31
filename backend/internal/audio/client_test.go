package audio

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestSynthesizeMiMoUsesPresetVoiceRequest(t *testing.T) {
	wantAudio := []byte("wav-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("request path = %s", r.URL.Path)
		}
		if r.Header.Get("api-key") != "test-key" {
			t.Fatalf("api-key header was not forwarded")
		}
		var payload struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			Audio struct {
				Format string `json:"format"`
				Voice  string `json:"voice"`
			} `json:"audio"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload.Model != "mimo-v2.5-tts" || payload.Audio.Format != "wav" || payload.Audio.Voice != "mimo_default" {
			t.Fatalf("request payload = %#v", payload)
		}
		if len(payload.Messages) != 2 || payload.Messages[0].Role != "user" || payload.Messages[1].Role != "assistant" || payload.Messages[1].Content != "测试旁白" {
			t.Fatalf("request messages = %#v", payload.Messages)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{
				"message": map[string]any{
					"audio": map[string]any{"data": base64.StdEncoding.EncodeToString(wantAudio)},
				},
			}},
		})
	}))
	defer server.Close()

	output, err := (Client{
		HTTPClient: server.Client(),
		BaseURL:    server.URL,
		APIKey:     "test-key",
		Provider:   "mimo-tts",
		Model:      "mimo-v2.5-tts",
	}).Synthesize(context.Background(), SpeechInput{Voice: "mimo_default", Text: "测试旁白", Speed: 1})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if !reflect.DeepEqual(output.Bytes, wantAudio) || output.MimeType != "audio/wav" {
		t.Fatalf("output = %#v", output)
	}
}

func TestResponseErrorIncludesMiMoParamDetail(t *testing.T) {
	data := []byte(`{"error":{"code":"400","message":"Param Incorrect","param":"audio.voice must be a DataURL for voice clone model"}}`)
	got := responseError(data)
	want := "Param Incorrect: audio.voice must be a DataURL for voice clone model"
	if got != want {
		t.Fatalf("response error = %q, want %q", got, want)
	}
}
