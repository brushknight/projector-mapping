package assets

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

func TestAssets(t *testing.T) {
	h := apitest.New(t)
	png := apitest.PNG(40, 30)
	r := h.Do("POST", "/api/v1/assets", apitest.File("a.png", png, map[string]string{"kind": "reference"}))
	apitest.Expect(t, r, http.StatusCreated)
	a := r.Map(t)
	sha := a["sha"].(string)
	if len(sha) != 64 || a["mime"] != "image/png" || a["width"] != float64(40) || a["height"] != float64(30) || a["kind"] != "reference" || a["bytes"] != float64(len(png)) {
		t.Fatalf("asset %v", a)
	}
	if _, ok := a["thumb"]; ok {
		t.Fatal("small images get no thumbnail")
	}
	b := h.Do("GET", "/a/"+sha, nil)
	apitest.Expect(t, b, http.StatusOK)
	if string(b.Body) != string(png) || b.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" || b.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("bytes %v", b.Header)
	}
	// same bytes, same asset
	if h.Do("POST", "/api/v1/assets", apitest.File("b.png", png, nil)).Map(t)["sha"] != sha {
		t.Fatal("content addressed")
	}
	// a large photo gets a thumbnail
	big := h.Do("POST", "/api/v1/assets", apitest.File("big.jpg", apitest.JPEG(1200, 800), nil)).Map(t)
	if big["mime"] != "image/jpeg" || big["kind"] != "photo" || big["thumb"] == nil {
		t.Fatalf("photo %v", big)
	}
	th := h.Do("GET", "/api/v1/assets/"+big["thumb"].(string), nil).Map(t)
	if th["width"] != float64(512) || th["kind"] != "thumb" {
		t.Fatalf("thumb %v", th)
	}
	// HEIC is stored as is
	heic := append([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'h', 'e', 'i', 'c', 0, 0, 0, 0}, make([]byte, 100)...)
	hr := h.Do("POST", "/api/v1/assets", apitest.File("x.heic", heic, nil)).Map(t)
	if hr["mime"] != "image/heic" || hr["width"] != float64(0) {
		t.Fatalf("heic %v", hr)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/assets", apitest.File("a.png", png, map[string]string{"kind": "music"})), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/assets", map[string]any{}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("GET", "/a/"+sha[:60]+"0000", nil), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/assets/nope", nil), http.StatusNotFound, "not_found")
}

func TestWebFallback(t *testing.T) {
	h := apitest.New(t)
	for _, p := range []string{"/", "/out", "/preview?w=400", "/editor/map", "/components"} {
		r := h.Do("GET", p, nil)
		apitest.Expect(t, r, http.StatusOK)
		if r.Header.Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("%s: %s", p, r.Header.Get("Content-Type"))
		}
	}
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/nope", nil), http.StatusNotFound, "not_found")
}
