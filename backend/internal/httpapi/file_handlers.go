package httpapi

import (
	"net/http"
	"path/filepath"
	"strings"
)

func (s *Server) fileHandler() http.Handler {
	root := filepath.Join(s.config.DataDir, "files")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(filepath.Clean(strings.TrimPrefix(r.URL.Path, "/files/")), "./")
		if name == "" || name == "." || strings.Contains(name, "..") || filepath.Base(name) != name {
			writeError(w, http.StatusBadRequest, "文件地址无效")
			return
		}
		asset, found, err := s.store.FindContentAssetByStoredFileName(name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "文件读取失败")
			return
		}
		if !found {
			w.Header().Set("Cache-Control", "private, no-store")
			http.NotFound(w, r)
			return
		}
		public, publicErr := s.store.IsPublicDiscoverFile(name)
		if publicErr != nil {
			writeError(w, http.StatusInternalServerError, "文件读取失败")
			return
		}
		if public {
			w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
		} else {
			w.Header().Set("Cache-Control", "private, no-store")
			user, authenticated := s.authenticatedUser(r)
			if !authenticated || (user.Role != "admin" && user.ID != asset.UserID) {
				writeError(w, http.StatusForbidden, "无权访问该文件")
				return
			}
		}
		filePath := filepath.Join(root, name)
		http.ServeFile(w, r, filePath)
	})
}
