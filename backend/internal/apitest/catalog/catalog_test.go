package catalog

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

func TestCatalog(t *testing.T) {
	h := apitest.New(t)
	m := h.Do("GET", "/api/v1/catalog", nil).Map(t)
	if m["version"] != float64(2) || len(m["gobos"].([]any)) != 8 || len(m["effects"].([]any)) != 11 {
		t.Fatalf("catalog %v", m["version"])
	}
	r := h.Do("GET", "/catalog/assets/scenery/flowers.jpg", nil)
	apitest.Expect(t, r, http.StatusOK)
	if r.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("content type %s", r.Header.Get("Content-Type"))
	}
	apitest.ExpectErr(t, h.Do("GET", "/catalog/assets/scenery/nope.jpg", nil), http.StatusNotFound, "not_found")
}

func TestEffects(t *testing.T) {
	h := apitest.New(t)
	if n := len(h.Do("GET", "/api/v1/effects", nil).List(t)); n != 11 {
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
	if n := len(h.Do("GET", "/api/v1/effects", nil).List(t)); n != 12 {
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
