package catalog

import (
	"io/fs"
	"net/http"
	"strings"
	"testing"

	"projmap/internal/apitest"
	builtin "projmap/internal/catalog"
)

func TestCatalog(t *testing.T) {
	h := apitest.New(t)
	m := h.Do("GET", "/api/v1/catalog", nil).Map(t)
	if m["version"] != float64(8) || len(m["gobos"].([]any)) < 45 || len(m["effects"].([]any)) != 12 {
		t.Fatalf("catalog %v", m["version"])
	}
	r := h.Do("GET", "/catalog/assets/scenery/flowers.jpg", nil)
	apitest.Expect(t, r, http.StatusOK)
	if r.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("content type %s", r.Header.Get("Content-Type"))
	}
	apitest.ExpectErr(t, h.Do("GET", "/catalog/assets/scenery/nope.jpg", nil), http.StatusNotFound, "not_found")
	// thumbnails (protocol §15): built into the server by the web build; unknown ids answer 404 without auth
	apitest.ExpectErr(t, h.Remote("GET", "/catalog/thumbs/nope.png", nil, ""), http.StatusNotFound, "not_found")
	if _, err := fs.Stat(builtin.Assets(), "thumbs/plate-grid-window.png"); err == nil {
		r := h.Remote("GET", "/catalog/thumbs/plate-grid-window.png", nil, "")
		apitest.Expect(t, r, http.StatusOK)
		if r.Header.Get("Content-Type") != "image/png" {
			t.Fatalf("thumb content type %s", r.Header.Get("Content-Type"))
		}
	}
	// (catalog 6) the removed attachments' thumbnails are gone
	apitest.ExpectErr(t, h.Remote("GET", "/catalog/thumbs/window-4.png", nil, ""), http.StatusNotFound, "not_found")
	// a plate's thumbnail is the light it projects; (catalog 8, §16 masks) the metal views are gone
	if _, err := fs.Stat(builtin.Assets(), "thumbs/plate-sunburst.png"); err == nil {
		apitest.Expect(t, h.Remote("GET", "/catalog/thumbs/plate-sunburst.png", nil, ""), http.StatusOK)
	}
	apitest.ExpectErr(t, h.Remote("GET", "/catalog/thumbs/plate-sunburst-metal.png", nil, ""), http.StatusNotFound, "not_found")
}

// (§16 masks) The pre-rendered plate masks: one-channel PNGs at 1024, 2048 and 4096 px for every plate, served as immutable
// catalog files.
func TestPlateMasks(t *testing.T) {
	h := apitest.New(t)
	cat := h.Do("GET", "/api/v1/catalog", nil).Map(t)
	for _, g := range cat["gobos"].([]any) {
		id := g.(map[string]any)["id"].(string)
		for _, size := range []string{"1024", "2048", "4096"} {
			if _, err := fs.Stat(builtin.Assets(), "masks/"+id+"-"+size+".png"); err != nil {
				t.Errorf("no mask %s at %s px", id, size)
			}
		}
	}
	r := h.Remote("GET", "/catalog/assets/masks/plate-sunburst-1024.png?v=x", nil, "")
	apitest.Expect(t, r, http.StatusOK)
	if r.Header.Get("Content-Type") != "image/png" || !strings.Contains(r.Header.Get("Cache-Control"), "immutable") {
		t.Fatalf("mask headers %v", r.Header)
	}
	b := r.Body
	// an 8-bit greyscale PNG, 1024 px square
	if len(b) < 33 || string(b[1:4]) != "PNG" || b[24] != 8 || b[25] != 0 || b[16] != 0 || b[17] != 0 || b[18] != 4 || b[19] != 0 {
		t.Fatalf("mask is not a 1024 px greyscale PNG")
	}
	apitest.ExpectErr(t, h.Remote("GET", "/catalog/assets/masks/nope-1024.png", nil, ""), http.StatusNotFound, "not_found")
}

func TestEffects(t *testing.T) {
	h := apitest.New(t)
	if n := len(h.Do("GET", "/api/v1/effects", nil).List(t)); n != 12 {
		t.Fatalf("%d effects", n)
	}
	src := "vec4 effect(vec2 uv, float t, float progress) { return vec4(vec3(step(uv.y, progress)), 1.0); }"
	r := h.Do("POST", "/api/v1/effects", map[string]any{"name": "bay sweep", "kind": "glsl", "source": src,
		"params": map[string]any{"speed": map[string]any{"type": "number", "min": 0, "max": 1, "default": 0.5}}})
	apitest.Expect(t, r, http.StatusCreated)
	e := r.Map(t)
	id := e["id"].(string)
	if e["origin"] != "user" || e["kind"] != "glsl" || e["source"] != src {
		t.Fatalf("effect %v", e)
	}
	apitest.Expect(t, h.Do("GET", "/api/v1/effects/"+id, nil), http.StatusOK)
	if n := len(h.Do("GET", "/api/v1/effects", nil).List(t)); n != 13 {
		t.Fatalf("%d effects after create", n)
	}
	u := h.Do("PUT", "/api/v1/effects/"+id, map[string]any{"source": "vec4 effect(vec2 uv, float t, float p) { return vec4(1.0); }"}).Map(t)
	if u["name"] != "bay sweep" || u["source"] == src {
		t.Fatalf("update %v", u)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/effects", map[string]any{"name": "x", "kind": "hlsl", "source": "x"}), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/effects", map[string]any{"name": "x", "kind": "glsl"}), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, h.Do("PUT", "/api/v1/effects/trace", map[string]any{"source": "x"}), http.StatusForbidden, "forbidden")
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/effects/trace", nil), http.StatusForbidden, "forbidden")
	apitest.Expect(t, h.Do("DELETE", "/api/v1/effects/"+id, nil), http.StatusNoContent)
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/effects/"+id, nil), http.StatusNotFound, "not_found")
}
