package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sweet-potato-go/internal/config"
	"testing"
)

func TestResolveRequestLanguage(t *testing.T) {
	tests := []struct {
		header string
		want   string
	}{
		{"", languageChinese},
		{"zh-CN,zh;q=0.9", languageChinese},
		{"en-US,en;q=0.9,zh;q=0.8", languageEnglish},
		{"fr-FR,en;q=0.8", languageEnglish},
		{"en;q=0,zh;q=0.5", languageChinese},
		{"en;q=0.4,zh;q=0.9", languageChinese},
	}
	for _, test := range tests {
		if got := resolveRequestLanguage(test.header); got != test.want {
			t.Fatalf("resolveRequestLanguage(%q) = %q, want %q", test.header, got, test.want)
		}
	}
}

func TestWriteErrorLocalizesEnglishResponse(t *testing.T) {
	recorder := httptest.NewRecorder()
	w := &localizedResponseWriter{ResponseWriter: recorder, language: languageEnglish}

	writeError(w, http.StatusUnauthorized, "登录状态已失效，请重新登录")

	if recorder.Header().Get("Content-Language") != languageEnglish {
		t.Fatalf("Content-Language = %q", recorder.Header().Get("Content-Language"))
	}
	want := `{"code":"unauthorized","message":"Your session has expired. Please sign in again."}` + "\n"
	if recorder.Body.String() != want {
		t.Fatalf("body = %q, want %q", recorder.Body.String(), want)
	}
}

func TestWriteErrorKeepsChineseByDefault(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeError(recorder, http.StatusBadRequest, "请求体格式错误")
	want := `{"code":"bad_request","message":"请求体格式错误"}` + "\n"
	if recorder.Body.String() != want {
		t.Fatalf("body = %q, want %q", recorder.Body.String(), want)
	}
}

func TestHandlerUsesAcceptLanguageAndAllowsHeaderInCORS(t *testing.T) {
	server, err := New(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()
	server.mux.HandleFunc("GET /localized-error", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusUnauthorized, "登录状态已失效，请重新登录")
	})
	request := httptest.NewRequest(http.MethodGet, "/localized-error", nil)
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	if response.Header().Get("Content-Language") != languageEnglish {
		t.Fatalf("Content-Language = %q", response.Header().Get("Content-Language"))
	}
	if !strings.Contains(response.Header().Get("Access-Control-Allow-Headers"), "Accept-Language") {
		t.Fatalf("Accept-Language missing from CORS allow headers")
	}
	var payload map[string]string
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["code"] != "unauthorized" || payload["message"] != "Your session has expired. Please sign in again." {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}
