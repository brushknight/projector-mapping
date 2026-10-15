package scene

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestStaticBackgroundAndFocus (protocol §16): the static stack takes background layers (solid, gradient, generator,
// procedural) but no gobo or photo layers; both focus rings are checked; haze is dropped on decode.
func TestStaticBackgroundAndFocus(t *testing.T) {
	refs := refsT(t)
	s := New("scn_b", "set_b", "b")
	s.Normalize()
	grad, _ := NewLayer(refs.c, "gradient", "ember")
	proc, _ := NewLayer(refs.c, "procedural", "caustics")
	s.Backdrop.Static.Layers = []Layer{grad, proc}
	if err := s.Validate(refs); err != nil {
		t.Fatalf("background layers: %v", err)
	}
	photo, _ := NewLayer(refs.c, "photo", "flowers")
	s.Backdrop.Static.Layers = []Layer{photo}
	if err := s.Validate(refs); err == nil || !strings.Contains(err.Error(), "background layers") {
		t.Fatalf("a photo in static: %v", err)
	}
	s.Backdrop.Static.Layers = []Layer{}
	s.Backdrop.Static.Light.BackgroundFocus = 1.5
	if err := s.Validate(refs); err == nil || !strings.Contains(err.Error(), "backgroundFocus") {
		t.Fatalf("backgroundFocus range: %v", err)
	}
	var l StackLight
	if err := json.Unmarshal([]byte(`{"focus":0.4,"haze":0.6}`), &l); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(l)
	if l.Focus != 0.4 || l.BackgroundFocus != 1 || l.Vignette != 0 || strings.Contains(string(b), "haze") {
		t.Fatalf("decode %s", b)
	}
}

// TestPresetKeepsLens: a preset takes its attachments and light colour but keeps the scene's focus rings, lens and slide.
func TestPresetKeepsLens(t *testing.T) {
	s := New("scn_p", "set_p", "p")
	s.Normalize()
	cur := DefaultStackLight()
	cur.Focus, cur.BackgroundFocus, cur.Fringe, cur.Vignette, cur.Slide = 0.4, 0.3, 0.6, 0.5, Pt{X: 0.2}
	s.Backdrop.Static.Light = &cur
	pl := DefaultStackLight()
	pl.Intensity, pl.Color.Kelvin, pl.Focus = 0.5, 2700, 0.9
	pr := &Preset{ID: "pre_k", Mode: ModeStatic, Backdrop: LayerStack{Layers: []Layer{}, Light: &pl, Attachments: []Attachment{{ID: "att_k", Gobo: "plate-dots"}}}}
	ops := PresetOps(pr, &s)
	var st LayerStack
	if err := json.Unmarshal(ops[0].Value, &st); err != nil {
		t.Fatal(err)
	}
	if l := st.Light; l.Intensity != 0.5 || l.Color.Kelvin != 2700 || l.Focus != 0.4 || l.BackgroundFocus != 0.3 || l.Fringe != 0.6 || l.Vignette != 0.5 || l.Slide.X != 0.2 {
		t.Fatalf("preset light %+v", l)
	}
	if pr.Backdrop.Light.Focus != 0.9 {
		t.Fatal("the stored preset changed")
	}
}
