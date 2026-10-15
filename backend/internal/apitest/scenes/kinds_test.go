package scenes

import (
	"net/http"
	"strings"
	"testing"

	"projmap/internal/apitest"
)

// Scene kinds (protocol §15): templates on create, kind and mode in the list, activating puts the kind's mode on air.
func TestSceneKinds(t *testing.T) {
	h := apitest.New(t)
	l := h.Do("GET", "/api/v1/scenes", nil).List(t)
	if d := l[0].(map[string]any); d["kind"] != "mapping" || d["mode"] != "static" {
		t.Fatalf("seeded summary %v", d)
	}
	ws := h.Connect("editor", "editor")
	ws.Sub("scenes")
	ws.Sub("scene:scn_desk")
	create := func(body map[string]any) map[string]any {
		t.Helper()
		r := h.Do("POST", "/api/v1/scenes", body)
		apitest.Expect(t, r, http.StatusCreated)
		return r.Map(t)
	}
	plain := create(map[string]any{"name": "plain"})
	if plain["kind"] != "static" || plain["mode"] != "static" || len(backdrop(plain, "static")["attachments"].([]any)) != 0 || backdrop(plain, "static")["light"] == nil {
		t.Fatalf("plain scene %v", plain)
	}
	sun := create(map[string]any{"name": "sun", "kind": "static"})
	att := backdrop(sun, "static")["attachments"].([]any)[0].(map[string]any)
	light := backdrop(sun, "static")["light"].(map[string]any)
	if sun["kind"] != "static" || att["gobo"] != "window-4" || att["motion"].(map[string]any)["on"] != false || att["motion"].(map[string]any)["preset"] != "sun-lr" || att["motion"].(map[string]any)["phase"] != 0.5 ||
		att["params"].(map[string]any)["throw"] != 0.25 || light["color"].(map[string]any)["kelvin"] != float64(3200) || light["focus"] != 0.68 {
		t.Fatalf("static-window %v", sun["backdrop"])
	}
	if !strings.HasPrefix(att["id"].(string), "att_") {
		t.Fatalf("attachment id %v", att["id"])
	}
	tree := create(map[string]any{"name": "tree", "template": "live-window-tree"})
	if tree["kind"] != "live" || tree["mode"] != "live" || backdrop(tree, "live")["light"] == nil || len(backdrop(tree, "live")["layers"].([]any)) != 1 {
		t.Fatalf("live-window-tree %v", tree["backdrop"])
	}
	ember := create(map[string]any{"name": "ember", "kind": "color"})
	scenery := create(map[string]any{"name": "flowers", "kind": "scenery"})
	mapping := create(map[string]any{"name": "map", "kind": "mapping"})
	if ember["mode"] != "color" || len(backdrop(ember, "color")["layers"].([]any)) != 1 || scenery["mode"] != "scenery" ||
		backdrop(scenery, "scenery")["layers"].([]any)[0].(map[string]any)["ref"] != "flowers" || mapping["mode"] != "objects" || mapping["kind"] != "mapping" {
		t.Fatalf("color %v scenery %v mapping %v", ember["mode"], scenery["mode"], mapping["mode"])
	}
	if _, has := backdrop(ember, "color")["light"]; has {
		t.Fatal("the color stack writes no light")
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": "x", "kind": "party"}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes", map[string]any{"name": "x", "template": "nope"}), http.StatusBadRequest, "bad_request")
	// a duplicate keeps the kind
	dup := create(map[string]any{"name": "sun 2", "duplicate": sun["id"]})
	if dup["kind"] != "static" || len(backdrop(dup, "static")["attachments"].([]any)) != 1 {
		t.Fatalf("duplicate %v", dup)
	}
	l = h.Do("GET", "/api/v1/scenes", nil).List(t)
	kinds := []string{}
	for _, s := range l {
		kinds = append(kinds, s.(map[string]any)["kind"].(string)+":"+s.(map[string]any)["mode"].(string))
	}
	if strings.Join(kinds, ",") != "mapping:static,static:static,static:static,live:live,color:color,scenery:scenery,mapping:objects,static:static" {
		t.Fatalf("kinds %v", kinds)
	}

	// activating the desk (kind mapping, mode static) puts objects on air: a replace /mode patch by the server
	ws.Send(apitest.Msg{T: "cmd", ID: "a1", D: apitest.Data(map[string]any{"name": "show.activate", "args": map[string]any{"sceneId": "scn_desk"}})})
	p := ws.NextOn("patched", "scene:scn_desk")
	if !strings.Contains(string(p.D), `"/mode"`) || !strings.Contains(string(p.D), `"objects"`) || !strings.Contains(string(p.D), `"by":"server"`) {
		t.Fatalf("patched %s", p.D)
	}
	// the list follows the mode change
	for {
		var sums []summary
		ws.NextOn("snapshot", "scenes").Into(t, &sums)
		if sums[0].Mode == "objects" {
			break
		}
	}
	// REST too; a scene already in its kind's mode is left alone
	tid := tree["id"].(string)
	v := h.Do("GET", "/api/v1/scenes/"+tid, nil).Map(t)["version"]
	apitest.Expect(t, h.Do("POST", "/api/v1/show/activate", map[string]any{"sceneId": tid}), http.StatusOK)
	if got := h.Do("GET", "/api/v1/scenes/"+tid, nil).Map(t)["version"]; got != v {
		t.Fatalf("activating a scene in its mode patched it: %v -> %v", v, got)
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/"+tid+"/patch", map[string]any{"base": 0, "ops": []any{op("replace", "/mode", "color")}}), http.StatusOK)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/activate", map[string]any{"sceneId": tid}), http.StatusOK)
	if m := h.Do("GET", "/api/v1/scenes/"+tid, nil).Map(t)["mode"]; m != "live" {
		t.Fatalf("activate puts the kind's mode on air: %v", m)
	}
	// kind is validated on patches
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/scenes/"+tid+"/patch", map[string]any{"base": 0, "ops": []any{op("replace", "/kind", "party")}}), http.StatusUnprocessableEntity, "invalid")
}

func backdrop(sc map[string]any, mode string) map[string]any {
	return sc["backdrop"].(map[string]any)[mode].(map[string]any)
}

func TestSettingsLiveEdits(t *testing.T) {
	h := apitest.New(t)
	if st := h.Do("GET", "/api/v1/settings", nil).Map(t); st["agentLiveEdits"] != false {
		t.Fatalf("default %v", st)
	}
	st := h.Do("PATCH", "/api/v1/settings", map[string]any{"agentLiveEdits": true}).Map(t)
	if st["agentLiveEdits"] != true || st["agentMayApply"] != false {
		t.Fatalf("patched %v", st)
	}
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/settings", map[string]any{"agentLiveEdits": "yes"}), http.StatusBadRequest, "bad_request")
}
