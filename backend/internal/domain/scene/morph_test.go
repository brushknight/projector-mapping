package scene

import (
	"encoding/json"
	"strings"
	"testing"
)

// (§21) morph and shape clips: shape names, catalog params and the track kind are checked.
func TestValidateMorph(t *testing.T) {
	refs := refsT(t)
	base := fixtureScene(t)
	trk := base.Timeline.Tracks[0].ID
	for _, tr := range base.Timeline.Tracks {
		if tr.ID == "trk_converge" {
			trk = tr.ID
		}
	}
	with := func(cl Clip) error {
		sc := fixtureScene(t)
		sc.Timeline.Clips = append(sc.Timeline.Clips, cl)
		return sc.Validate(refs)
	}
	ok := []map[string]any{
		{"from": "object", "to": "circle", "toR": 300.0, "color": "#ffffff", "colorTo": "#ff3b30", "edge": 4.0, "ease": "inOut", "outline": true},
		{"from": "circle", "to": "plate:plate-grid-window", "toSize": 600.0, "fill": "light", "source": "static"},
		{"from": "circle", "to": "circle", "fromCx": 960.0, "fromCy": 540.0, "color": "#2040ff", "colorTo": "#ff2020"},
		{"from": "frame", "to": "rect", "toW": 400.0, "toH": 200.0},
	}
	for i, p := range ok {
		if err := with(Clip{ID: "clp_m", TrackID: trk, Effect: EffectMorph, Start: 1, End: 3, Params: p}); err != nil {
			t.Fatalf("ok %d: %v", i, err)
		}
	}
	if err := with(Clip{ID: "clp_s", TrackID: trk, Effect: EffectShape, Start: 1, End: 3, Params: map[string]any{"shape": "circle", "r": 200.0}}); err != nil {
		t.Fatal(err)
	}
	bad := map[string]map[string]any{
		"params.to":     {"to": "hexagon"},
		"params.from":   {"from": "plate:"},
		"colorTo":       {"colorTo": "red"},
		"fill":          {"fill": "glow"},
		"edge":          {"edge": 500.0},
		"must be a str": {"to": 3.0},
	}
	for want, p := range bad {
		err := with(Clip{ID: "clp_m", TrackID: trk, Effect: EffectMorph, Start: 1, End: 3, Params: p})
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("%v: want %q, got %v", p, want, err)
		}
	}
}

// (§21) hold reads true as "step", false as off, and writes off as false; anything else fails validation.
func TestHoldJSON(t *testing.T) {
	var c Clip
	for in, want := range map[string]Hold{`true`: HoldStep, `false`: HoldOff, `"step"`: HoldStep, `"forever"`: HoldForever} {
		if err := json.Unmarshal([]byte(`{"id":"c","hold":`+in+`}`), &c); err != nil || c.Hold == nil || *c.Hold != want {
			t.Fatalf("%s: %v %v", in, err, c.Hold)
		}
	}
	off := HoldOff
	b, _ := json.Marshal(Clip{ID: "c", Hold: &off})
	if !strings.Contains(string(b), `"hold":false`) {
		t.Fatal(string(b))
	}
	st := HoldStep
	b, _ = json.Marshal(Clip{ID: "c", Hold: &st})
	if !strings.Contains(string(b), `"hold":"step"`) {
		t.Fatal(string(b))
	}
	sc := fixtureScene(t)
	bad := Hold("always")
	sc.Timeline.Clips[0].Hold = &bad
	if err := sc.Validate(refsT(t)); err == nil || !strings.Contains(err.Error(), "hold must be") {
		t.Fatalf("bad hold: %v", err)
	}
	if (Clip{Effect: EffectMorph}).HoldMode() != HoldStep || (Clip{Effect: "fill"}).HoldMode() != HoldOff || (Clip{Effect: EffectConverge}).HoldMode() != HoldStep {
		t.Fatal("defaults")
	}
}

// (§21) a step hold ends at the cue after the clip's start (still in effect at that cue); forever outlives cues.
func TestStateAtStepHold(t *testing.T) {
	obj := "obj_cube"
	forever := HoldForever
	step := HoldStep
	tl := &Timeline{Duration: 20, Tracks: []Track{{ID: "trk", Target: Target{Kind: "object", ID: &obj}}},
		Cues: []Cue{{ID: "a", At: 0}, {ID: "b", At: 4}, {ID: "c", At: 8}, {ID: "d", At: 12}},
		Clips: []Clip{
			{ID: "fill", TrackID: "trk", Effect: "fill", Start: 4, End: 6, Hold: &step},
			{ID: "morph", TrackID: "trk", Effect: EffectMorph, Start: 8, End: 10},
			{ID: "trace", TrackID: "trk", Effect: "trace", Start: 6, End: 9, Hold: &step},
			{ID: "grid", TrackID: "trk", Effect: "grid-build", Start: 1, End: 2, Hold: &forever},
		}}
	if !states(tl, 7)["fill"].Held || !states(tl, 8)["fill"].Held {
		t.Fatalf("fill held in its step and at the cue that ends it: %+v", states(tl, 8))
	}
	if _, ok := states(tl, 8.01)["fill"]; ok {
		t.Fatal("a fill held in step 2 is gone in step 3")
	}
	// a clip that runs over the cue plays to its end, then is gone (its step has ended)
	if s := states(tl, 8.5)["trace"]; s.Held || s.Progress <= 0.8 {
		t.Fatalf("trace runs over the cue: %+v", s)
	}
	if _, ok := states(tl, 9.5)["trace"]; ok {
		t.Fatal("trace held past its step")
	}
	if !states(tl, 11)["morph"].Held {
		t.Fatal("morph holds by default in its step")
	}
	if _, ok := states(tl, 12.5)["morph"]; ok {
		t.Fatal("morph held past its step")
	}
	if !states(tl, 15)["grid"].Held {
		t.Fatal("forever holds past cues")
	}
}
