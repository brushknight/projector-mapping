package vision

import (
	"image"
	"math/rand"
	"strings"
	"testing"
)

// faintFrames is a calibration pass in a lit room: the projector adds only `gain` of its light on top of `ambient`.
func faintFrames(w *World, gain, noise float64, seed int64) Frames {
	rng := rand.New(rand.NewSource(seed))
	shot := func(kind, axis string, bit int, inv bool) image.Image {
		p := PatternFunc(kind, axis, bit, inv, w.ProjW, w.ProjH)
		return w.Render(func(x, y float64) float64 { return gain * p(x, y) }, noise, rng)
	}
	f := Frames{White: shot("white", "", 0, false), Black: shot("black", "", 0, false)}
	for b := 0; b < Bits(w.ProjW); b++ {
		f.X = append(f.X, [2]image.Image{shot("gray", "x", b, false), shot("gray", "x", b, true)})
	}
	for b := 0; b < Bits(w.ProjH); b++ {
		f.Y = append(f.Y, [2]image.Image{shot("gray", "y", b, false), shot("gray", "y", b, true)})
	}
	return f
}

func plane(t *testing.T) *World {
	camQuad := []Pt{{60, 50}, {590, 80}, {570, 440}, {80, 420}}
	h, err := FitHomography(camQuad, []Pt{{0, 0}, {320, 0}, {320, 200}, {0, 200}})
	if err != nil {
		t.Fatal(err)
	}
	return &World{CamW: 640, CamH: 480, ProjW: 320, ProjH: 200, Ambient: 0.55,
		Planes: []Plane{{Name: "wall", Camera: camQuad, H: h, Albedo: 0.8}}}
}

// TestDecodeFaintProjectorInLitRoom: the projector adds ~12/255 over a bright room. The adaptive threshold still finds
// the projected area and decodes it; the contrast report says how faint it is.
func TestDecodeFaintProjectorInLitRoom(t *testing.T) {
	w := plane(t)
	m, q, err := Decode(faintFrames(w, 0.06, 0.004, 5), 320, 200, DecodeOptions{})
	if err != nil {
		t.Fatalf("%v (contrast %+v)", err, q.Contrast)
	}
	if q.Coverage < 0.6 {
		t.Fatalf("coverage %.2f, contrast %+v", q.Coverage, q.Contrast)
	}
	if e := meanError(t, m, w); e > 2 {
		t.Fatalf("mean error %.2f px", e)
	}
	if q.Contrast.Peak > 20 || q.Contrast.Lit < 0.3 || q.Contrast.BrighterPct() > 15 {
		t.Fatalf("contrast %+v (%.1f%% brighter)", q.Contrast, q.Contrast.BrighterPct())
	}
}

// TestDecodeNoProjectorFails: nothing projected at all: a clear error and a contrast report that says so.
func TestDecodeNoProjectorFails(t *testing.T) {
	w := plane(t)
	_, q, err := Decode(faintFrames(w, 0, 0.004, 6), 320, 200, DecodeOptions{})
	if err == nil || !strings.Contains(err.Error(), "no pixel decoded") {
		t.Fatalf("err %v", err)
	}
	if q.Contrast.Peak > 6 && q.Contrast.Lit > 0.01 {
		t.Fatalf("contrast %+v, want nothing lit", q.Contrast)
	}
}
