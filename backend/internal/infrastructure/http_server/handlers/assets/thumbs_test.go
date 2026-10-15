package assets

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	httpserver "projmap/internal/infrastructure/http_server"
)

func TestCatalogThumbs(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nfake")
	jpg := []byte("\xff\xd8\xff\xe0fake")
	files := fstest.MapFS{"thumbs/window-4.png": {Data: png}, "thumbs/tree-sway-anim.jpg": {Data: jpg}, "scenery/flowers.jpg": {Data: []byte("jpg")}}
	e := httpserver.New(nil)
	New(nil, files).RegisterRoutes(e, e.Group("/api/v1"))
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "127.0.0.1:50000"
		e.ServeHTTP(rec, req)
		return rec
	}
	r := get("/catalog/thumbs/window-4.png")
	if r.Code != http.StatusOK || r.Header().Get("Content-Type") != "image/png" || r.Header().Get("Cache-Control") != "public, max-age=86400" || r.Body.String() != string(png) {
		t.Fatalf("thumb %d %v %q", r.Code, r.Header(), r.Body.String())
	}
	if r := get("/catalog/assets/thumbs/window-4.png"); r.Code != http.StatusOK {
		t.Fatalf("the same file under /catalog/assets: %d", r.Code)
	}
	// (§16) a live layer's animated strip
	r = get("/catalog/thumbs/tree-sway-anim.jpg")
	if r.Code != http.StatusOK || r.Header().Get("Content-Type") != "image/jpeg" || r.Header().Get("Cache-Control") != "public, max-age=86400" || r.Body.String() != string(jpg) {
		t.Fatalf("anim strip %d %v", r.Code, r.Header())
	}
	if r := get("/catalog/assets/thumbs/tree-sway-anim.jpg"); r.Code != http.StatusOK {
		t.Fatalf("the strip under /catalog/assets: %d", r.Code)
	}
	for _, bad := range []string{"/catalog/thumbs/nope.png", "/catalog/thumbs/window-4.jpg", "/catalog/thumbs/..png", "/catalog/thumbs/.png", "/catalog/thumbs/nope-anim.jpg", "/catalog/thumbs/-anim.jpg", "/catalog/thumbs/tree-sway.jpg"} {
		if r := get(bad); r.Code != http.StatusNotFound {
			t.Errorf("%s answered %d", bad, r.Code)
		}
	}
}
