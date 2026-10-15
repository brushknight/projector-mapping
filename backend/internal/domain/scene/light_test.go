package scene

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	builtin "projmap/internal/catalog"
	"projmap/internal/domain/catalog"
)

type catRefs struct{ c *catalog.Catalog }

func (r catRefs) LayerSchema(kind, ref string) (catalog.Schema, bool) {
	return r.c.LayerSchema(kind, ref)
}
func (r catRefs) EffectSchema(id string) (catalog.Schema, bool) {
	e := r.c.Effect(id)
	if e == nil {
		return nil, false
	}
	var s catalog.Schema
	_ = json.Unmarshal(e.Params, &s)
	return s, true
}

func refsT(t *testing.T) catRefs {
	t.Helper()
	c, err := catalog.Parse(builtin.JSON)
	if err != nil {
		t.Fatal(err)
	}
	return catRefs{c}
}

// TestUpgradeV3Scene upgrades the scene fixture as it was before the light model (gobo layers in static and live).
func TestUpgradeV3Scene(t *testing.T) {
	raw, err := os.ReadFile("testdata/scene-v3.json")
	if err != nil {
		t.Fatal(err)
	}
	out, changed, err := Upgrade(raw)
	if err != nil || !changed {
		t.Fatalf("upgrade: changed %v, err %v", changed, err)
	}
	sc, err := Decode(out)
	if err != nil {
		t.Fatal(err)
	}
	st := sc.Backdrop.Static
	if len(st.Layers) != 0 || len(st.Attachments) != 1 || st.Light == nil {
		t.Fatalf("static %+v", st)
	}
	a := st.Attachments[0]
	// (§16) the removed 6-pane window moves to the grid window preset, keeping its panes
	if a.ID != "lay_window" || a.Gobo != "plate-grid-window" || a.Params["cols"] != 2.0 || a.Params["rows"] != 3.0 || a.Params["sashes"] != 1.0 ||
		a.Rotation != -22 || a.Scale != 1.4 || !a.Visible || a.Opacity != 1 || a.Motion != nil {
		t.Fatalf("attachment %+v", a)
	}
	if l := st.Light; l.Focus < 0.379 || l.Focus > 0.381 || l.Intensity != 0.8 || l.Color.Kelvin != 3200 || l.Color.Tint != 0.04 ||
		l.Fringe != 0.2 || l.Vignette != 0 || l.BackgroundFocus != 1 || l.Slide != (Pt{}) || l.Motion != nil || l.ColorLayer != nil {
		t.Fatalf("static light %+v", l)
	}
	lv := sc.Backdrop.Live
	if len(lv.Layers) != 1 || lv.Layers[0].ID != "lay_tree" || len(lv.Attachments) != 1 || lv.Attachments[0].ID != "lay_live_window" ||
		lv.Light == nil || lv.Light.Focus < 0.449 || lv.Light.Focus > 0.451 {
		t.Fatalf("live %+v", lv)
	}
	if sc.Kind != KindMapping || sc.Mode != ModeStatic {
		t.Fatalf("kind %s mode %s", sc.Kind, sc.Mode)
	}
	if err := sc.Validate(refsT(t)); err != nil {
		t.Fatalf("the upgraded scene is invalid: %v", err)
	}
	// the stored form writes the light model: static light and attachments, live light, color and scenery layers only
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	bd := m["backdrop"].(map[string]any)
	if _, ok := bd["color"].(map[string]any)["light"]; ok {
		t.Fatalf("color stack writes a light: %v", bd["color"])
	}
	if bd["static"].(map[string]any)["light"] == nil || bd["static"].(map[string]any)["attachments"] == nil || m["kind"] != "mapping" {
		t.Fatalf("static %v kind %v", bd["static"], m["kind"])
	}
	// once upgraded, it stays
	if _, again, err := Upgrade(out); err != nil || again {
		t.Fatalf("second upgrade changed %v (%v)", again, err)
	}
}

func TestUpgradeStacksWithoutGobos(t *testing.T) {
	doc := `{"id":"s","setupId":"x","name":"n","version":2,"mode":"color","backdrop":{"static":{"layers":[]},"live":{"layers":[
		{"id":"c","kind":"procedural","ref":"clouds","name":"clouds","visible":true,"opacity":1,"blend":"normal","light":{"intensity":0.5,"softness":0.7,"angle":0,"scale":1,"offsetX":0,"offsetY":0,"color":{"mode":"cct","kelvin":7000,"tint":0,"hue":0,"sat":0},"fx":{"kind":"none","speed":0.3}},"params":{}}]},
		"color":{"layers":[]},"scenery":{"layers":[]}},"points":[],"objects":[],"timeline":{"duration":20,"tracks":[],"clips":[],"cues":[]}}`
	sc, err := Decode([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	if sc.Backdrop.Live.Light != nil || len(sc.Backdrop.Live.Layers) != 1 || sc.Backdrop.Live.Attachments == nil {
		t.Fatalf("live %+v", sc.Backdrop.Live)
	}
	if l := sc.Backdrop.Static.Light; l == nil || *l != DefaultStackLight() || l.Color.Kelvin != 5600 {
		t.Fatalf("static light %+v", l)
	}
	if sc.Kind != KindColor {
		t.Fatalf("kind %s", sc.Kind)
	}
	if err := sc.Validate(refsT(t)); err != nil {
		t.Fatal(err)
	}
	enc := string(sc.Encode())
	if !strings.Contains(enc, `"live":{"layers":[`) || !strings.Contains(enc, `"light":null,"attachments":[]}`) {
		t.Fatalf("live is written with light null and attachments []: %s", enc)
	}
}

func TestUpgradeV3Preset(t *testing.T) {
	raw, err := os.ReadFile("testdata/preset-v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var p Preset
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	if !p.Upgrade() || p.Upgrade() {
		t.Fatal("a v3 static preset upgrades once")
	}
	if len(p.Backdrop.Layers) != 0 || len(p.Backdrop.Attachments) != 1 || p.Backdrop.Light == nil || p.Backdrop.Attachments[0].Gobo != "plate-grid-window" || p.Format != FormatVersion {
		t.Fatalf("preset %+v", p.Backdrop)
	}
	b, _ := json.Marshal(p)
	if !strings.Contains(string(b), `"backdrop":{"layers":[],"light":{`) {
		t.Fatalf("preset json %s", b)
	}
	color := Preset{ID: "p", Name: "c", Mode: ModeColor, Backdrop: LayerStack{Layers: []Layer{}}, Format: FormatVersion}
	if color.Upgrade() {
		t.Fatal("a color preset has nothing to upgrade")
	}
	if b, _ := json.Marshal(color); !strings.Contains(string(b), `"backdrop":{"layers":[]}`) {
		t.Fatalf("color preset json %s", b)
	}
}

func TestDefaultsOnDecode(t *testing.T) {
	var st LayerStack
	if err := json.Unmarshal([]byte(`{"layers":[],"light":{"focus":0.5,"motion":{"from":{"x":-1,"y":0},"to":{"x":1,"y":0}}},"attachments":[{"id":"att_1","gobo":"blinds"}]}`), &st); err != nil {
		t.Fatal(err)
	}
	l := st.Light
	if l.Focus != 0.5 || l.Intensity != 0.85 || l.Color.Kelvin != 5600 || l.Fringe != 0.2 || l.FX.Kind != "none" {
		t.Fatalf("light defaults %+v", l)
	}
	if m := l.Motion; !m.On || m.Duration != 60 || m.Easing != "linear" || m.Loop != "loop" || m.ScaleFrom != 1 || m.ScaleTo != 1 || m.Via != nil {
		t.Fatalf("motion defaults %+v", m)
	}
	if a := st.Attachments[0]; !a.Visible || a.Opacity != 1 || a.Scale != 1 || a.Rotation != 0 {
		t.Fatalf("attachment defaults %+v", a)
	}
}

func TestValidateLightModel(t *testing.T) {
	refs := refsT(t)
	mk := func() *Scene {
		s := New("scn_x", "set_x", "x")
		s.Normalize()
		return &s
	}
	s := mk()
	if err := s.Validate(refs); err != nil {
		t.Fatalf("a new scene is valid: %v", err)
	}
	cases := map[string]func(s *Scene){
		"layers in static": func(s *Scene) {
			s.Backdrop.Static.Layers = []Layer{{ID: "lay_1", Kind: "gobo", Ref: "window", Blend: "normal", Opacity: 1, Light: DefaultLight(), Params: map[string]any{}}}
		},
		"unknown gobo": func(s *Scene) {
			s.Backdrop.Static.Attachments = []Attachment{{ID: "att_1", Gobo: "nope", Opacity: 1, Scale: 1, Params: map[string]any{}}}
		},
		"gobo param out of range": func(s *Scene) {
			s.Backdrop.Static.Attachments = []Attachment{{ID: "att_1", Gobo: "plate-grid-window", Opacity: 1, Scale: 1, Params: map[string]any{"cols": 13.0}}}
		},
		"gobo param from goboParams": func(s *Scene) {
			s.Backdrop.Static.Attachments = []Attachment{{ID: "att_1", Gobo: "plate-grid-window", Opacity: 1, Scale: 1, Params: map[string]any{"throw": 2.0}}}
		},
		"scale": func(s *Scene) {
			s.Backdrop.Static.Attachments = []Attachment{{ID: "att_1", Gobo: "plate-grid-window", Opacity: 1, Scale: 20, Params: map[string]any{}}}
		},
		"duplicate id with a layer": func(s *Scene) {
			s.Backdrop.Static.Attachments = []Attachment{{ID: "lay_1", Gobo: "plate-grid-window", Opacity: 1, Scale: 1, Params: map[string]any{}}}
			s.Backdrop.Color.Layers = []Layer{{ID: "lay_1", Kind: "gradient", Ref: "ember", Blend: "normal", Opacity: 1, Params: map[string]any{}}}
		},
		"focus":     func(s *Scene) { s.Backdrop.Static.Light.Focus = 1.2 },
		"slide":     func(s *Scene) { s.Backdrop.Static.Light.Slide.X = -1.5 },
		"no static": func(s *Scene) { s.Backdrop.Static.Light = nil },
		"color layer kind": func(s *Scene) {
			s.Backdrop.Static.Light.ColorLayer = &ColorLayer{Kind: "photo", Ref: "flowers", Params: map[string]any{}}
		},
		"generator param": func(s *Scene) {
			s.Backdrop.Static.Light.ColorLayer = &ColorLayer{Kind: "generator", Ref: "hue-cycle", Params: map[string]any{"speed": 3.0}}
		},
		"gradient stops": func(s *Scene) {
			s.Backdrop.Static.Light.ColorLayer = &ColorLayer{Kind: "gradient", Ref: "ember", Params: map[string]any{"stops": []any{map[string]any{"color": "red", "pos": 0.0}}}}
		},
		"easing": func(s *Scene) {
			m := DefaultMotion()
			m.Easing = "bounce"
			s.Backdrop.Static.Light.Motion = &m
		},
		"kelvin drift": func(s *Scene) {
			m := DefaultMotion()
			m.KelvinFrom = 500
			s.Backdrop.Static.Light.Motion = &m
		},
		"duration": func(s *Scene) {
			m := DefaultMotion()
			m.Duration = 0.5
			s.Backdrop.Static.Light.Motion = &m
		},
		"kind": func(s *Scene) { s.Kind = "party" },
		"motion on a gradient layer": func(s *Scene) {
			m := DefaultMotion()
			s.Backdrop.Color.Layers = []Layer{{ID: "lay_1", Kind: "gradient", Ref: "ember", Blend: "normal", Opacity: 1, Params: map[string]any{}, Motion: &m}}
		},
		"generator layer param": func(s *Scene) {
			s.Backdrop.Color.Layers = []Layer{{ID: "lay_1", Kind: "generator", Ref: "pulse", Blend: "normal", Opacity: 1, Params: map[string]any{"speed": -1.0}}}
		},
		"motion clip on a light track takes from 0..1": func(s *Scene) {
			id := LightStatic
			s.Timeline.Tracks = []Track{{ID: "trk_1", Name: "light", Target: Target{Kind: "layer", ID: &id}}}
			s.Timeline.Clips = []Clip{{ID: "clp_1", TrackID: "trk_1", Effect: "motion", Start: 0, End: 2, Params: map[string]any{"to": 2.0}}}
		},
		"reveal clip on an attachment track": func(s *Scene) {
			id := "att_1"
			s.Backdrop.Static.Attachments = []Attachment{{ID: "att_1", Gobo: "plate-grid-window", Opacity: 1, Scale: 1, Params: map[string]any{}}}
			s.Timeline.Tracks = []Track{{ID: "trk_1", Name: "att", Target: Target{Kind: "layer", ID: &id}}}
			s.Timeline.Clips = []Clip{{ID: "clp_1", TrackID: "trk_1", Effect: "reveal", Start: 0, End: 2, Params: map[string]any{}}}
		},
		"track on a missing target": func(s *Scene) {
			id := "cl_nope"
			s.Timeline.Tracks = []Track{{ID: "trk_1", Name: "att", Target: Target{Kind: "layer", ID: &id}}}
		},
	}
	for name, mut := range cases {
		s := mk()
		mut(s)
		if err := s.Validate(refs); err == nil {
			t.Errorf("%s: want a validation error", name)
		}
	}
	// the good versions pass
	s = mk()
	m := DefaultMotion()
	m.KelvinFrom, m.KelvinTo = 2300, 4300
	s.Backdrop.Static.Light.Motion = &m
	s.Backdrop.Static.Light.ColorLayer = &ColorLayer{Kind: "generator", Ref: "hue-cycle", Params: map[string]any{"speed": 0.5}}
	s.Backdrop.Static.Attachments = []Attachment{{ID: "att_1", Gobo: "plate-arched-window", Visible: true, Opacity: 0.6, Scale: 1.25, Rotation: -12,
		Params: map[string]any{"cols": 3.0, "throw": 0.25, "arch": false, "taper": -0.4, "field": "fill"}, Motion: &m}}
	s.Backdrop.Live.Attachments = []Attachment{{ID: "att_2", Gobo: "plate-blinds", Visible: true, Opacity: 1, Scale: 1, Params: map[string]any{}}}
	s.Backdrop.Color.Layers = []Layer{{ID: "lay_1", Kind: "generator", Ref: "pulse", Blend: "normal", Opacity: 1, Params: map[string]any{}}}
	att, light := "att_2", LightLive
	s.Timeline.Tracks = []Track{{ID: "trk_1", Name: "att", Target: Target{Kind: "layer", ID: &att}}, {ID: "trk_2", Name: "light", Target: Target{Kind: "layer", ID: &light}}}
	s.Timeline.Clips = []Clip{{ID: "clp_1", TrackID: "trk_1", Effect: "motion", Start: 0, End: 2, Params: map[string]any{"from": 0.0, "to": 1.0}},
		{ID: "clp_2", TrackID: "trk_2", Effect: "motion", Start: 0, End: 2, Params: map[string]any{}}}
	if err := s.Validate(refs); err != nil {
		t.Fatalf("valid light model: %v", err)
	}
	if InferKind(s) != KindStatic {
		t.Fatal("infer kind")
	}
}

func TestTemplates(t *testing.T) {
	refs := refsT(t)
	for _, tpl := range refs.c.SceneTemplates {
		s, err := FromTemplate(refs.c, tpl.ID, "scn_t", "set_t", tpl.Name)
		if err != nil {
			t.Fatalf("%s: %v", tpl.ID, err)
		}
		if s.Kind != tpl.Kind || s.Mode != KindMode(tpl.Kind) {
			t.Errorf("%s: kind %s mode %s", tpl.ID, s.Kind, s.Mode)
		}
		if err := s.Validate(refs); err != nil {
			t.Errorf("%s is invalid: %v", tpl.ID, err)
		}
	}
	s, _ := FromTemplate(refs.c, "static-window", "scn_t", "set_t", "w")
	a := s.Backdrop.Static.Attachments[0]
	l := s.Backdrop.Static.Light
	if _, geo := a.Params["cols"]; a.Gobo != "plate-grid-window" || a.Params["throw"] != 0.25 || geo || a.Params["field"] != "round" || a.Scale != 1.25 || a.Motion == nil || a.Motion.On ||
		a.Motion.Preset != "sun-lr" || a.Motion.Duration != 600 || a.Motion.Phase != 0.5 || l.Color.Kelvin != 3200 || l.Focus != 1 || l.BackgroundFocus != 1 || l.Intensity != 0.85 {
		t.Fatalf("static-window %+v %+v", a, l)
	}
	if !strings.HasPrefix(a.ID, "att_") || len(a.ID) != 12 {
		t.Fatalf("attachment id %s", a.ID)
	}
	s, _ = FromTemplate(refs.c, "live-window-tree", "scn_t", "set_t", "w")
	if s.Backdrop.Live.Light == nil || len(s.Backdrop.Live.Attachments) != 1 || s.Backdrop.Live.Layers[0].Ref != "tree-sway" || s.Backdrop.Live.Layers[0].Blend != "multiply" {
		t.Fatalf("live-window-tree %+v", s.Backdrop.Live)
	}
	s, _ = FromTemplate(refs.c, "mapping-empty", "scn_t", "set_t", "w")
	if s.Mode != ModeObjects || s.Kind != KindMapping {
		t.Fatalf("mapping-empty %s %s", s.Mode, s.Kind)
	}
}
