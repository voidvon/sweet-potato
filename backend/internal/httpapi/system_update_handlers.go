package httpapi

import (
	"context"
	"net/http"
	"time"
)

func (s *Server) handleSystemUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, permissionAbout); !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	info, err := s.updater.Check(ctx)
	if err != nil {
		info.CheckError = err.Error()
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleSystemUpdate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r, permissionAbout)
	if !ok {
		return
	}
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "仅系统管理员可以更新服务器")
		return
	}
	s.updateMu.Lock()
	if s.updating {
		s.updateMu.Unlock()
		writeError(w, http.StatusConflict, "服务器更新已在进行中")
		return
	}
	s.updating = true
	s.updateMu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	update, err := s.updater.Stage(ctx)
	if err != nil {
		s.updateMu.Lock()
		s.updating = false
		s.updateMu.Unlock()
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok":         true,
		"version":    update.Version,
		"restarting": true,
	})
	time.AfterFunc(300*time.Millisecond, func() {
		s.updateReady <- update
	})
}
