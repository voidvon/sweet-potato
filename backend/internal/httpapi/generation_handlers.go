package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleGeneration(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "web.module.chat"); !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/generation"), "/"))
	if len(parts) == 1 && parts[0] == "events" {
		s.handleUserEventStream(w, r, "generation-job-updated")
		return
	}
	if len(parts) == 2 && parts[0] == "jobs" && r.Method == http.MethodGet {
		user, _ := s.authenticatedUser(r)
		job, found, err := s.store.FindGenerationJob(parts[1], user.ID)
		if err != nil {
			writeError(w, 500, "任务读取失败")
			return
		}
		if !found {
			writeError(w, 404, "任务不存在")
			return
		}
		items, err := s.store.ListGenerationItems(job.ID)
		if err != nil {
			writeError(w, 500, "任务明细读取失败")
			return
		}
		writeJSON(w, 200, map[string]any{"job": job, "items": items})
		return
	}
	writeError(w, 404, "generation 接口不存在")
}

func (s *Server) handleAppEvents(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	parts := splitPath(strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/api/app"), "/"))
	if len(parts) == 1 && parts[0] == "events" {
		s.handleUserEventStream(w, r, "app-event")
		return
	}
	writeError(w, 404, "应用事件接口不存在")
}

func (s *Server) handleUserEventStream(w http.ResponseWriter, r *http.Request, eventType string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, 500, "当前服务器不支持事件流")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	_, _ = io.WriteString(w, fmt.Sprintf("event: %s\ndata: {\"connected\":true}\n\n", eventType))
	flusher.Flush()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			_, _ = io.WriteString(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}
