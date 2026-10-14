package scenes

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
	"projmap/internal/infrastructure/database/sqlite"
)

func stackLen(t *testing.T, sc map[string]any, mode string) int {
	t.Helper()
	return len(sc["backdrop"].(map[string]any)[mode].(map[string]any)["layers"].([]any))
}

func TestModeSwitch(t *testing.T) {
	h := apitest.New(t)
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if sc["mode"] != "static" || stackLen(t, sc, "static") != 1 || stackLen(t, sc, "live") != 2 || stackLen(t, sc, "color") != 1 || stackLen(t, sc, "scenery") != 1 {
		t.Fatalf("seeded scene: mode %v, backdrop %v", sc["mode"], sc["backdrop"])
	}
	if u := sc["underlay"].(map[string]any); u["on"] != false || u["from"] != "static" {
		t.Fatalf("underlay %v", u)
	}
	// a leaf replace of /mode applies on any base
	r := h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": 0, "ops": []any{op("replace", "/mode", "objects")}})
	apitest.Expect(t, r, http.StatusOK)
	if m := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["mode"]; m != "objects" {
		t.Fatalf("mode %v", m)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": 0, "ops": []any{op("replace", "/mode", "disco")}}), http.StatusUnprocessableEntity, "invalid")
	// a static pick replaces the whole static stack and leaves the others
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	gobo := sc["backdrop"].(map[string]any)["static"].(map[string]any)["layers"].([]any)[0].(map[string]any)
	gobo["id"], gobo["ref"], gobo["name"] = "lay_blinds", "blinds", "blinds"
	r = h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sc["version"], "ops": []any{op("replace", "/backdrop/static/layers", []any{gobo}), op("replace", "/mode", "static")}})
	apitest.Expect(t, r, http.StatusOK)
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if stackLen(t, sc, "static") != 1 || stackLen(t, sc, "live") != 2 || sc["mode"] != "static" {
		t.Fatalf("after the pick %v", sc["backdrop"])
	}
	// layer ids stay unique across stacks
	dup := map[string]any{"id": "lay_tree", "kind": "gradient", "ref": "ember", "name": "x", "visible": true, "opacity": 1, "blend": "normal", "light": nil, "params": map[string]any{}}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sc["version"], "ops": []any{op("add", "/backdrop/color/layers/-", dup)}}), http.StatusUnprocessableEntity, "invalid")
}

func TestModeCommand(t *testing.T) {
	h := apitest.New(t)
	ph := h.Connect("remote", "phone")
	ph.Sub("scene:scn_desk")
	ph.Send(apitest.Msg{T: "cmd", ID: "m1", D: apitest.Data(map[string]any{"name": "scene.mode", "args": map[string]any{"mode": "live"}})})
	got := ph.NextOn("patched", "scene:scn_desk")
	if !strings.Contains(string(got.D), `"/mode"`) || !strings.Contains(string(got.D), `"live"`) {
		t.Fatalf("patched %s", got.D)
	}
	if a := ph.Next("ack"); a.Re != "m1" {
		t.Fatalf("ack %+v", a)
	}
	ph.Send(apitest.Msg{T: "cmd", ID: "m2", D: apitest.Data(map[string]any{"name": "scene.mode", "args": map[string]any{"mode": "nope"}})})
	if e := ph.Next("error"); e.Re != "m2" || !strings.Contains(string(e.D), "mode") {
		t.Fatalf("error %s", e.D)
	}
}

func TestDrawingStrokes(t *testing.T) {
	h := apitest.New(t)
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	left := sc["objects"].([]any)[0].(map[string]any)["surfaces"].([]any)[1].(map[string]any)
	fx := left["effects"].([]any)[0].(map[string]any)
	if left["id"] != "srf_left" || fx["effect"] != "drawing" || fx["name"] != "sketch" || len(fx["params"].(map[string]any)["strokes"].([]any)) != 5 {
		t.Fatalf("fixture drawing %v", fx)
	}
	path := "/objects/0/surfaces/1/effects/0/params/strokes/-"
	good := map[string]any{"tool": "ellipse", "points": []any{[]any{0.2, 0.2}, []any{0.6, 0.5}}, "color": "#ffcc00", "width": 5, "fill": true}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sc["version"], "ops": []any{op("add", path, good)}}), http.StatusOK)
	poly := map[string]any{"tool": "polygon", "points": []any{[]any{0.1, 0.1}, []any{0.3, 0.1}, []any{0.2, 0.3}}, "color": "#ffffff", "width": 0, "fill": true}
	circle := map[string]any{"tool": "circle", "points": []any{[]any{0.5, 0.5}, []any{0.55, 0.5}}, "color": "#34c759", "width": 2}
	for _, st := range []map[string]any{poly, circle} {
		v := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["version"]
		apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": v, "ops": []any{op("add", path, st)}}), http.StatusOK)
	}
	for name, bad := range map[string]map[string]any{
		"polygon": {"tool": "polygon", "points": []any{[]any{0.1, 0.1}, []any{0.2, 0.2}}, "color": "#ffffff", "width": 2},
		"tool":    {"tool": "spray", "points": []any{[]any{0.1, 0.1}, []any{0.2, 0.2}}, "color": "#ffffff", "width": 2},
		"points":  {"tool": "line", "points": []any{[]any{0.1, 0.1}}, "color": "#ffffff", "width": 2},
		"color":   {"tool": "pen", "points": []any{[]any{0.1, 0.1}, []any{0.2, 0.2}}, "color": "red", "width": 2},
		"range":   {"tool": "pen", "points": []any{[]any{9, 0.1}, []any{0.2, 0.2}}, "color": "#ffffff", "width": 2},
	} {
		v := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["version"]
		r := h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": v, "ops": []any{op("add", path, bad)}})
		if r.Status != http.StatusUnprocessableEntity {
			t.Fatalf("bad stroke (%s) answered %d %s", name, r.Status, r.Body)
		}
	}
	// a clip can carry its own strokes and reveal them with its progress
	v := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["version"]
	clip := map[string]any{"id": "clp_draw", "trackId": "trk_faces", "effect": "drawing", "start": 0, "end": 3, "fadeIn": 0, "fadeOut": 0,
		"params": map[string]any{"reveal": 1, "strokes": []any{good}}}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": v, "ops": []any{op("add", "/timeline/clips/-", clip)}}), http.StatusOK)
}

// A scene stored before modes (one backdrop stack) is upgraded on start: gobos to static, procedural to live (with
// the gobos under them), gradients to color, photos to scenery.
func TestUpgradeOnStart(t *testing.T) {
	h := apitest.New(t)
	h.Restart(func(dir string) {
		db, err := sqlite.Open(filepath.Join(dir, "projmap.db"))
		if err != nil {
			t.Fatal(err)
		}
		var doc string
		if err := db.Raw("SELECT doc FROM scenes WHERE id = ?", "scn_desk").Scan(&doc).Error; err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		_ = json.Unmarshal([]byte(doc), &m)
		bd := m["backdrop"].(map[string]any)
		var layers []any
		for _, k := range []string{"static", "live", "color", "scenery"} {
			for _, l := range bd[k].(map[string]any)["layers"].([]any) {
				if l.(map[string]any)["id"] != "lay_live_window" {
					layers = append(layers, l)
				}
			}
		}
		m["backdrop"] = map[string]any{"layers": layers}
		delete(m, "mode")
		delete(m, "underlay")
		b, _ := json.Marshal(m)
		if err := db.Exec("UPDATE scenes SET doc = ? WHERE id = ?", string(b), "scn_desk").Error; err != nil {
			t.Fatal(err)
		}
		if s, err := db.DB(); err == nil {
			_ = s.Close()
		}
	})
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if sc["mode"] != "live" || stackLen(t, sc, "static") != 1 || stackLen(t, sc, "live") != 2 || stackLen(t, sc, "color") != 1 || stackLen(t, sc, "scenery") != 1 {
		t.Fatalf("upgraded scene: mode %v, backdrop %v", sc["mode"], sc["backdrop"])
	}
	live := sc["backdrop"].(map[string]any)["live"].(map[string]any)["layers"].([]any)
	if live[0].(map[string]any)["id"] != "lay_window_live" || live[1].(map[string]any)["id"] != "lay_tree" {
		t.Fatalf("live stack %v", live)
	}
	// the stored document was rewritten, not only upgraded in memory
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	n, err := h.App.Scenes.Service.UpgradeStored(ctx)
	if err != nil || n != 0 {
		t.Fatalf("second upgrade pass changed %d scenes (%v)", n, err)
	}
	// and it keeps taking patches on the new paths
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sc["version"], "ops": []any{op("replace", "/backdrop/live/layers/1/opacity", 0.5)}}), http.StatusOK)
}
