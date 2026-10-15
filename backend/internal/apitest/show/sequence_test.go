package show

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

// (§20 "Step 0") show.sequence.start holds the opening look (step 0, paused at 0); GO with converge plays the
// converge clip from 0 and holds at the cue after it; back from the first cue returns to step 0.
func TestSequenceWithConverge(t *testing.T) {
	h := apitest.New(t)
	apitest.Expect(t, patchScene(t, h, map[string]any{"op": "replace", "path": "/mode", "value": "live"}), http.StatusOK)
	s := do(t, h, "sequence.start", nil)
	if s.Transport.Step != "intro" || s.Transport.State != "paused" || s.Transport.Offset != 0 {
		t.Fatalf("step 0 %+v", s.Transport)
	}
	sc := sceneDoc(t, h)
	in, _ := sc["intro"].(map[string]any)
	if sc["mode"] != "objects" || in == nil || in["on"] != true || in["source"].(map[string]any)["mode"] != "live" || in["converge"] != true {
		t.Fatalf("mode %v intro %v", sc["mode"], in)
	}
	for _, c := range clipsOf(sc) {
		if c["id"] == "clp_converge" && c["params"].(map[string]any)["source"] != "live" {
			t.Fatalf("converge source %v", c["params"])
		}
	}
	// step 0 holds: nothing plays
	var g showState
	h.Do("GET", "/api/v1/show", nil).Into(t, &g)
	if g.Transport.Step != "intro" || g.Transport.State != "paused" {
		t.Fatalf("held %+v", g.Transport)
	}
	s = do(t, h, "go", nil)
	if s.Transport.Step != "timeline" || s.Transport.State != "playing" || s.Transport.Offset != 0 || s.Transport.Cue != 0 {
		t.Fatalf("go from step 0 %+v", s.Transport)
	}
	s = do(t, h, "back", nil)
	if s.Transport.Step != "intro" || s.Transport.State != "paused" {
		t.Fatalf("back to step 0 %+v", s.Transport)
	}
	// a second back stays in step 0
	if s = do(t, h, "back", nil); s.Transport.Step != "intro" {
		t.Fatalf("back in step 0 %+v", s.Transport)
	}
}

// Without converge GO crossfades: it plays from 0 with no converge source change; an invalid intro answers 422.
func TestSequenceWithoutConverge(t *testing.T) {
	h := apitest.New(t)
	intro := map[string]any{"on": true, "source": map[string]any{"mode": "static", "presetId": nil}, "converge": false, "convergeDuration": 2,
		"from": "current", "ease": "inOut", "transition": "fade", "transitionMs": 600}
	apitest.Expect(t, patchScene(t, h, map[string]any{"op": "add", "path": "/intro", "value": intro}), http.StatusOK)
	s := do(t, h, "sequence.start", nil)
	if s.Transport.Step != "intro" {
		t.Fatalf("step 0 %+v", s.Transport)
	}
	s = do(t, h, "go", nil)
	if s.Transport.Step != "timeline" || s.Transport.State != "playing" || s.Transport.Offset != 0 {
		t.Fatalf("go %+v", s.Transport)
	}
	// stop leaves the sequence; GO then plays the timeline as before
	if s = do(t, h, "stop", nil); s.Transport.Step == "intro" {
		t.Fatalf("stop %+v", s.Transport)
	}
	bad := map[string]any{"op": "replace", "path": "/intro/transition", "value": "wipe"}
	if r := patchScene(t, h, bad); r.Status == http.StatusOK {
		t.Fatal("a bad transition was accepted")
	}
}
