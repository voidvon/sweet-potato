package httpapi

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// The unified Web bundle is copied here during the release build and serves
// both the main application and /admin routes.
//
//go:embed static
var embeddedStatic embed.FS

func (s *Server) staticHandler() http.Handler {
	webFS, _ := fs.Sub(embeddedStatic, "static/web")
	webServer := http.FileServer(http.FS(webFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
