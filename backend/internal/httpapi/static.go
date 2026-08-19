package httpapi

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// The web and admin bundles are copied here during the release build. Keeping
// both bundles in the same filesystem makes the executable self-contained.
//
//go:embed static
var embeddedStatic embed.FS

func (s *Server) staticHandler() http.Handler {
	webFS, _ := fs.Sub(embeddedStatic, "static/web")
	adminFS, _ := fs.Sub(embeddedStatic, "static/admin")
	webServer := http.FileServer(http.FS(webFS))
	adminServer := http.FileServer(http.FS(adminFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin" || strings.HasPrefix(r.URL.Path, "/admin?") {
			http.Redirect(w, r, "/admin/", http.StatusPermanentRedirect)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/admin/") {
			serveEmbeddedSPA(w, r, "/admin/", adminFS, adminServer)
			return
		}
		serveEmbeddedSPA(w, r, "/", webFS, webServer)
	})
}

func serveEmbeddedSPA(w http.ResponseWriter, r *http.Request, prefix string, files fs.FS, fileServer http.Handler) {
	pathName := strings.TrimPrefix(r.URL.Path, prefix)
	pathName = strings.TrimPrefix(pathName, "/")
	if pathName != "" {
		if _, err := fs.Stat(files, pathName); err == nil {
			http.StripPrefix(prefix, fileServer).ServeHTTP(w, r)
			return
		}
	}

	index, err := fs.ReadFile(files, "index.html")
	if err != nil {
		http.Error(w, "静态资源未打包", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(index)
}
