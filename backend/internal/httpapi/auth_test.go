package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ai-marketing-go/internal/config"
)

func TestAuthRegisterLoginAndCurrentUser(t *testing.T) {
	server, err := New(config.Config{
		DataDir:            t.TempDir(),
		AuthTokenSecret:    "test-secret",
		AuthTokenExpiresIn: 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
	defer server.Close()

	register := requestJSON(t, server, http.MethodPost, "/api/auth/register", map[string]string{
		"username":    "go-user",
		"password":    "password123",
		"displayName": "Go User",
	})
	if register.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want %d: %s", register.Code, http.StatusCreated, register.Body.String())
	}
	var registered struct {
		Token string `json:"token"`
		User  struct {
			Role        string   `json:"role"`
			DisplayName string   `json:"displayName"`
			Permissions []string `json:"permissions"`
		} `json:"user"`
	}
	decodeJSON(t, register, &registered)
	if registered.Token == "" || registered.User.Role != "admin" || registered.User.DisplayName != "Go User" || len(registered.User.Permissions) == 0 {
		t.Fatalf("unexpected register response: %+v", registered)
	}

	login := requestJSON(t, server, http.MethodPost, "/api/auth/login", map[string]string{
		"username": "go-user",
		"password": "password123",
	})
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d: %s", login.Code, http.StatusOK, login.Body.String())
	}
	var loggedIn struct {
		Token string `json:"token"`
	}
	decodeJSON(t, login, &loggedIn)

	request := httptest.NewRequest(http.MethodGet, "/api/users/me", nil)
	request.Header.Set("Authorization", "Bearer "+loggedIn.Token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("me status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
}

func requestJSON(t *testing.T, server *Server, method string, path string, value any) *httptest.ResponseRecorder {
	t.Helper()
	body := bytes.NewBuffer(nil)
	if err := json.NewEncoder(body).Encode(value); err != nil {
		t.Fatalf("encode request: %v", err)
	}
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

func decodeJSON(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}
