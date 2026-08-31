package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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
			renderAuthorized := s.validRenderFileToken(name, r.URL.Query().Get("render_token"))
			if renderAuthorized {
				// Remotion's CanvasImage fetches media from its Chromium bundle,
				// which runs on a separate ephemeral localhost origin. The signed
				// URL is already a short-lived bearer capability bound to this exact
				// file, so expose CORS only for that authorized render request.
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
			} else {
				user, authenticated := s.authenticatedUser(r)
				if !authenticated || (user.Role != "admin" && user.ID != asset.UserID) {
					writeError(w, http.StatusForbidden, "无权访问该文件")
					return
				}
			}
		}
		filePath := filepath.Join(root, name)
		http.ServeFile(w, r, filePath)
	})
}

func (s *Server) renderFileToken(name string, expiresAt time.Time) string {
	expires := strconv.FormatInt(expiresAt.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(s.config.AuthTokenSecret))
	_, _ = mac.Write([]byte(name + "\n" + expires))
	return expires + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) validRenderFileToken(name, token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	expires, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || time.Now().Unix() > expires {
		return false
	}
	expected := s.renderFileToken(name, time.Unix(expires, 0))
	return hmac.Equal([]byte(expected), []byte(token))
}
