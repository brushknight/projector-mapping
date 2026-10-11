// Package web embeds the built React app (frontend builds into internal/web/dist) and serves it with an SPA
// fallback for /out, /preview, /editor/* and /components. Without a build it serves a page that says how to make one.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var dist embed.FS

// FS is the built app (nil when dist has no index.html).
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil
	}
	return sub
}

const placeholder = `<!doctype html><html><head><meta charset="utf-8"><title>projmap</title>
<style>body{background:#000;color:#F5F4F0;font:16px/1.5 "Roboto Mono",ui-monospace,monospace;display:grid;place-items:center;height:100vh;margin:0}
p{color:#8C8A85}code{color:#F5F4F0}</style></head><body><div><h1>projmap</h1>
<p>The web app is not built into this binary. Run <code>make build</code> in backend/ (or <code>make dev</code> for Vite).</p>
<p>The API answers at <code>/api/v1/info</code>.</p></div></body></html>`

// Handler serves the app.
func Handler() http.Handler {
	app := FS()
	if app == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write([]byte(placeholder))
		})
	}
	files := http.FileServer(http.FS(app))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p != "" && p != "." {
			if st, err := fs.Stat(app, p); err == nil && !st.IsDir() {
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		// SPA routes (/out, /preview, /editor/..., /components, /) get index.html
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, app, "index.html")
	})
}
