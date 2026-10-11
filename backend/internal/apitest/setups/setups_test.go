package setups

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

func TestSetups(t *testing.T) {
	h := apitest.New(t)
	l := h.Do("GET", "/api/v1/setups", nil).List(t)
	if len(l) != 1 || l[0].(map[string]any)["id"] != "set_desk" {
		t.Fatalf("setups %v", l)
	}
	s := h.Do("PATCH", "/api/v1/setups/set_desk", map[string]any{"testPattern": "grid", "output": map[string]any{"orientation": "portrait-cw"}}).Map(t)
	out := s["output"].(map[string]any)
	if s["testPattern"] != "grid" || out["orientation"] != "portrait-cw" || out["width"] != float64(1920) {
		t.Fatalf("merge %v", s)
	}
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/setups/set_desk", map[string]any{"output": map[string]any{"orientation": "sideways"}}), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/setups/set_desk", map[string]any{"master": 2}), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/setups/set_nope", map[string]any{}), http.StatusNotFound, "not_found")
	r := h.Do("POST", "/api/v1/setups", map[string]any{"name": "Wall projector"})
	apitest.Expect(t, r, http.StatusCreated)
	id := r.Map(t)["id"].(string)
	g := h.Do("GET", "/api/v1/setups/"+id, nil).Map(t)
	if g["master"] != float64(1) || g["testPattern"] != "off" || g["referenceAsset"] != nil {
		t.Fatalf("new setup %v", g)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/setups", map[string]any{}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/setups/set_desk", nil), http.StatusConflict, "conflict")
	apitest.Expect(t, h.Do("DELETE", "/api/v1/setups/"+id, nil), http.StatusNoContent)
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/setups/"+id, nil), http.StatusNotFound, "not_found")
}
