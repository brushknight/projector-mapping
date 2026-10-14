package scenes

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

func op(o, path string, v any) map[string]any {
	return map[string]any{"op": o, "path": path, "value": v}
}

func TestScenes(t *testing.T) {
	h := apitest.New(t)
	l := h.Do("GET", "/api/v1/scenes", nil).List(t)
	if len(l) != 1 || l[0].(map[string]any)["version"] != float64(1) {
		t.Fatalf("scenes %v", l)
	}
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if len(sc["objects"].([]any)) != 3 || len(sc["points"].([]any)) != 41 {
		t.Fatalf("scene %v", sc["name"])
	}
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/scenes/scn_nope", nil), http.StatusNotFound, "not_found")
	r := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "Wall"})
	apitest.Expect(t, r, http.StatusCreated)
	nw := r.Map(t)
	if nw["setupId"] != "set_desk" || nw["version"] != float64(1) || len(nw["points"].([]any)) != 0 {
		t.Fatalf("new scene %v", nw)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": ""}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": "x", "setupId": "set_nope"}), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/scenes/scn_desk", nil), http.StatusConflict, "scene_active")
	apitest.Expect(t, h.Do("DELETE", "/api/v1/scenes/"+nw["id"].(string), nil), http.StatusNoContent)
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/scenes/"+nw["id"].(string), nil), http.StatusNotFound, "not_found")
}

func TestPatchStaleUndoHistory(t *testing.T) {
	h := apitest.New(t)
	p := func(base int, ops ...map[string]any) *apitest.Resp {
		return h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": base, "ops": ops})
	}
	r := p(1, op("add", "/points/-", map[string]any{"id": "p_new", "x": 10, "y": 20}))
	apitest.Expect(t, r, http.StatusOK)
	if r.Map(t)["version"] != float64(2) {
		t.Fatalf("version %s", r.Body)
	}
	// structural op on an old base: stale, with the current version
	m := apitest.ExpectErr(t, p(1, op("add", "/points/-", map[string]any{"id": "p_x", "x": 1, "y": 1})), http.StatusConflict, "stale")
	if m["version"] != float64(2) {
		t.Fatalf("stale body %v", m)
	}
	// leaf replace on an old base: applied
	apitest.Expect(t, p(1, op("replace", "/points/0/x", 961)), http.StatusOK)
	// validation: a surface pointing at a missing point
	apitest.ExpectErr(t, p(3, op("replace", "/objects/0/surfaces/0/pointIds/0", "p_missing")), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, p(3, op("replace", "/backdrop/layers/0/opacity", 3)), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, p(3, op("replace", "/backdrop/layers/0/ref", "nope")), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, p(3, op("replace", "/timeline/clips/0/effect", "nope")), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, p(3, op("replace", "/id", "x")), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, p(3, op("replace", "/nope/0", 1)), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, p(3), http.StatusBadRequest, "bad_request")
	// undo the leaf, then the add; redo the add
	if v := h.Do("POST", "/api/v1/scenes/scn_desk/undo", nil).Map(t)["version"]; v != float64(4) {
		t.Fatalf("undo version %v", v)
	}
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if sc["points"].([]any)[0].(map[string]any)["x"] != float64(960) {
		t.Fatal("undo restores x")
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/undo", nil), http.StatusOK)
	if n := len(h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["points"].([]any)); n != 41 {
		t.Fatalf("%d points after undo", n)
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/redo", nil), http.StatusOK)
	if n := len(h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["points"].([]any)); n != 42 {
		t.Fatalf("%d points after redo", n)
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/undo", nil), http.StatusOK)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/scn_desk/undo", nil), http.StatusConflict, "conflict")
	hist := h.Do("GET", "/api/v1/scenes/scn_desk/history?limit=2", nil).List(t)
	if len(hist) != 2 || hist[0].(map[string]any)["version"] != float64(7) || hist[0].(map[string]any)["author"] == "" {
		t.Fatalf("history %v", hist)
	}
	if len(h.Do("GET", "/api/v1/scenes/scn_desk/history", nil).List(t)) != 6 {
		t.Fatal("six commits")
	}
}

func TestPresets(t *testing.T) {
	h := apitest.New(t)
	l := h.Do("GET", "/api/v1/presets", nil).List(t)
	names := []string{}
	for _, p := range l {
		names = append(names, p.(map[string]any)["name"].(string))
	}
	if len(l) != 7 || names[0] != "golden hour" || names[6] != "flowers" {
		t.Fatalf("presets %v", names)
	}
	r := h.Do("POST", "/api/v1/presets", map[string]any{"name": "desk now", "mode": "live", "sceneId": "scn_desk"})
	apitest.Expect(t, r, http.StatusCreated)
	p := r.Map(t)
	if len(p["backdrop"].(map[string]any)["layers"].([]any)) != 2 || p["thumbAsset"] != nil || p["mode"] != "live" {
		t.Fatalf("preset %v", p)
	}
	// without a mode the preset takes the scene's mode (static in the fixture) and snapshots that stack only
	q := h.Do("POST", "/api/v1/presets", map[string]any{"name": "desk static", "sceneId": "scn_desk"}).Map(t)
	if q["mode"] != "static" || len(q["backdrop"].(map[string]any)["layers"].([]any)) != 1 {
		t.Fatalf("preset from the scene mode %v", q)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/presets", map[string]any{"name": "x", "mode": "loud"}), http.StatusBadRequest, "bad_request")
	v := h.Do("POST", "/api/v1/presets/pre_ember/apply", map[string]any{"sceneId": "scn_desk"}).Map(t)["version"]
	if v != float64(2) {
		t.Fatalf("apply version %v", v)
	}
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	bd := sc["backdrop"].(map[string]any)
	layers := bd["color"].(map[string]any)["layers"].([]any)
	if len(layers) != 1 || layers[0].(map[string]any)["kind"] != "gradient" || sc["mode"] != "color" {
		t.Fatalf("applying ember: mode %v, color layers %v", sc["mode"], layers)
	}
	// the other stacks keep their content
	if n := len(bd["live"].(map[string]any)["layers"].([]any)); n != 2 {
		t.Fatalf("live stack after a color preset: %d layers", n)
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/presets/pre_flowers/apply", map[string]any{}), http.StatusOK)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/presets/pre_nope/apply", map[string]any{"sceneId": "scn_desk"}), http.StatusNotFound, "not_found")
	apitest.Expect(t, h.Do("DELETE", "/api/v1/presets/"+p["id"].(string), nil), http.StatusNoContent)
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/presets/"+p["id"].(string), nil), http.StatusNotFound, "not_found")
}

func TestDrafts(t *testing.T) {
	h := apitest.New(t)
	r := h.Do("POST", "/api/v1/drafts", map[string]any{"sceneId": "scn_desk"})
	apitest.Expect(t, r, http.StatusCreated)
	d := r.Map(t)
	id := d["id"].(string)
	if d["baseVersion"] != float64(1) || d["status"] != "open" || d["author"] != "user:editor" || len(d["ops"].([]any)) != 0 {
		t.Fatalf("draft %v", d)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/drafts", map[string]any{}), http.StatusBadRequest, "bad_request")
	if len(h.Do("GET", "/api/v1/drafts?sceneId=scn_desk", nil).List(t)) != 1 {
		t.Fatal("one draft")
	}
	// draft ops go in over the draft channel
	ws := h.Connect("editor", "editor")
	ws.Sub("draft:" + id)
	ws.Send(apitest.Msg{T: "patch", Ch: "draft:" + id, ID: "d1", D: apitest.Data([]any{op("replace", "/name", "Desk (draft)")})})
	acked, snapped := false, false
	for !acked || !snapped {
		m := ws.NextWhere(func(m apitest.Msg) bool { return m.T == "ack" || (m.T == "snapshot" && m.Ch == "draft:"+id) }, "ack and draft snapshot")
		if m.T == "ack" {
			acked = m.Re == "d1"
			continue
		}
		var got struct{ Ops []any }
		m.Into(t, &got)
		snapped = len(got.Ops) == 1
	}
	view := h.Do("GET", "/api/v1/drafts/"+id+"/scene", nil).Map(t)
	if view["name"] != "Desk (draft)" {
		t.Fatalf("view %v", view["name"])
	}
	if h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["name"] != "Desk" {
		t.Fatal("a draft never changes the live scene")
	}
	// the live scene moves on; the draft still rebases
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": 1, "ops": []any{op("replace", "/points/0/y", 301)}}), http.StatusOK)
	a := h.Do("POST", "/api/v1/drafts/"+id+"/apply", nil)
	apitest.Expect(t, a, http.StatusOK)
	if a.Map(t)["version"] != float64(3) {
		t.Fatalf("apply %s", a.Body)
	}
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if sc["name"] != "Desk (draft)" || sc["points"].([]any)[0].(map[string]any)["y"] != float64(301) {
		t.Fatalf("applied scene %v", sc["name"])
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/drafts/"+id+"/apply", nil), http.StatusConflict, "conflict")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/drafts/"+id+"/discard", nil), http.StatusConflict, "conflict")
	d2 := h.Do("POST", "/api/v1/drafts", map[string]any{"sceneId": "scn_desk", "author": "agent:codex#9"}).Map(t)
	dd := h.Do("POST", "/api/v1/drafts/"+d2["id"].(string)+"/discard", nil).Map(t)
	if dd["status"] != "discarded" {
		t.Fatalf("discard %v", dd)
	}
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/drafts/drf_nope", nil), http.StatusNotFound, "not_found")
}

func TestFromPhoto(t *testing.T) {
	h := apitest.New(t)
	up := h.Do("POST", "/api/v1/assets", apitest.File("ref.png", apitest.PNG(64, 48), map[string]string{"kind": "reference"}))
	apitest.Expect(t, up, http.StatusCreated)
	sha := up.Map(t)["sha"].(string)
	r := h.Do("POST", "/api/v1/scenes/from-photo", map[string]any{"asset": sha, "position": "lens", "name": "Shelf"})
	apitest.Expect(t, r, http.StatusCreated)
	if r.Map(t)["name"] != "Shelf" {
		t.Fatalf("scene %s", r.Body)
	}
	if h.Do("GET", "/api/v1/setups/set_desk", nil).Map(t)["referenceAsset"] != sha {
		t.Fatal("a lens photo becomes the reference")
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/from-photo", map[string]any{"asset": "nope"}), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/from-photo", map[string]any{"asset": sha, "position": "moon"}), http.StatusBadRequest, "bad_request")
}
