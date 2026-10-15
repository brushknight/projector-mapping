package show

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

func sceneDoc(t *testing.T, h *apitest.H) map[string]any {
	t.Helper()
	return h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
}

func patchScene(t *testing.T, h *apitest.H, ops ...any) *apitest.Resp {
	t.Helper()
	return h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": sceneDoc(t, h)["version"], "ops": ops})
}

func clipsOf(sc map[string]any) []map[string]any {
	var out []map[string]any
	for _, c := range sc["timeline"].(map[string]any)["clips"].([]any) {
		out = append(out, c.(map[string]any))
	}
	return out
}

// (§20) show.converge on the seeded scene: it uses the converge clip at 0, records the mode on air as its source,
// switches to objects mode and plays from 0, holding at the first cue after the clip.
func TestConvergeUsesTheExistingClip(t *testing.T) {
	h := apitest.New(t)
	apitest.Expect(t, patchScene(t, h, map[string]any{"op": "replace", "path": "/mode", "value": "live"}), http.StatusOK)
	before := len(clipsOf(sceneDoc(t, h)))
	s := do(t, h, "converge", nil)
	if s.Transport.State != "playing" || s.Transport.Offset != 0 || s.Transport.Cue != 0 {
		t.Fatalf("transport %+v", s.Transport)
	}
	sc := sceneDoc(t, h)
	if sc["mode"] != "objects" || len(clipsOf(sc)) != before {
		t.Fatalf("mode %v, %d clips (was %d)", sc["mode"], len(clipsOf(sc)), before)
	}
	for _, c := range clipsOf(sc) {
		if c["id"] == "clp_converge" && c["params"].(map[string]any)["source"] != "live" {
			t.Fatalf("source %v", c["params"])
		}
	}
	// the wall then holds at the next cue (4 s); GO plays on from there
	s = do(t, h, "seek", map[string]any{"t": 4})
	s = do(t, h, "go", nil)
	if s.Transport.Cue != 2 || s.Transport.Offset != 6 {
		t.Fatalf("go after converge %+v", s.Transport)
	}
}

// Without a converge clip at 0 it inserts one (2 s on the first object) and a hold cue, and moves nothing else.
func TestConvergeInsertsAClip(t *testing.T) {
	h := apitest.New(t)
	sc := sceneDoc(t, h)
	clips := clipsOf(sc)
	idx := -1
	for i, c := range clips {
		if c["effect"] == "converge" {
			idx = i
		}
	}
	if idx < 0 {
		t.Fatal("the seeded scene has a converge clip")
	}
	apitest.Expect(t, patchScene(t, h, map[string]any{"op": "remove", "path": "/timeline/clips/" + itoa(idx)}), http.StatusOK)
	sc = sceneDoc(t, h)
	before := clipsOf(sc)
	cues := len(sc["timeline"].(map[string]any)["cues"].([]any))

	// over the WebSocket, as the phone and the web send it
	ws := h.Connect("remote", "phone")
	ws.Send(apitest.Msg{T: "cmd", ID: "c1", D: apitest.Data(map[string]any{"name": "show.converge", "args": map[string]any{"duration": 2.5}})})
	ack := ws.NextWhere(func(m apitest.Msg) bool { return m.Re == "c1" }, "converge ack")
	if ack.T != "ack" {
		t.Fatalf("converge answered %s %s", ack.T, ack.D)
	}
	sc = sceneDoc(t, h)
	after := clipsOf(sc)
	if len(after) != len(before)+1 || sc["mode"] != "objects" {
		t.Fatalf("%d clips (was %d), mode %v", len(after), len(before), sc["mode"])
	}
	cv := after[len(after)-1]
	p := cv["params"].(map[string]any)
	if cv["effect"] != "converge" || cv["start"] != 0.0 || cv["end"] != 2.5 || p["source"] != "static" || p["from"] != "current" {
		t.Fatalf("clip %v", cv)
	}
	for i, c := range before {
		if after[i]["start"] != c["start"] || after[i]["end"] != c["end"] {
			t.Fatalf("clip %v moved", c["id"])
		}
	}
	// the fixture has a cue at 0 and one at 4 (after 2.5): no new cues
	if n := len(sc["timeline"].(map[string]any)["cues"].([]any)); n != cues {
		t.Fatalf("%d cues, was %d", n, cues)
	}
	var s showState
	h.Do("GET", "/api/v1/show", nil).Into(t, &s)
	if s.Transport.State != "playing" || s.Transport.Offset != 0 {
		t.Fatalf("transport %+v", s.Transport)
	}
	// in objects mode the client says which light it saw last
	do(t, h, "converge", map[string]any{"source": "color"})
	for _, c := range clipsOf(sceneDoc(t, h)) {
		if c["effect"] == "converge" && c["params"].(map[string]any)["source"] != "color" {
			t.Fatalf("source %v", c["params"])
		}
	}
	// bad args
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/converge", map[string]any{"duration": 0}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/converge", map[string]any{"source": "objects"}), http.StatusBadRequest, "bad_request")
}

// A converge clip validates against the catalog: from, ease, source enums, edge range; hold round-trips on any clip.
func TestConvergeValidation(t *testing.T) {
	h := apitest.New(t)
	idx := -1
	for i, c := range clipsOf(sceneDoc(t, h)) {
		if c["effect"] == "converge" {
			idx = i
			if c["hold"] != true {
				t.Fatalf("hold %v", c["hold"])
			}
		}
	}
	base := "/timeline/clips/" + itoa(idx)
	for _, bad := range []map[string]any{
		{"op": "replace", "path": base + "/params/from", "value": "square"},
		{"op": "replace", "path": base + "/params/ease", "value": "bounce"},
		{"op": "replace", "path": base + "/params/source", "value": "objects"},
		{"op": "replace", "path": base + "/params/edge", "value": 500},
		{"op": "replace", "path": base + "/params/outline", "value": "yes"},
	} {
		if r := patchScene(t, h, bad); r.Status < 400 {
			t.Fatalf("%v was accepted", bad)
		}
	}
	apitest.Expect(t, patchScene(t, h, map[string]any{"op": "replace", "path": base + "/hold", "value": false},
		map[string]any{"op": "add", "path": "/timeline/clips/0/hold", "value": true}), http.StatusOK)
	cs := clipsOf(sceneDoc(t, h))
	if cs[idx]["hold"] != false || cs[0]["hold"] != true {
		t.Fatalf("hold %v %v", cs[idx]["hold"], cs[0]["hold"])
	}
	// a converge only goes on a surface, object or all track
	apitest.Expect(t, patchScene(t, h, map[string]any{"op": "replace", "path": "/timeline/clips/0/hold", "value": nil}), http.StatusOK)
	if r := patchScene(t, h, map[string]any{"op": "add", "path": "/timeline/clips/-", "value": map[string]any{
		"id": "clp_bad", "trackId": "trk_sweep", "effect": "converge", "start": 0, "end": 1, "fadeIn": 0, "fadeOut": 0, "params": map[string]any{}}}); r.Status < 400 {
		t.Fatal("a converge on a layer track was accepted")
	}
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}
