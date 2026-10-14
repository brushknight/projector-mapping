package scene

import (
	"strings"
	"testing"

	"projmap/internal/domain/catalog"
)

type testRefs struct{}

func (testRefs) LayerSchema(kind, ref string) (catalog.Schema, bool) {
	one := 1.0
	zero := 0.0
	if kind == LayerVideo {
		return catalog.Schema{"blur": {Type: "number", Min: &zero, Max: &one}, "audio": {Type: "boolean"}}, true
	}
	return nil, true
}

func (testRefs) EffectSchema(id string) (catalog.Schema, bool) { return catalog.Schema{}, id != "nope" }

func base() Scene {
	s := New("scn_t", "set_t", "t")
	return s
}

func problems(t *testing.T, s Scene) string {
	t.Helper()
	s.Normalize()
	if err := s.Validate(testRefs{}); err != nil {
		return err.Error()
	}
	return ""
}

func TestPadValidation(t *testing.T) {
	s := base()
	s.Sounds.Pads = []Pad{{ID: "pad_a", Name: "thunder", Sound: "a77c31", Volume: 0.9, Color: "blue", Icon: "thunder", Key: "t", Loop: true}}
	if p := problems(t, s); p != "" {
		t.Fatalf("valid pad: %s", p)
	}
	bad := map[string]Pad{
		"used twice": {ID: "pad_a", Name: "x", Sound: "s", Volume: 1, Color: "ink", Icon: "none"},
		"1..40":      {ID: "pad_b", Name: strings.Repeat("x", 41), Sound: "s", Volume: 1, Color: "ink", Icon: "none"},
		"volume":     {ID: "pad_d", Name: "x", Sound: "s", Volume: 1.5, Color: "ink", Icon: "none"},
		"color":      {ID: "pad_e", Name: "x", Sound: "s", Volume: 1, Color: "mauve", Icon: "none"},
		"icon":       {ID: "pad_f", Name: "x", Sound: "s", Volume: 1, Color: "ink", Icon: "cat"},
		"key":        {ID: "pad_g", Name: "x", Sound: "s", Volume: 1, Color: "ink", Icon: "none", Key: "T"},
	}
	for want, p := range bad {
		s2 := s
		s2.Sounds.Pads = append(append([]Pad{}, s.Sounds.Pads...), p)
		if got := problems(t, s2); !strings.Contains(got, want) {
			t.Errorf("pad %+v: %q, want %q", p, got, want)
		}
	}
	s3 := s
	s3.Sounds.Pads = append(append([]Pad{}, s.Sounds.Pads...), Pad{ID: "pad_c", Name: "empty", Volume: 1, Color: "ink", Icon: "none"})
	if got := problems(t, s3); got != "" {
		t.Errorf("a pad without a sound yet is valid: %s", got)
	}
	var p Pad
	if err := p.UnmarshalJSON([]byte(`{"id":"pad_x","name":"x","sound":"s"}`)); err != nil || p.Volume != 1 || p.Color != "ink" || p.Icon != "none" {
		t.Fatalf("pad defaults %+v", p)
	}
}

func TestSoundTrackValidation(t *testing.T) {
	s := base()
	s.Timeline.Tracks = []Track{{ID: "trk_s", Name: "sound", Target: Target{Kind: TargetSound}}, {ID: "trk_all", Name: "all", Target: Target{Kind: "all"}}}
	s.Timeline.Clips = []Clip{{ID: "clp_s", TrackID: "trk_s", Effect: EffectSound, Start: 1, End: 4, Params: map[string]any{"sound": "a1b2c3", "offset": 0.5, "volume": 0.8}}}
	s.Timeline.Cues = []Cue{{ID: "cue_1", At: 0, Sound: &CueSound{Sound: "a1b2c3", Volume: 1}}}
	if p := problems(t, s); p != "" {
		t.Fatalf("valid sound track: %s", p)
	}
	cases := map[string]Clip{
		"needs effect sound":         {ID: "c1", TrackID: "trk_s", Effect: "pulse", Start: 0, End: 1, Params: map[string]any{"sound": "a"}},
		"params.sound":               {ID: "c2", TrackID: "trk_s", Effect: EffectSound, Start: 0, End: 1, Params: map[string]any{}},
		"params.offset":              {ID: "c3", TrackID: "trk_s", Effect: EffectSound, Start: 0, End: 1, Params: map[string]any{"sound": "a", "offset": -1.0}},
		"params.volume":              {ID: "c4", TrackID: "trk_s", Effect: EffectSound, Start: 0, End: 1, Params: map[string]any{"sound": "a", "volume": 2.0}},
		"only goes on a sound track": {ID: "c5", TrackID: "trk_all", Effect: EffectSound, Start: 0, End: 1, Params: map[string]any{"sound": "a"}},
	}
	for want, cl := range cases {
		s2 := s
		s2.Timeline.Clips = append(append([]Clip{}, s.Timeline.Clips...), cl)
		if got := problems(t, s2); !strings.Contains(got, want) {
			t.Errorf("clip %s: %q, want %q", cl.ID, got, want)
		}
	}
	s2 := s
	s2.Timeline.Cues = []Cue{{ID: "cue_1", Sound: &CueSound{Sound: "a", Volume: 3}}}
	if got := problems(t, s2); !strings.Contains(got, "sound.volume") {
		t.Errorf("cue volume: %q", got)
	}
}

func TestVideoLayer(t *testing.T) {
	for ref, ok := range map[string]bool{"youtube:aqz-KE-bpKQ": true, "asset:7c4e1d": true, "youtube:short": false, "asset:": false,
		"vimeo:123": false, "asset:XYZ!": false, "flowers": false} {
		if IsVideoRef(ref) != ok {
			t.Errorf("IsVideoRef(%q) = %v", ref, !ok)
		}
	}
	s := base()
	s.Backdrop.Scenery.Layers = []Layer{{ID: "lay_v", Kind: LayerVideo, Ref: "youtube:aqz-KE-bpKQ", Visible: true, Opacity: 1, Blend: "normal",
		Params: map[string]any{"blur": 0.2, "audio": false}}}
	if p := problems(t, s); p != "" {
		t.Fatalf("valid video layer: %s", p)
	}
	s.Backdrop.Scenery.Layers[0].Ref = "youtube:nope"
	if p := problems(t, s); !strings.Contains(p, "video ref") {
		t.Fatalf("bad ref: %q", p)
	}
	s.Backdrop.Scenery.Layers[0].Ref = "asset:7c4e1d"
	s.Backdrop.Scenery.Layers[0].Params["blur"] = 3.0
	if p := problems(t, s); !strings.Contains(p, "blur") {
		t.Fatalf("bad param: %q", p)
	}
}
