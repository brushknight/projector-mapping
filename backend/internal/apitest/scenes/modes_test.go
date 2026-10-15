package scenes

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"projmap/internal/apitest"
	"projmap/internal/infrastructure/database/sqlite"
)

func stackLen(t *testing.T, sc map[string]any, mode string) int {
	t.Helper()
	return len(sc["backdrop"].(map[string]any)[mode].(map[string]any)["layers"].([]any))
}

func attLen(t *testing.T, sc map[string]any, mode string) int {
	t.Helper()
	return len(sc["backdrop"].(map[string]any)[mode].(map[string]any)["attachments"].([]any))
}

func TestModeSwitch(t *testing.T) {
	h := apitest.New(t)
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if sc["mode"] != "static" || sc["kind"] != "mapping" || stackLen(t, sc, "static") != 0 || attLen(t, sc, "static") != 1 || stackLen(t, sc, "live") != 1 ||
		attLen(t, sc, "live") != 1 || stackLen(t, sc, "color") != 2 || stackLen(t, sc, "scenery") != 1 {
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
	// a static pick replaces the attachments and leaves the others
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	att := sc["backdrop"].(map[string]any)["static"].(map[string]any)["attachments"].([]any)[0].(map[string]any)
	att["gobo"], att["name"] = "blinds", "blinds"
	att["params"] = map[string]any{"slats": 14}
	r = h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sc["version"], "ops": []any{op("replace", "/backdrop/static/attachments", []any{att}), op("replace", "/mode", "static")}})
	apitest.Expect(t, r, http.StatusOK)
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if attLen(t, sc, "static") != 1 || stackLen(t, sc, "live") != 1 || sc["mode"] != "static" {
		t.Fatalf("after the pick %v", sc["backdrop"])
	}
	// the static stack takes no layers
	gobo := map[string]any{"id": "lay_g", "kind": "gobo", "ref": "window", "name": "w", "visible": true, "opacity": 1, "blend": "normal",
		"light": map[string]any{"intensity": 0.8, "softness": 0.5, "angle": 0, "scale": 1, "offsetX": 0, "offsetY": 0,
			"color": map[string]any{"mode": "cct", "kelvin": 3200, "tint": 0, "hue": 0, "sat": 0}, "fx": map[string]any{"kind": "none", "speed": 0.3}}, "params": map[string]any{}}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sc["version"], "ops": []any{op("replace", "/backdrop/static/layers", []any{gobo})}}), http.StatusUnprocessableEntity, "invalid")
	// a slide drag lands on the light
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": 0, "ops": []any{op("replace", "/backdrop/static/light/slide/x", 0.25)}}), http.StatusOK)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": 0, "ops": []any{op("replace", "/backdrop/static/light/focus", 3)}}), http.StatusUnprocessableEntity, "invalid")
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
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

// readV3 is the scene fixture as it was before the light model (gobo layers in static and live, no kind).
func readV3(t *testing.T, name string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "domain", "scene", "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// storeRaw replaces stored rows while the server is down.
func storeRaw(t *testing.T, dir string, f func(db *gorm.DB)) {
	t.Helper()
	db, err := sqlite.Open(filepath.Join(dir, "projmap.db"))
	if err != nil {
		t.Fatal(err)
	}
	f(db)
	if s, err := db.DB(); err == nil {
		_ = s.Close()
	}
}

// A scene stored before modes (one backdrop stack) is upgraded on start: gobos to static attachments, procedural to
// live (with the gobos as attachments over them), gradients to color, photos to scenery.
func TestUpgradeOnStart(t *testing.T) {
	h := apitest.New(t)
	h.Restart(func(dir string) {
		storeRaw(t, dir, func(db *gorm.DB) {
			m := readV3(t, "scene-v3.json")
			bd := m["backdrop"].(map[string]any)
			var layers []any
			for _, k := range []string{"static", "live", "color", "scenery"} {
				for _, l := range bd[k].(map[string]any)["layers"].([]any) {
					if id := l.(map[string]any)["id"]; id != "lay_live_window" && id != "lay_waves" {
						layers = append(layers, l)
					}
				}
			}
			m["backdrop"] = map[string]any{"layers": layers}
			m["objects"], m["points"] = []any{}, []any{}
			m["timeline"] = map[string]any{"duration": 20}
			delete(m, "mode")
			delete(m, "underlay")
			delete(m, "sounds")
			b, _ := json.Marshal(m)
			if err := db.Exec("UPDATE scenes SET doc = ?, kind = '', mode = '' WHERE id = ?", string(b), "scn_desk").Error; err != nil {
				t.Fatal(err)
			}
		})
	})
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if sc["mode"] != "live" || sc["kind"] != "live" || stackLen(t, sc, "static") != 0 || attLen(t, sc, "static") != 1 || stackLen(t, sc, "live") != 1 ||
		attLen(t, sc, "live") != 1 || stackLen(t, sc, "color") != 1 || stackLen(t, sc, "scenery") != 1 {
		t.Fatalf("upgraded scene: mode %v, backdrop %v", sc["mode"], sc["backdrop"])
	}
	live := sc["backdrop"].(map[string]any)["live"].(map[string]any)
	if live["attachments"].([]any)[0].(map[string]any)["id"] != "lay_window_live" || live["layers"].([]any)[0].(map[string]any)["id"] != "lay_tree" || live["light"] == nil {
		t.Fatalf("live stack %v", live)
	}
	// the list carries the kind and mode
	l := h.Do("GET", "/api/v1/scenes", nil).List(t)
	if s := l[0].(map[string]any); s["kind"] != "live" || s["mode"] != "live" {
		t.Fatalf("list %v", l)
	}
	// the stored document was rewritten, not only upgraded in memory
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	n, err := h.App.Scenes.Service.UpgradeStored(ctx)
	if err != nil || n != 0 {
		t.Fatalf("second upgrade pass changed %d scenes (%v)", n, err)
	}
	// and it keeps taking patches on the new paths
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sc["version"], "ops": []any{op("replace", "/backdrop/live/layers/0/opacity", 0.5)}}), http.StatusOK)
}

// A scene and a preset stored before the light model (protocol §15) are rewritten on start: gobo layers become
// attachments, the stack light takes the first gobo's light, the scene gets a kind.
func TestUpgradeLightModelOnStart(t *testing.T) {
	h := apitest.New(t)
	h.Restart(func(dir string) {
		storeRaw(t, dir, func(db *gorm.DB) {
			m := readV3(t, "scene-v3.json")
			b, _ := json.Marshal(m)
			if err := db.Exec("UPDATE scenes SET doc = ?, kind = '', mode = '' WHERE id = ?", string(b), "scn_desk").Error; err != nil {
				t.Fatal(err)
			}
			p := readV3(t, "preset-v3.json")
			p["id"] = "pre_golden"
			b, _ = json.Marshal(p)
			if err := db.Exec("UPDATE presets SET doc = ? WHERE id = ?", string(b), "pre_golden").Error; err != nil {
				t.Fatal(err)
			}
		})
	})
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	st := sc["backdrop"].(map[string]any)["static"].(map[string]any)
	att := st["attachments"].([]any)[0].(map[string]any)
	light := st["light"].(map[string]any)
	if sc["kind"] != "mapping" || sc["mode"] != "static" || len(st["layers"].([]any)) != 0 || att["id"] != "lay_window" || att["gobo"] != "window" ||
		att["rotation"] != float64(-22) || att["scale"] != 1.4 || light["focus"].(float64) < 0.379 || light["focus"].(float64) > 0.381 || light["vignette"] != 0.3 {
		t.Fatalf("upgraded static %v kind %v", st, sc["kind"])
	}
	if l := h.Do("GET", "/api/v1/scenes", nil).List(t)[0].(map[string]any); l["kind"] != "mapping" || l["mode"] != "static" {
		t.Fatalf("summary %v", l)
	}
	var golden map[string]any
	for _, p := range h.Do("GET", "/api/v1/presets", nil).List(t) {
		if p.(map[string]any)["id"] == "pre_golden" {
			golden = p.(map[string]any)
		}
	}
	bd := golden["backdrop"].(map[string]any)
	if len(bd["layers"].([]any)) != 0 || len(bd["attachments"].([]any)) != 1 || bd["light"] == nil {
		t.Fatalf("upgraded preset %v", golden)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if n, err := h.App.Scenes.Service.UpgradeStored(ctx); err != nil || n != 0 {
		t.Fatalf("second pass %d %v", n, err)
	}
	if n, err := h.App.Scenes.Presets.UpgradeStored(ctx); err != nil || n != 0 {
		t.Fatalf("second preset pass %d %v", n, err)
	}
	// applying the upgraded preset replaces the static stack in its new shape
	apitest.Expect(t, h.Do("POST", "/api/v1/presets/pre_golden/apply", map[string]any{"sceneId": "scn_desk"}), http.StatusOK)
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if attLen(t, sc, "static") != 1 || sc["mode"] != "static" {
		t.Fatalf("after apply %v", sc["backdrop"])
	}
}
