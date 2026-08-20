package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"sweet-potato-go/internal/auth"
	"sweet-potato-go/internal/config"
	"sweet-potato-go/internal/store"
	"sweet-potato-go/internal/vod"
)

type Server struct {
	config       config.Config
	mux          *http.ServeMux
	store        *store.Store
	tokens       *auth.TokenManager
	vod          *vod.Client
	rateMu       sync.Mutex
	rateRules    []store.RateLimitRule
	rateLoadedAt time.Time
	rateWindows  map[string]rateLimitWindow
	ipMu         sync.Mutex
	ipRules      []string
	ipLoadedAt   time.Time
	accessCount  atomic.Uint64
	taskCtx      context.Context
	taskCancel   context.CancelFunc
	taskWG       sync.WaitGroup
}

func New(cfg config.Config) (*Server, error) {
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "files"), 0o700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	dataStore, err := store.Open(cfg.DataDir)
	if err != nil {
		return nil, err
	}

	taskCtx, taskCancel := context.WithCancel(context.Background())
	server := &Server{
		config: cfg,
		mux:    http.NewServeMux(),
		store:  dataStore,
		tokens: auth.NewTokenManager(cfg.AuthTokenSecret, cfg.AuthTokenExpiresIn),
		vod: vod.New(vod.Config{
			AccessKey:        cfg.VODAccessKey,
			SecretKey:        cfg.VODSecretKey,
			SpaceName:        cfg.VODSpaceName,
			Region:           cfg.VODRegion,
			UploadHostPrefer: cfg.VODUploadHostPrefer,
			PlaybackBaseURL:  cfg.VODPlaybackBaseURL,
			PollInterval:     cfg.VODPollInterval,
			PollMaxAttempts:  cfg.VODPollMaxAttempts,
			TaskTimeout:      cfg.VODTaskTimeout,
		}),
		rateWindows: make(map[string]rateLimitWindow),
		taskCtx:     taskCtx,
		taskCancel:  taskCancel,
	}
	server.mux.HandleFunc("GET /api/health", server.handleHealth)
	server.mux.HandleFunc("GET /health", server.handleHealth)
	server.mux.HandleFunc("POST /api/auth/register", server.handleRegister)
	server.mux.HandleFunc("POST /api/auth/login", server.handleLogin)
	server.mux.HandleFunc("POST /api/auth/logout", server.handleLogout)
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
	server.mux.HandleFunc("GET /api/user-model-configs", server.handleListUserModelConfigs)
	server.mux.HandleFunc("POST /api/user-model-configs", server.handleCreateUserModelConfig)
	server.mux.HandleFunc("/api/user-model-configs/", server.handleUserModelConfigSubtree)

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
	server.mux.Handle("/files/", server.fileHandler())
	server.mux.Handle("/", server.staticHandler())
	server.resumeVODTasks()
	return server, nil
}

func (s *Server) Close() error {
	if s.taskCancel != nil {
		s.taskCancel()
	}
	s.taskWG.Wait()
	return s.store.Close()
}

func (s *Server) startBackgroundTask(task func()) {
	s.taskWG.Add(1)
	go func() {
		defer s.taskWG.Done()
		task()
	}()
}

func (s *Server) taskContext() context.Context {
	if s.taskCtx != nil {
		return s.taskCtx
	}
	return context.Background()
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w = &localizedResponseWriter{ResponseWriter: w, language: resolveRequestLanguage(r.Header.Get("Accept-Language"))}
		if origin := allowedCORSOrigin(r); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Accept-Language, Authorization, Content-Type, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		startedAt := time.Now()
		if status, ok := s.applyCSRFGuard(w, r); !ok {
			user, _ := s.authenticatedUser(r)
			s.recordAccess(w, r, startedAt, status, user)
			return
		}
		if status, ok := s.applyRequestGuards(w, r); !ok {
			s.recordAccess(w, r, startedAt, status, store.User{})
			return
		}
		user, _ := s.authenticatedUser(r)
		request := r.WithContext(withAuthenticatedUser(r.Context(), user))
		response := &statusResponseWriter{ResponseWriter: w}
		s.mux.ServeHTTP(response, request)
		status := response.status
		if status == 0 {
			status = http.StatusOK
		}
		s.recordAccess(response, request, startedAt, status, user)
		slog.Info("http request", "method", r.Method, "path", r.URL.Path, "status", status, "duration", time.Since(startedAt).String())
	})
}

func (s *Server) applyCSRFGuard(w http.ResponseWriter, r *http.Request) (int, bool) {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return 0, true
	}
	cookie, err := r.Cookie(authCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return 0, true
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" || origin == "null" || allowedCORSOrigin(r) != "" {
		return 0, true
	}
	writeError(w, http.StatusForbidden, "请求来源不受信任")
	return http.StatusForbidden, false
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "sweet-potato-server",
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
	token := s.tokens.Create(user.ID, user.Role, user.AuthVersion)
	s.setAuthCookie(w, r, token)
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":  store.PublicUser(user),
		"token": token,
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
	if store.PasswordHashNeedsUpgrade(user) {
		if err := s.store.UpdatePassword(user.ID, input.Password); err != nil {
			writeError(w, http.StatusInternalServerError, "登录失败")
			return
		}
		user, found, err = s.store.FindUserByID(user.ID)
		if err != nil || !found {
			writeError(w, http.StatusInternalServerError, "登录失败")
			return
		}
	}
	user.LastLoginAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.store.UpdateLastLogin(user.ID, user.LastLoginAt); err != nil {
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	token := s.tokens.Create(user.ID, user.Role, user.AuthVersion)
	s.setAuthCookie(w, r, token)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  store.PublicUser(user),
		"token": token,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: authCookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(0, 0)})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCurrentUser(w http.ResponseWriter, r *http.Request) {
	user, ok := s.authenticatedUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "登录状态已失效，请重新登录")
		return
	}
	if token := auth.ExtractBearer(r.Header.Get("Authorization")); token != "" {
		s.setAuthCookie(w, r, token)
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": store.PublicUser(user)})
}

func (s *Server) authenticatedUser(r *http.Request) (store.User, bool) {
	if user, ok := r.Context().Value(authenticatedUserContextKey{}).(store.User); ok && user.ID != "" {
		return user, true
	}
	token := auth.ExtractBearer(r.Header.Get("Authorization"))
	if token == "" {
		if cookie, err := r.Cookie(authCookieName); err == nil {
			token = strings.TrimSpace(cookie.Value)
		}
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

const authCookieName = "sweet_potato_session"

func (s *Server) setAuthCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: authCookieName, Value: token, Path: "/", HttpOnly: true,
		Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode,
		MaxAge: int(s.config.AuthTokenExpiresIn / time.Second),
	})
}

func allowedCORSOrigin(r *http.Request) string {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return ""
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	if strings.EqualFold(parsed.Host, r.Host) {
		return origin
	}
	hostname := strings.TrimSpace(parsed.Hostname())
	if (strings.EqualFold(hostname, "localhost") || net.ParseIP(hostname) != nil && net.ParseIP(hostname).IsLoopback()) && parsed.Port() == frontendPort() {
		return origin
	}
	return ""
}

func frontendPort() string {
	if port := strings.TrimSpace(os.Getenv("FRONTEND_PORT")); port != "" {
		return port
	}
	return "9527"
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write JSON response failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	language := responseLanguage(w)
	w.Header().Set("Content-Language", language)
	w.Header().Add("Vary", "Accept-Language")
	writeJSON(w, status, map[string]string{
		"code":    errorCodeForStatus(status),
		"message": localizedErrorMessage(language, status, message),
	})
}
