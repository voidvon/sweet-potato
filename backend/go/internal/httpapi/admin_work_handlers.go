package httpapi

import (
	"net/http"
)

func (s *Server) handleAdminWorks(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r, "admin.route.all_works.view"); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "请求方法不支持")
		return
	}
	page, pageSize := queryPage(r, 1, 20)
	result, err := s.store.ListAdminWorks(page, pageSize, r.URL.Query().Get("username"), r.URL.Query().Get("search"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "作品列表获取失败")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
