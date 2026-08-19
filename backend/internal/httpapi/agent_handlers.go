package httpapi

import (
	"net/http"

	"ai-marketing-go/internal/store"
)

func (s *Server) handleAgents(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "web.module.chat"); !ok {
		return
	}
	items, err := s.store.ListAgents()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "智能体列表读取失败")
		return
	}
	if items == nil {
		items = []store.Agent{}
	}
	writeJSON(w, http.StatusOK, items)
}
