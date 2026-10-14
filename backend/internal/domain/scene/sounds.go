package scene

import "encoding/json"

// Sounds is a scene's soundboard: its pads in grid order (protocol §14).
type Sounds struct {
	Pads []Pad `json:"pads"`
}

// Pad colours and icons (protocol §14).
var (
	PadColors = []string{"ink", "red", "amber", "green", "teal", "blue", "violet", "pink"}
	PadIcons  = []string{"none", "bell", "door", "thunder", "rain", "wind", "bird", "music", "voice", "knock", "spark", "heart"}
)

// Pad is one soundboard button.
type Pad struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Sound  string  `json:"sound"`
	Volume float64 `json:"volume"`
	Color  string  `json:"color"`
	Icon   string  `json:"icon"`
	Key    string  `json:"key,omitempty"`
	Loop   bool    `json:"loop"`
}

// UnmarshalJSON fills the defaults: volume 1, color ink, icon none.
func (p *Pad) UnmarshalJSON(b []byte) error {
	type plain Pad
	v := plain{Volume: 1, Color: "ink", Icon: "none"}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*p = Pad(v)
	return nil
}

// CueSound is the sound a cue plays when it starts.
type CueSound struct {
	Sound  string  `json:"sound"`
	Volume float64 `json:"volume"`
}

// UnmarshalJSON defaults volume to 1.
func (c *CueSound) UnmarshalJSON(b []byte) error {
	type plain CueSound
	v := plain{Volume: 1}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*c = CueSound(v)
	return nil
}

// Track target and clip effect of sound tracks.
const (
	TargetSound = "sound"
	EffectSound = "sound"
)

// Pad returns a pad by id, or nil.
func (s *Scene) Pad(id string) *Pad {
	for i := range s.Sounds.Pads {
		if s.Sounds.Pads[i].ID == id {
			return &s.Sounds.Pads[i]
		}
	}
	return nil
}

// StripMedia removes what points at files a fresh server does not have: the pads, the sound tracks and their clips,
// cue sounds and video layers (protocol §14, seeding).
func (s *Scene) StripMedia() {
	s.Sounds.Pads = []Pad{}
	sound := map[string]bool{}
	tracks := s.Timeline.Tracks[:0:0]
	for _, t := range s.Timeline.Tracks {
		if t.Target.Kind == TargetSound {
			sound[t.ID] = true
			continue
		}
		tracks = append(tracks, t)
	}
	s.Timeline.Tracks = tracks
	clips := s.Timeline.Clips[:0:0]
	for _, c := range s.Timeline.Clips {
		if !sound[c.TrackID] && c.Effect != EffectSound {
			clips = append(clips, c)
		}
	}
	s.Timeline.Clips = clips
	for i := range s.Timeline.Cues {
		s.Timeline.Cues[i].Sound = nil
	}
	for _, m := range BackdropModes {
		st := s.Backdrop.Stack(m)
		layers := st.Layers[:0:0]
		for _, l := range st.Layers {
			if l.Kind != LayerVideo {
				layers = append(layers, l)
			}
		}
		st.Layers = layers
	}
	s.Normalize()
}
