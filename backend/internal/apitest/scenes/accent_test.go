package scenes

import (
	"net/http"
	"strconv"
	"testing"

	"projmap/internal/apitest"
)

// (protocol §19) the object accent is optional (absent = off), validated, and survives deleting an accented object.
func TestObjectAccentValidation(t *testing.T) {
	h := apitest.New(t)
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if a, ok := sc["objectAccent"].(map[string]any); ok && a["on"] != false {
		t.Fatalf("the seeded accent is off: %v", a)
	}
	// a new scene has none (absent = off)
	fresh := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "fresh", "setupId": sc["setupId"]}).Map(t)
	if _, ok := fresh["objectAccent"]; ok {
		t.Fatal("a new scene has no objectAccent")
	}
	objID := sc["objects"].([]any)[0].(map[string]any)["id"].(string)
	good := map[string]any{"on": true, "objects": []any{objID}, "outline": map[string]any{"on": true, "width": 4, "color": "#ffcc00", "glow": 0.5},
		"fill": map[string]any{"on": true, "opacity": 0.8, "mode": "cut"}}
	patch := func(ops ...any) *apitest.Resp {
		v := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["version"]
		return h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": v, "ops": ops})
	}
	apitest.Expect(t, patch(map[string]any{"op": "add", "path": "/objectAccent", "value": good}), http.StatusOK)
	got := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["objectAccent"].(map[string]any)
	if got["on"] != true || got["outline"].(map[string]any)["color"] != "#ffcc00" || got["objects"].([]any)[0] != objID {
		t.Fatalf("accent %v", got)
	}
	// leaf edits (the editor's sliders) and "all"
	apitest.Expect(t, patch(map[string]any{"op": "replace", "path": "/objectAccent/objects", "value": "all"},
		map[string]any{"op": "replace", "path": "/objectAccent/fill/mode", "value": "only"}), http.StatusOK)
	for _, bad := range []map[string]any{
		{"op": "replace", "path": "/objectAccent/fill/mode", "value": "glow"},
		{"op": "replace", "path": "/objectAccent/outline/width", "value": 100},
		{"op": "replace", "path": "/objectAccent/outline/glow", "value": 1.5},
		{"op": "replace", "path": "/objectAccent/outline/color", "value": "white"},
		{"op": "replace", "path": "/objectAccent/fill/opacity", "value": -0.1},
		{"op": "replace", "path": "/objectAccent/objects", "value": "some"},
	} {
		if r := patch(bad); r.Status < 400 {
			t.Fatalf("%v was accepted", bad)
		}
	}
	// an accented object can still be deleted
	n := len(sc["objects"].([]any))
	apitest.Expect(t, patch(map[string]any{"op": "add", "path": "/objects/-", "value": map[string]any{"id": "obj_tmp", "name": "tmp", "tags": []any{}, "visible": true, "surfaces": []any{}}},
		map[string]any{"op": "replace", "path": "/objectAccent/objects", "value": []any{objID, "obj_tmp"}}), http.StatusOK)
	apitest.Expect(t, patch(map[string]any{"op": "remove", "path": "/objects/" + strconv.Itoa(n)}), http.StatusOK)
}
