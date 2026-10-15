package mcp

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
)

var attID = regexp.MustCompile(`att_[0-9a-z]{8}`)

func backdropOf(t *testing.T, sc map[string]any, mode string) map[string]any {
	t.Helper()
	return sc["backdrop"].(map[string]any)[mode].(map[string]any)
}

func TestBackdropToolsList(t *testing.T) {
	h := apitest.New(t)
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	tl, err := s.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	have := map[string]bool{}
	for _, x := range tl.Tools {
		have[x.Name] = x.Description != "" && x.InputSchema != nil
	}
	for _, n := range []string{"catalog_get", "scene_list", "scene_create", "scene_activate", "mode_set", "light_set", "attachment_add",
		"attachment_update", "attachment_remove", "gobo_set", "backdrop_set", "motion_set", "preset_apply"} {
		if !have[n] {
			t.Errorf("missing tool %s (or its description or schema)", n)
		}
	}

	text, res := call(t, s, "catalog_get", nil)
	for _, want := range []string{"window-4", "sun-lr", "static-window", "hue-cycle", "tree-sway", "flowers", `"videos": []`, `"sounds": []`, "throw"} {
		if res.IsError || !strings.Contains(text, want) {
			t.Fatalf("catalog_get misses %s: %s", want, text[:min(len(text), 400)])
		}
	}
	text, res = call(t, s, "catalog_get", map[string]any{"section": "gobos"})
	if res.IsError || !strings.Contains(text, "blinds-fine") || strings.Contains(text, "hue-cycle") {
		t.Fatalf("catalog_get gobos %s", text[:min(len(text), 300)])
	}
	if text, res = call(t, s, "catalog_get", map[string]any{"section": "lasers"}); !res.IsError || !strings.Contains(text, "section must be") {
		t.Fatalf("bad section %s", text)
	}
	text, res = call(t, s, "scene_list", nil)
	if res.IsError || !strings.Contains(text, `"kind": "mapping"`) || !strings.Contains(text, `"onWall": true`) || !strings.Contains(text, "switch is off") {
		t.Fatalf("scene_list %s", text)
	}
}

// With "agents edit live" off every backdrop write lands in the agent's draft; the live scene stays as it is.
func TestBackdropToolsDraft(t *testing.T) {
	h := apitest.New(t)
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ok := func(name string, args map[string]any, want ...string) string {
		t.Helper()
		text, res := call(t, s, name, args)
		if res.IsError {
			t.Fatalf("%s: %s", name, text)
		}
		for _, w := range want {
			if !strings.Contains(text, w) {
				t.Fatalf("%s: want %q in %s", name, w, text)
			}
		}
		return text
	}
	bad := func(name string, args map[string]any, want string) {
		t.Helper()
		text, res := call(t, s, name, args)
		if !res.IsError || !strings.Contains(text, want) {
			t.Fatalf("%s: want an error with %q, got %s", name, want, text)
		}
	}
	ok("light_set", map[string]any{"focus": 0.5, "kelvin": 2700, "slideX": 0.2, "colorLayer": map[string]any{"kind": "generator", "ref": "kelvin-cycle"}},
		"in your draft", "focus 0.50", "generator kelvin-cycle")
	bad("light_set", map[string]any{"focus": 3}, "focus")
	bad("light_set", map[string]any{"colorLayer": map[string]any{"kind": "generator", "ref": "disco"}}, "colorGenerators")
	text := ok("attachment_add", map[string]any{"gobo": "blinds", "opacity": 0.6, "motion": "drift", "params": map[string]any{"throw": 0.4}}, "in your draft")
	id := attID.FindString(text)
	if id == "" {
		t.Fatalf("no attachment id in %s", text)
	}
	// (catalog 5) a metal plate is an attachment like any other; its light field is an enum param
	plate := attID.FindString(ok("attachment_add", map[string]any{"gobo": "plate-snowflakes", "params": map[string]any{"field": "tile"}}, "in your draft"))
	ok("attachment_remove", map[string]any{"id": plate}, plate)
	bad("attachment_add", map[string]any{"gobo": "plate-snowflakes", "params": map[string]any{"field": "square"}}, "field")
	ok("catalog_get", map[string]any{"section": "gobos"}, "plate-sunburst", "inspired by Amaran AS-GB-M MO05", "\"plates\"")
	bad("attachment_add", map[string]any{"gobo": "lasers"}, "catalog_get gobos")
	bad("attachment_add", map[string]any{"gobo": "blinds", "scale": 50}, "scale")
	bad("attachment_add", map[string]any{"gobo": "blinds", "motion": "spin"}, "sun-lr")
	ok("attachment_update", map[string]any{"id": id, "rotation": 15, "params": map[string]any{"skew": -0.3}}, "Updated attachment "+id)
	bad("attachment_update", map[string]any{"id": "att_nope"}, "does not exist")
	ok("motion_set", map[string]any{"target": "light", "preset": "sun-lr"}, "The static light moves (sun-lr, 600 s per pass")
	ok("motion_set", map[string]any{"target": id, "on": false}, "pauses")
	ok("motion_set", map[string]any{"target": "lay_flowers", "preset": "drift", "duration": 120}, "120 s per pass")
	bad("motion_set", map[string]any{"target": "lay_tree", "preset": "drift"}, "only photo and video layers move")
	bad("motion_set", map[string]any{"target": "light", "easing": "bounce"}, "easing")
	ok("backdrop_set", map[string]any{"mode": "color", "layers": []any{map[string]any{"kind": "generator", "ref": "aurora"}, map[string]any{"kind": "gradient", "ref": "ember", "opacity": 0.5}}},
		"The color stack is aurora")
	bad("backdrop_set", map[string]any{"mode": "static", "layers": []any{}}, "gobo_set")
	bad("backdrop_set", map[string]any{"mode": "live", "layers": []any{map[string]any{"kind": "gobo", "ref": "window"}}}, "attachment_add")
	bad("backdrop_set", map[string]any{"mode": "live", "layers": []any{map[string]any{"kind": "procedural", "ref": "volcano"}}}, "catalog")
	ok("mode_set", map[string]any{"mode": "color"}, "color mode, in your draft")

	// nothing reached the live scene
	live := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if live["version"] != float64(1) || backdropOf(t, live, "static")["light"].(map[string]any)["focus"] != 0.38 {
		t.Fatalf("the live scene changed: v%v", live["version"])
	}
	// the draft has it all
	drafts := h.Do("GET", "/api/v1/drafts?sceneId=scn_desk", nil).List(t)
	if len(drafts) != 1 {
		t.Fatalf("drafts %v", drafts)
	}
	draftID := drafts[0].(map[string]any)["id"].(string)
	view := h.Do("GET", "/api/v1/drafts/"+draftID+"/scene", nil).Map(t)
	st := backdropOf(t, view, "static")
	light := st["light"].(map[string]any)
	atts := st["attachments"].([]any)
	if light["focus"] != 0.5 || light["color"].(map[string]any)["kelvin"] != float64(2700) || light["slide"].(map[string]any)["x"] != 0.2 ||
		light["colorLayer"].(map[string]any)["params"].(map[string]any)["minutes"] == nil || light["motion"].(map[string]any)["preset"] != "sun-lr" || len(atts) != 2 || view["mode"] != "color" {
		t.Fatalf("draft static %v mode %v", st, view["mode"])
	}
	a := atts[1].(map[string]any)
	if a["id"] != id || a["gobo"] != "blinds" || a["opacity"] != 0.6 || a["rotation"] != float64(15) || a["params"].(map[string]any)["throw"] != 0.4 ||
		a["params"].(map[string]any)["skew"] != -0.3 || a["motion"].(map[string]any)["on"] != false || a["motion"].(map[string]any)["preset"] != "drift" {
		t.Fatalf("attachment %v", a)
	}
	flowers := backdropOf(t, view, "scenery")["layers"].([]any)[0].(map[string]any)
	if flowers["motion"].(map[string]any)["duration"] != float64(120) {
		t.Fatalf("flowers %v", flowers)
	}
	if n := len(backdropOf(t, view, "color")["layers"].([]any)); n != 2 {
		t.Fatalf("color layers %d", n)
	}
	text, _ = call(t, s, "draft_diff", nil)
	for _, w := range []string{"changes the static light", "adds static attachment " + id, "puts color on air"} {
		if !strings.Contains(text, w) {
			t.Fatalf("draft_diff misses %q: %s", w, text)
		}
	}

	// the quick pick keeps the first attachment's id and motion; remove takes one away
	ok("gobo_set", map[string]any{"gobo": "window-4"}, "one window 4-pane (att_window)")
	view = h.Do("GET", "/api/v1/drafts/"+draftID+"/scene", nil).Map(t)
	atts = backdropOf(t, view, "static")["attachments"].([]any)
	if len(atts) != 1 || atts[0].(map[string]any)["gobo"] != "window-4" || atts[0].(map[string]any)["motion"].(map[string]any)["preset"] != "sun-lr" {
		t.Fatalf("after gobo_set %v", atts)
	}
	ok("attachment_remove", map[string]any{"id": "att_window"}, "Removed attachment att_window")
	ok("attachment_add", map[string]any{"stack": "live", "gobo": "leaves-light"}, "to the live light")
	ok("preset_apply", map[string]any{"preset": "Ember"}, "color mode is on air, in your draft")
	bad("preset_apply", map[string]any{"preset": "disco"}, "golden hour")
	bad("mode_set", map[string]any{"mode": "loud"}, "mode must be")
	// without the switch, writing another scene is refused and activating needs a toggle
	sc := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "other"}).Map(t)
	bad("mode_set", map[string]any{"mode": "live", "scene": sc["id"]}, "agents edit live")
	bad("scene_activate", map[string]any{"scene": "other"}, "agents edit live")
}

// With "agents edit live" on the writes are live patches by agent:<name>: every client gets patched at once.
func TestBackdropToolsLive(t *testing.T) {
	h := apitest.New(t)
	apitest.Expect(t, h.Do("PATCH", "/api/v1/settings", map[string]any{"agentLiveEdits": true}), http.StatusOK)
	if st := h.Do("GET", "/api/v1/settings", nil).Map(t); st["agentLiveEdits"] != true || st["agentMayGoLive"] != false {
		t.Fatalf("settings %v", st)
	}
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ws := h.Connect("remote", "phone")
	ws.Sub("scene:scn_desk")

	before := time.Now().UnixMilli()
	text, res := call(t, s, "light_set", map[string]any{"focus": 0.9, "kelvin": 2400})
	if res.IsError || !strings.Contains(text, "live on the wall") {
		t.Fatalf("light_set %s", text)
	}
	p := ws.NextOn("patched", "scene:scn_desk")
	if !strings.Contains(string(p.D), `"by":"agent:claude"`) || !strings.Contains(string(p.D), "/backdrop/static/light") {
		t.Fatalf("patched %s", p.D)
	}
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if backdropOf(t, sc, "static")["light"].(map[string]any)["focus"] != 0.9 {
		t.Fatalf("live light %v", backdropOf(t, sc, "static")["light"])
	}
	// the live write attached an agent session without a draft; its tool events reach the agent panel
	sessions := h.Do("GET", "/api/v1/agents/sessions", nil).List(t)
	if len(sessions) != 1 || sessions[0].(map[string]any)["draftId"] != "" || sessions[0].(map[string]any)["status"] != "running" {
		t.Fatalf("sessions %v", sessions)
	}
	sessID := sessions[0].(map[string]any)["id"].(string)
	panel := h.Connect("editor", "editor")
	panel.Sub("agent:" + sessID)
	text, res = call(t, s, "motion_set", map[string]any{"target": "att_window", "preset": "sun-lr"})
	if ev := panel.NextOn("event", "agent:"+sessID); !strings.Contains(string(ev.D), "motion_set · att_window · sun-lr") {
		t.Fatalf("event %s", ev.D)
	}
	if res.IsError || !strings.Contains(text, "live on the wall") {
		t.Fatalf("motion_set %s", text)
	}
	ws.NextOn("patched", "scene:scn_desk")
	m := backdropOf(t, h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t), "static")["attachments"].([]any)[0].(map[string]any)["motion"].(map[string]any)
	if m["on"] != true || m["startedAt"].(float64) < float64(before) || m["startedAt"].(float64) > float64(time.Now().UnixMilli()+1000) {
		t.Fatalf("motion %v (before %d)", m, before)
	}
	// a stack in another mode says how to show it
	text, _ = call(t, s, "attachment_add", map[string]any{"stack": "live", "gobo": "blinds"})
	if !strings.Contains(text, "the wall shows static mode, mode_set live shows it") {
		t.Fatalf("attachment_add live %s", text)
	}
	// presets and modes go live too
	text, res = call(t, s, "preset_apply", map[string]any{"preset": "storm"})
	if res.IsError || !strings.Contains(text, "live mode is on air, live on the wall") {
		t.Fatalf("preset_apply %s", text)
	}
	if sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t); sc["mode"] != "live" || len(backdropOf(t, sc, "live")["attachments"].([]any)) != 0 {
		t.Fatalf("after storm: mode %v live %v", sc["mode"], backdropOf(t, sc, "live"))
	}
	// no draft was made, and the log has every tool call
	if l := h.Do("GET", "/api/v1/drafts?sceneId=scn_desk", nil).List(t); len(l) != 0 {
		t.Fatalf("drafts %v", l)
	}
	evs := string(h.Do("GET", "/api/v1/agents/sessions/"+sessID+"/events", nil).Body)
	for _, w := range []string{"light_set", "motion_set · att_window", "attachment_add · live · blinds", "preset_apply · storm"} {
		if !strings.Contains(evs, w) {
			t.Fatalf("events miss %q: %s", w, evs)
		}
	}
	// a draft tool afterwards gives the same session its draft
	if text, res := call(t, s, "cue_add", map[string]any{"at": 1, "label": "x"}); res.IsError {
		t.Fatalf("cue_add %s", text)
	}
	if d := h.Do("GET", "/api/v1/agents/sessions/"+sessID, nil); d.Status != http.StatusOK || d.Map(t)["draftId"] == "" {
		t.Fatalf("session after a draft write %s", d.Body)
	}
	if l := h.Do("GET", "/api/v1/drafts?sceneId=scn_desk", nil).List(t); len(l) != 1 {
		t.Fatalf("drafts after cue_add %v", l)
	}

	// a new scene from a template, then onto the wall: its kind's mode goes on air
	text, res = call(t, s, "scene_create", map[string]any{"name": "rain on glass", "kind": "live"})
	if res.IsError || !strings.Contains(text, "kind live, mode live") || !strings.Contains(text, "not on the wall") {
		t.Fatalf("scene_create %s", text)
	}
	if _, res = call(t, s, "scene_create", map[string]any{"name": "x", "kind": "party"}); !res.IsError {
		t.Fatal("scene_create with an unknown kind")
	}
	text, res = call(t, s, "scene_activate", map[string]any{"scene": "Rain on glass"})
	if res.IsError || !strings.Contains(text, "is on the wall in live mode") {
		t.Fatalf("scene_activate %s", text)
	}
	id := h.Do("GET", "/api/v1/show", nil).Map(t)["activeSceneId"].(string)
	rain := h.Do("GET", "/api/v1/scenes/"+id, nil).Map(t)
	if rain["name"] != "rain on glass" || rain["kind"] != "live" || len(backdropOf(t, rain, "live")["attachments"].([]any)) != 1 {
		t.Fatalf("rain scene %v", rain)
	}
	text, res = call(t, s, "backdrop_set", map[string]any{"mode": "live", "layers": []any{map[string]any{"kind": "procedural", "ref": "rain-glass"}}})
	if res.IsError || !strings.Contains(text, "live on the wall") {
		t.Fatalf("backdrop_set %s", text)
	}
	if l := backdropOf(t, h.Do("GET", "/api/v1/scenes/"+id, nil).Map(t), "live")["layers"].([]any); len(l) != 1 || l[0].(map[string]any)["ref"] != "rain-glass" {
		t.Fatalf("rain layers %v", l)
	}
	// another scene by name; then the desk goes back up in objects mode (its kind is mapping)
	text, res = call(t, s, "mode_set", map[string]any{"mode": "color", "scene": "Desk"})
	if res.IsError || !strings.Contains(text, "not on the wall") {
		t.Fatalf("mode_set on another scene %s", text)
	}
	if _, res = call(t, s, "scene_activate", map[string]any{"scene": "scn_desk"}); res.IsError {
		t.Fatal("activate desk")
	}
	if sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t); sc["mode"] != "objects" {
		t.Fatalf("desk mode after activate %v", sc["mode"])
	}
}
