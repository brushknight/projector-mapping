package scene

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"projmap/internal/domain/docpatch"
)

func ptr[T any](v T) *T { return &v }

func states(tl *Timeline, t float64) map[string]ClipState {
	out := map[string]ClipState{}
	for _, s := range tl.StateAt(t) {
		out[s.ClipID] = s
	}
	return out
}

// (§20) every clip may hold its end state; converge, reveal, sweep and motion hold by default, the others do not.
func TestStateAtHolds(t *testing.T) {
	obj := "obj_cube"
	tl := &Timeline{Duration: 20, Tracks: []Track{{ID: "trk", Target: Target{Kind: "object", ID: &obj}}, {ID: "trk2", Target: Target{Kind: "all"}}},
		Clips: []Clip{
			{ID: "cv", TrackID: "trk", Effect: EffectConverge, Start: 0, End: 2},
			{ID: "trace", TrackID: "trk", Effect: "trace", Start: 2, End: 4},
			{ID: "fill", TrackID: "trk", Effect: "fill", Start: 4, End: 6, Hold: ptr(HoldStep)},
			{ID: "fill2", TrackID: "trk", Effect: "fill", Start: 8, End: 9},
			{ID: "cv2", TrackID: "trk", Effect: EffectConverge, Start: 12, End: 13, Hold: ptr(HoldOff)},
			{ID: "glitch", TrackID: "trk2", Effect: "glitch", Start: 1, End: 3},
		}}
	s := states(tl, 1)
	if s["cv"].Held || s["cv"].Progress != 0.5 || !hasAll(s, "cv", "glitch") || len(s) != 2 {
		t.Fatalf("t=1 %+v", s)
	}
	// after its end the converge holds at progress 1, a trace does not
	s = states(tl, 5)
	if c := s["cv"]; !c.Held || c.Progress != 1 {
		t.Fatalf("converge at 5 %+v", s)
	}
	if _, ok := s["trace"]; ok {
		t.Fatalf("trace holds by default: %+v", s)
	}
	if _, ok := s["glitch"]; ok {
		t.Fatalf("glitch holds: %+v", s)
	}
	// a fill with hold keeps its end state until the next fill on the track starts
	if c := states(tl, 7)["fill"]; !c.Held {
		t.Fatalf("fill at 7 %+v", c)
	}
	s = states(tl, 8.5)
	if _, ok := s["fill"]; ok || s["fill2"].Held {
		t.Fatalf("fill2 takes over at 8: %+v", s)
	}
	if _, ok := states(tl, 10)["fill2"]; ok {
		t.Fatalf("fill2 without hold ends: %+v", states(tl, 10))
	}
	// the second converge (hold false) takes over from the first and ends at its own end, leaving nothing
	s = states(tl, 12.5)
	if _, ok := s["cv"]; ok || s["cv2"].Progress != 0.5 {
		t.Fatalf("t=12.5 %+v", s)
	}
	if _, ok := states(tl, 14)["cv"]; ok {
		t.Fatalf("the first converge came back at 14: %+v", states(tl, 14))
	}
	// deterministic: the same t gives the same state whatever came before (seek, back, GO)
	for _, at := range []float64{0, 1.5, 3, 7, 12.25, 19} {
		a, _ := json.Marshal(tl.StateAt(at))
		_ = tl.StateAt(at + 3)
		b, _ := json.Marshal(tl.StateAt(at))
		if string(a) != string(b) {
			t.Fatalf("state at %v changed: %s vs %s", at, a, b)
		}
	}
	if !(Clip{Effect: "reveal"}).Holds() || !(Clip{Effect: "sweep"}).Holds() || (Clip{Effect: "trace"}).Holds() || (Clip{Effect: EffectConverge, Hold: ptr(HoldOff)}).Holds() {
		t.Fatal("hold defaults")
	}
}

func hasAll(m map[string]ClipState, ids ...string) bool {
	for _, id := range ids {
		if _, ok := m[id]; !ok {
			return false
		}
	}
	return true
}

func seq() func(string) string {
	n := 0
	return func(p string) string { n++; return fmt.Sprintf("%s_%d", p, n) }
}

func fixtureScene(t *testing.T) *Scene {
	t.Helper()
	b, err := os.ReadFile("../../../../contract/fixtures/scene.json")
	if err != nil {
		t.Fatal(err)
	}
	sc, err := Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return sc
}

func apply(t *testing.T, sc *Scene, ops []docpatch.Op) *Scene {
	t.Helper()
	b, err := docpatch.ApplyPlain(sc.Encode(), ops)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestConvergeUsesTheClipAtStart(t *testing.T) {
	sc := fixtureScene(t)
	sc.Mode = ModeLive
	p, err := Converge(sc, ConvergeIn{}, seq())
	if err != nil {
		t.Fatal(err)
	}
	if p.Inserted || p.ClipID != "clp_converge" || p.Source != ModeLive || p.End != 2 {
		t.Fatalf("plan %+v", p)
	}
	// the fixture has a cue at 0 and the next one at 4: play from 0, hold at 4 with cue 0 started
	if p.HoldAt != 4 || p.Cue != 0 {
		t.Fatalf("hold %+v", p)
	}
	got := apply(t, sc, p.Ops)
	if got.Mode != ModeObjects || len(got.Timeline.Clips) != len(sc.Timeline.Clips) || len(got.Timeline.Cues) != len(sc.Timeline.Cues) {
		t.Fatalf("mode %s, %d clips, %d cues", got.Mode, len(got.Timeline.Clips), len(got.Timeline.Cues))
	}
	for _, c := range got.Timeline.Clips {
		if c.ID == "clp_converge" && c.Params["source"] != ModeLive {
			t.Fatalf("source %v", c.Params)
		}
	}
	// in objects mode already, the clip keeps its source
	p, _ = Converge(got, ConvergeIn{}, seq())
	if p.Source != ModeLive || len(p.Ops) != 0 {
		t.Fatalf("again %+v", p)
	}
	// a client that opened its objects view after scenery says so; a mode that is no backdrop is refused
	p, _ = Converge(got, ConvergeIn{Source: ModeScenery}, seq())
	if p.Source != ModeScenery || len(p.Ops) != 1 {
		t.Fatalf("source arg %+v", p)
	}
	if _, err := Converge(got, ConvergeIn{Source: ModeObjects}, seq()); err == nil {
		t.Fatal("source objects was accepted")
	}
}

func TestConvergeInsertsAClip(t *testing.T) {
	sc := fixtureScene(t)
	// no converge, no cues: everything else stays where it is
	var clips []Clip
	for _, c := range sc.Timeline.Clips {
		if c.Effect != EffectConverge {
			clips = append(clips, c)
		}
	}
	sc.Timeline.Clips, sc.Timeline.Cues = clips, nil
	sc.Mode = ModeStatic
	p, err := Converge(sc, ConvergeIn{Duration: 3}, seq())
	if err != nil {
		t.Fatal(err)
	}
	if !p.Inserted || p.Source != ModeStatic || p.End != 3 || p.HoldAt != 3 || p.Cue != 0 {
		t.Fatalf("plan %+v", p)
	}
	got := apply(t, sc, p.Ops)
	if err := got.Validate(refsT(t)); err != nil {
		t.Fatal(err)
	}
	var cv *Clip
	for i := range got.Timeline.Clips {
		if got.Timeline.Clips[i].ID == p.ClipID {
			cv = &got.Timeline.Clips[i]
		}
	}
	if cv == nil || cv.Start != 0 || cv.End != 3 || cv.Params["from"] != "current" || !cv.Holds() {
		t.Fatalf("clip %+v", cv)
	}
	var tr Track
	for _, x := range got.Timeline.Tracks {
		if x.ID == cv.TrackID {
			tr = x
		}
	}
	// the cube's faces track is busy at 0 (grid build), so the clip gets a track of its own on the first object
	if tr.Target.Kind != "object" || *tr.Target.ID != "obj_cube" || tr.ID == "trk_faces" {
		t.Fatalf("track %+v", tr)
	}
	if len(got.Timeline.Cues) != 2 || got.Timeline.Cues[0].At != 0 || got.Timeline.Cues[1].At != 3 {
		t.Fatalf("cues %+v", got.Timeline.Cues)
	}
	for i, c := range clips {
		if got.Timeline.Clips[i].Start != c.Start || got.Timeline.Clips[i].End != c.End {
			t.Fatalf("clip %s moved", c.ID)
		}
	}
	if got.Mode != ModeObjects {
		t.Fatalf("mode %s", got.Mode)
	}
	// "all", and an unknown object
	if p, _ := Converge(sc, ConvergeIn{ObjectID: "all"}, seq()); !p.Inserted {
		t.Fatal("all")
	}
	if _, err := Converge(sc, ConvergeIn{ObjectID: "obj_nope"}, seq()); err == nil {
		t.Fatal("an unknown object converges")
	}
	sc.Objects = nil
	if _, err := Converge(sc, ConvergeIn{}, seq()); err == nil {
		t.Fatal("a scene without objects converges")
	}
}
