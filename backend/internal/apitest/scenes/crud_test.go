package scenes

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"projmap/internal/apitest"
	"projmap/internal/infrastructure/database/sqlite"
)

type summary struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	SetupID string `json:"setupId"`
	Version int64  `json:"version"`
	Kind    string `json:"kind"`
	Mode    string `json:"mode"`
}

func listSnap(t *testing.T, ws *apitest.WS) []summary {
	t.Helper()
	m := ws.NextOn("snapshot", "scenes")
	var l []summary
	m.Into(t, &l)
	if m.V == nil || *m.V < 1e12 {
		t.Fatalf("scenes snapshot v should be a ms timestamp: %v", m.V)
	}
	return l
}

func names(l []summary) string {
	var out []string
	for _, s := range l {
		out = append(out, s.Name)
	}
	return strings.Join(out, ",")
}

func TestSceneCRUD(t *testing.T) {
	h := apitest.New(t)
	ws := h.Connect("editor", "editor")
	if l := (func() []summary { m := ws.Sub("scenes"); var l []summary; m.Into(t, &l); return l })(); len(l) != 1 || l[0].ID != "scn_desk" {
		t.Fatalf("scenes %v", l)
	}

	// an empty scene on the active setup; the name is trimmed
	r := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "  Party  "})
	apitest.Expect(t, r, http.StatusCreated)
	party := r.Map(t)
	if party["name"] != "Party" || party["setupId"] != "set_desk" || party["mode"] != "static" || party["version"] != float64(1) ||
		len(party["objects"].([]any)) != 0 || party["timeline"].(map[string]any)["duration"] != float64(20) ||
		len(party["sounds"].(map[string]any)["pads"].([]any)) != 0 {
		t.Fatalf("new scene %s", r.Body)
	}
	partyID := party["id"].(string)
	if l := listSnap(t, ws); names(l) != "Desk,Party" {
		t.Fatalf("after create %v", l)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": "   "}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": strings.Repeat("x", 81)}), http.StatusBadRequest, "bad_request")
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": strings.Repeat("é", 80), "setupId": "set_desk"}), http.StatusCreated)
	listSnap(t, ws)

	// a duplicate is a deep copy with a new id and version 1, independent of its source
	pad := map[string]any{"id": "pad_bell", "name": "bell", "sound": "a77c31", "volume": 0.5, "color": "amber", "icon": "bell", "key": "b", "loop": false}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": 1, "ops": []any{op("add", "/sounds/pads/-", pad)}}), http.StatusOK)
	r = h.Do("POST", "/api/v1/scenes", map[string]any{"name": "Desk copy", "duplicate": "scn_desk"})
	apitest.Expect(t, r, http.StatusCreated)
	dup := r.Map(t)
	dupID := dup["id"].(string)
	if dupID == "scn_desk" || dup["version"] != float64(1) || dup["setupId"] != "set_desk" || dup["name"] != "Desk copy" ||
		len(dup["objects"].([]any)) != 3 || len(dup["sounds"].(map[string]any)["pads"].([]any)) != 1 {
		t.Fatalf("duplicate %v %v %v", dup["id"], dup["version"], dup["name"])
	}
	listSnap(t, ws)
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/"+dupID+"/patch", map[string]any{"base": 1, "ops": []any{
		op("replace", "/objects/0/name", "box"), op("replace", "/sounds/pads/0/volume", 1)}}), http.StatusOK)
	src := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if src["objects"].([]any)[0].(map[string]any)["name"] == "box" || src["sounds"].(map[string]any)["pads"].([]any)[0].(map[string]any)["volume"] != 0.5 {
		t.Fatal("editing the duplicate changed its source")
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": "x", "duplicate": "scn_nope"}), http.StatusNotFound, "not_found")

	// rename: PATCH {name} and a replace /name patch both publish the list
	r = h.Do("PATCH", "/api/v1/scenes/"+dupID, map[string]any{"name": " Late show "})
	apitest.Expect(t, r, http.StatusOK)
	var sum summary
	r.Into(t, &sum)
	if sum.Name != "Late show" || sum.ID != dupID || sum.Version != 3 || sum.SetupID != "set_desk" {
		t.Fatalf("rename %s", r.Body)
	}
	if l := listSnap(t, ws); !strings.Contains(names(l), "Late show") {
		t.Fatalf("after rename %v", l)
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/"+partyID+"/patch", map[string]any{"base": 1, "ops": []any{op("replace", "/name", "Dance")}}), http.StatusOK)
	if l := listSnap(t, ws); !strings.Contains(names(l), "Dance") {
		t.Fatalf("after patch rename %v", l)
	}
	// a mode change publishes the list too (summaries carry kind and mode)
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/"+partyID+"/patch", map[string]any{"base": 2, "ops": []any{op("replace", "/mode", "live")}}), http.StatusOK)
	found := false
	for _, s := range listSnap(t, ws) {
		found = found || (s.ID == partyID && s.Mode == "live" && s.Kind == "static")
	}
	if !found {
		t.Fatal("the list after a mode change shows the new mode")
	}
	// a patch that leaves the name, kind and mode alone does not publish the list
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/"+partyID+"/patch", map[string]any{"base": 3, "ops": []any{op("replace", "/underlay/level", 0.5)}}), http.StatusOK)
	ws.None(apitest.Is("snapshot", "scenes"), 150*1e6, "scenes snapshot after a non-name patch")
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/scenes/"+dupID, map[string]any{"name": ""}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/scenes/"+dupID, map[string]any{}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/scenes/scn_nope", map[string]any{"name": "x"}), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/"+partyID+"/patch", map[string]any{"base": 3, "ops": []any{op("replace", "/name", "")}}),
		http.StatusUnprocessableEntity, "invalid")

	// delete: never the active scene; another one leaves the list
	m := apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/scenes/scn_desk", nil), http.StatusConflict, "scene_active")
	if m["message"] != "Activate another scene first." {
		t.Fatalf("message %v", m["message"])
	}
	apitest.Expect(t, h.Do("DELETE", "/api/v1/scenes/"+partyID, nil), http.StatusNoContent)
	if l := listSnap(t, ws); strings.Contains(names(l), "Dance") || len(l) != 3 {
		t.Fatalf("after delete %v", l)
	}
	for _, s := range h.Do("GET", "/api/v1/scenes", nil).List(t) {
		if s.(map[string]any)["id"] == partyID {
			t.Fatal("the deleted scene is still listed")
		}
	}
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/scenes/"+partyID, nil), http.StatusNotFound, "not_found")
}

func TestActivate(t *testing.T) {
	h := apitest.New(t)
	other := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "Other"}).Map(t)["id"].(string)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/audio", map[string]any{"volume": 0.5, "output": "editor"}), http.StatusOK)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/blackout", map[string]any{"on": true}), http.StatusOK)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/go", nil), http.StatusOK)
	ws := h.Connect("remote", "phone")
	ws.Send(apitest.Msg{T: "cmd", ID: "c1", D: apitest.Data(map[string]any{"name": "show.activate", "args": map[string]any{"sceneId": other}})})
	ws.NextWhere(func(m apitest.Msg) bool { return m.T == "ack" && m.Re == "c1" }, "ack")
	s := h.Do("GET", "/api/v1/show", nil).Map(t)
	au := s["audio"].(map[string]any)
	if s["activeSceneId"] != other || s["activeSetupId"] != "set_desk" || s["transport"].(map[string]any)["state"] != "stopped" ||
		s["onAir"] != false || au["volume"] != 0.5 || au["output"] != "editor" || len(au["loops"].([]any)) != 0 {
		t.Fatalf("after activate %v", s)
	}
	apitest.Expect(t, h.Do("DELETE", "/api/v1/scenes/scn_desk", nil), http.StatusNoContent)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/activate", map[string]any{"sceneId": "scn_desk"}), http.StatusNotFound, "not_found")
}

// A fresh seeded server restarted before any show change keeps its active scene.
func TestActiveSceneSurvivesRestart(t *testing.T) {
	h := apitest.New(t)
	h.Restart(nil)
	s := h.Do("GET", "/api/v1/show", nil).Map(t)
	if s["activeSceneId"] != "scn_desk" || s["activeSetupId"] != "set_desk" {
		t.Fatalf("after a restart %v", s)
	}
	h.Restart(nil)
	if s := h.Do("GET", "/api/v1/show", nil).Map(t); s["activeSceneId"] != "scn_desk" {
		t.Fatalf("after a second restart %v", s)
	}
}

// When the stored active scene is gone, the first scene goes on the wall and the show is stored at once.
func TestActiveSceneDeletedUnderneath(t *testing.T) {
	h := apitest.New(t)
	b := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "B"}).Map(t)["id"].(string)
	c := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "C"}).Map(t)["id"].(string)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/activate", map[string]any{"sceneId": c}), http.StatusOK)
	h.Restart(func(dir string) {
		db, err := sqlite.Open(filepath.Join(dir, "projmap.db"))
		if err != nil {
			t.Fatal(err)
		}
		if err := db.WithContext(context.Background()).Exec("DELETE FROM scenes WHERE id = ?", c).Error; err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})
	if s := h.Do("GET", "/api/v1/show", nil).Map(t); s["activeSceneId"] != "scn_desk" {
		t.Fatalf("the first scene (in creation order) goes on the wall: %v", s)
	}
	_ = b
	h.Restart(nil)
	if s := h.Do("GET", "/api/v1/show", nil).Map(t); s["activeSceneId"] != "scn_desk" {
		t.Fatalf("it was stored: %v", s)
	}
	// with the desk scene gone too, B (the next in creation order) takes over
	h.Restart(func(dir string) {
		db, err := sqlite.Open(filepath.Join(dir, "projmap.db"))
		if err != nil {
			t.Fatal(err)
		}
		_ = db.Exec("DELETE FROM scenes WHERE id = 'scn_desk'").Error
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})
	if s := h.Do("GET", "/api/v1/show", nil).Map(t); s["activeSceneId"] != b {
		t.Fatalf("B goes on the wall: %v", s)
	}
}
