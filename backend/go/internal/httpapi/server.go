package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ai-marketing-go/internal/auth"
	"ai-marketing-go/internal/config"
	"ai-marketing-go/internal/store"
)

type Server struct {
	config config.Config
	mux    *http.ServeMux
	store  *store.Store
	tokens *auth.TokenManager
}

func New(cfg config.Config) (*Server, error) {
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "files"), 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	dataStore, err := store.Open(cfg.DataDir)
	if err != nil {
		return nil, err
	}

	server := &Server{
		config: cfg,
		mux:    http.NewServeMux(),
		store:  dataStore,
		tokens: auth.NewTokenManager(cfg.AuthTokenSecret, cfg.AuthTokenExpiresIn),
	}
	server.mux.HandleFunc("GET /api/health", server.handleHealth)
	server.mux.HandleFunc("GET /health", server.handleHealth)
	server.mux.HandleFunc("POST /api/auth/register", server.handleRegister)
	server.mux.HandleFunc("POST /api/auth/login", server.handleLogin)
	server.mux.HandleFunc("GET /api/users/me", server.handleCurrentUser)
	server.mux.HandleFunc("GET /api/users", server.handleListUsers)
	server.mux.HandleFunc("PUT /api/users/{id}/profile", server.handleUpdateProfile)
	server.mux.HandleFunc("PUT /api/users/{id}/password", server.handleUpdatePassword)
	server.mux.HandleFunc("PUT /api/users/{id}/admin-password", server.handleAdminPassword)
	server.mux.HandleFunc("PATCH /api/users/{id}/credits", server.handleAdjustCredits)
	server.mux.HandleFunc("PATCH /api/users/{id}/blacklist", server.handleBlacklist)
	server.mux.HandleFunc("PATCH /api/users/{id}/role-assignment", server.handleRoleAssignment)

	server.mux.HandleFunc("GET /api/roles/resource-tree", server.handleRoleResourceTree)
	server.mux.HandleFunc("GET /api/roles", server.handleListRoles)
	server.mux.HandleFunc("POST /api/roles", server.handleCreateRole)
	server.mux.HandleFunc("PUT /api/roles/{id}", server.handleUpdateRole)
	server.mux.HandleFunc("DELETE /api/roles/{id}", server.handleDeleteRole)

	server.mux.HandleFunc("GET /api/route-resources/public-tree", server.handlePublicRouteTree)
	server.mux.HandleFunc("GET /api/route-resources", server.handleListRouteResources)
	server.mux.HandleFunc("GET /api/route-resources/tree", server.handleRouteResourceTree)
	server.mux.HandleFunc("GET /api/route-resources/{id}", server.handleFindRouteResource)
	server.mux.HandleFunc("POST /api/route-resources", server.handleCreateRouteResource)
	server.mux.HandleFunc("PUT /api/route-resources/{id}", server.handleUpdateRouteResource)
	server.mux.HandleFunc("DELETE /api/route-resources/{id}", server.handleDeleteRouteResource)

	server.mux.HandleFunc("GET /api/model-configs", server.handleListModelConfigs)
	server.mux.HandleFunc("POST /api/model-configs", server.handleCreateModelConfig)
	server.mux.HandleFunc("/api/model-configs/", server.handleModelConfigSubtree)
	server.mux.HandleFunc("GET /api/ai-model-config", server.handleAIModelConfig)
	server.mux.HandleFunc("PUT /api/ai-model-config", server.handleAIModelConfig)

	server.mux.HandleFunc("/api/billing/", server.handleBilling)
	server.mux.HandleFunc("GET /api/site-config", server.handleSiteConfig)
	server.mux.HandleFunc("GET /api/admin/works", server.handleAdminWorks)
	server.mux.HandleFunc("GET /api/admin/works/", server.handleAdminWorks)
	server.mux.HandleFunc("/api/chat/", server.handleChat)
	server.mux.HandleFunc("/api/generation/", server.handleGeneration)
	server.mux.HandleFunc("/api/app/", server.handleAppEvents)
	server.mux.HandleFunc("/api/video-source/", server.handleVideoSource)
	server.mux.HandleFunc("/api/talking-video/", server.handleTalkingVideo)
	server.mux.HandleFunc("/api/video-understanding/", server.handleVideoUnderstanding)
	server.mux.HandleFunc("GET /api/agents", server.handleAgents)
	server.mux.HandleFunc("/api/content-planning", server.handleContentPlanning)
	server.mux.HandleFunc("/api/content-planning/", server.handleContentPlanning)
	server.mux.HandleFunc("/api/batch-generation/", server.handleBatchGeneration)
	server.mux.HandleFunc("/api/content/", server.handleContent)
	server.mux.HandleFunc("/api/discover/", server.handleDiscover)
	server.mux.HandleFunc("/api/admin/discover/", server.handleAdminDiscover)
	server.mux.HandleFunc("GET /api/system-settings/batch-request", server.handleBatchRequestSettings)
	server.mux.HandleFunc("PUT /api/system-settings/batch-request", server.handleBatchRequestSettings)
	server.mux.HandleFunc("GET /api/system-settings/file-storage", server.handleFileStorageSettings)
	server.mux.HandleFunc("PUT /api/system-settings/file-storage", server.handleFileStorageSettings)
	server.mux.HandleFunc("GET /api/system-settings/rate-limits", server.handleRateLimitSettings)
	server.mux.HandleFunc("PUT /api/system-settings/rate-limits", server.handleRateLimitSettings)
	server.mux.HandleFunc("GET /api/system-settings/ip-blacklist", server.handleIPBlacklistSettings)
	server.mux.HandleFunc("PUT /api/system-settings/ip-blacklist", server.handleIPBlacklistSettings)
	server.mux.HandleFunc("/api/access-logs/", server.handleAccessLogs)
	server.mux.HandleFunc("GET /api/access-logs", server.handleAccessLogs)
	server.mux.HandleFunc("/api/file-management/", server.handleFileManagement)
	server.mux.HandleFunc("GET /api/file-management", server.handleFileManagement)
	server.mux.Handle("/files/", withFileCache(http.StripPrefix("/files/", http.FileServer(http.Dir(filepath.Join(cfg.DataDir, "files"))))))
	server.mux.Handle("/", server.staticHandler())
	return server, nil
}

func (s *Server) Close() error {
	return s.store.Close()
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		startedAt := time.Now()
		s.mux.ServeHTTP(w, r)
		slog.Info("http request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(startedAt).String())
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "ai-marketing-desktop-server",
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if input.DisplayName == "" {
		input.DisplayName = input.Username
	}
	if len([]rune(input.Username)) < 3 || len([]rune(input.Password)) < 6 {
		writeError(w, http.StatusBadRequest, "账号至少 3 位，密码至少 6 位")
		return
	}

	user, err := s.store.CreateUser(input.Username, input.Password, input.DisplayName)
	if errors.Is(err, store.ErrUserAlreadyExists) {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建账号失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":  store.PublicUser(user),
		"token": s.tokens.Create(user.ID, user.Role, user.AuthVersion),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式错误")
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	user, found, err := s.store.FindUserByUsername(input.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	if !found || !store.VerifyPassword(input.Password, user) {
		writeError(w, http.StatusUnauthorized, "账号或密码不正确")
		return
	}
	if user.IsBlacklisted {
		writeError(w, http.StatusForbidden, "账号已被拉黑，请联系管理员")
		return
	}
	user.LastLoginAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.store.UpdateLastLogin(user.ID, user.LastLoginAt); err != nil {
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  store.PublicUser(user),
		"token": s.tokens.Create(user.ID, user.Role, user.AuthVersion),
	})
}

func (s *Server) handleCurrentUser(w http.ResponseWriter, r *http.Request) {
	user, ok := s.authenticatedUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "登录状态已失效，请重新登录")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": store.PublicUser(user)})
}

func (s *Server) authenticatedUser(r *http.Request) (store.User, bool) {
	token := auth.ExtractBearer(r.Header.Get("Authorization"))
	if token == "" {
		token = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	claims, err := s.tokens.Verify(token)
	if err != nil {
		return store.User{}, false
	}
	user, found, err := s.store.FindUserByID(claims.Subject)
	if err != nil || !found || user.AuthVersion != claims.AuthVersion || user.IsBlacklisted {
		return store.User{}, false
	}
	return user, true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write JSON response failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}

func withFileCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=2592000")
		next.ServeHTTP(w, r)
	})
}
