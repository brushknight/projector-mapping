// Package scene holds the scene document (backdrop layers, mapping points, objects and surfaces, timeline), its
// validation, drafts, history entries and presets.
package scene

import "encoding/json"

// Scene is everything the wall shows.
type Scene struct {
	ID       string   `json:"id"`
	SetupID  string   `json:"setupId"`
	Name     string   `json:"name"`
	Version  int64    `json:"version"`
	Mode     string   `json:"mode"`
	Backdrop Backdrop `json:"backdrop"`
	Underlay Underlay `json:"underlay"`
	Points   []Point  `json:"points"`
	Objects  []Object `json:"objects"`
	Timeline Timeline `json:"timeline"`
}

// Summary is a scene in a list.
type Summary struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	SetupID string `json:"setupId"`
	Version int64  `json:"version"`
}

// Scene modes: exactly one is on air (protocol §1 Scene.mode).
const (
	ModeStatic  = "static"
	ModeLive    = "live"
	ModeColor   = "color"
	ModeScenery = "scenery"
	ModeObjects = "objects"
)

// BackdropModes are the modes with a layer stack, in the order the stacks are listed.
var BackdropModes = []string{ModeStatic, ModeLive, ModeColor, ModeScenery}

// Modes are every scene mode.
var Modes = map[string]bool{ModeStatic: true, ModeLive: true, ModeColor: true, ModeScenery: true, ModeObjects: true}

// IsBackdropMode tells whether m has a layer stack.
func IsBackdropMode(m string) bool {
	return m == ModeStatic || m == ModeLive || m == ModeColor || m == ModeScenery
}

// LayerStack is one backdrop stack, bottom to top.
type LayerStack struct {
	Layers []Layer `json:"layers"`
}

// Backdrop holds one stack per backdrop mode.
type Backdrop struct {
	Static  LayerStack `json:"static"`
	Live    LayerStack `json:"live"`
	Color   LayerStack `json:"color"`
	Scenery LayerStack `json:"scenery"`
}

// Stack returns the stack of a backdrop mode (nil for objects or an unknown mode).
func (b *Backdrop) Stack(mode string) *LayerStack {
	switch mode {
	case ModeStatic:
		return &b.Static
	case ModeLive:
		return &b.Live
	case ModeColor:
		return &b.Color
	case ModeScenery:
		return &b.Scenery
	}
	return nil
}

// All returns every layer of every stack with its mode.
func (b *Backdrop) All() []ModeLayer {
	var out []ModeLayer
	for _, m := range BackdropModes {
		for _, l := range b.Stack(m).Layers {
			out = append(out, ModeLayer{Mode: m, Layer: l})
		}
	}
	return out
}

// ModeLayer is a layer with the stack it lives in.
type ModeLayer struct {
	Mode  string
	Layer Layer
}

// Underlay is the backdrop drawn under the objects in objects mode, scaled by Level.
type Underlay struct {
	On    bool    `json:"on"`
	From  string  `json:"from"`
	Level float64 `json:"level"`
}

// DefaultUnderlay is off, from the static stack, at 35 %.
func DefaultUnderlay() Underlay { return Underlay{On: false, From: ModeStatic, Level: 0.35} }

// Layer is one backdrop layer.
type Layer struct {
	ID      string         `json:"id"`
	Kind    string         `json:"kind"`
	Ref     string         `json:"ref"`
	Name    string         `json:"name"`
	Visible bool           `json:"visible"`
	Opacity float64        `json:"opacity"`
	Blend   string         `json:"blend"`
	Light   *Light         `json:"light"`
	Params  map[string]any `json:"params"`
}

// Light applies to gobo and procedural layers.
type Light struct {
	Intensity float64 `json:"intensity"`
	Softness  float64 `json:"softness"`
	Angle     float64 `json:"angle"`
	Scale     float64 `json:"scale"`
	OffsetX   float64 `json:"offsetX"`
	OffsetY   float64 `json:"offsetY"`
	Color     Color   `json:"color"`
	FX        LightFX `json:"fx"`
}

// Color is cct (kelvin, tint) or hsi (hue, sat); both sets are kept so switching modes is lossless.
type Color struct {
	Mode   string  `json:"mode"`
	Kelvin float64 `json:"kelvin"`
	Tint   float64 `json:"tint"`
	Hue    float64 `json:"hue"`
	Sat    float64 `json:"sat"`
}

// LightFX is a time-based intensity/colour curve.
type LightFX struct {
	Kind  string  `json:"kind"`
	Speed float64 `json:"speed"`
}

// DefaultLight is a warm window light.
func DefaultLight() *Light {
	return &Light{Intensity: 0.8, Softness: 0.5, Scale: 1, Color: Color{Mode: "cct", Kelvin: 3200, Hue: 212, Sat: 0.7},
		FX: LightFX{Kind: "none", Speed: 0.35}}
}

// Point is a mapping point in scene pixels.
type Point struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

// Object is a real thing being mapped.
type Object struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Tags     []string  `json:"tags"`
	Visible  bool      `json:"visible"`
	Surfaces []Surface `json:"surfaces"`
}

// Surface is one mapped shape.
type Surface struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Kind     string          `json:"kind"`
	Role     string          `json:"role"`
	PointIDs []string        `json:"pointIds"`
	ParentID *string         `json:"parentId"`
	Visible  bool            `json:"visible"`
	Mesh     *Mesh           `json:"mesh"`
	Effects  []SurfaceEffect `json:"effects"`
	Opacity  float64         `json:"opacity"`
	SoftEdge float64         `json:"softEdge"`
}

// Mesh is a quad's warp grid.
type Mesh struct {
	Cols    int          `json:"cols"`
	Rows    int          `json:"rows"`
	Bezier  bool         `json:"bezier"`
	Offsets [][2]float64 `json:"offsets"`
}

// SurfaceEffect is always-on content.
type SurfaceEffect struct {
	ID      string         `json:"id"`
	Effect  string         `json:"effect"`
	Enabled bool           `json:"enabled"`
	Params  map[string]any `json:"params"`
}

// Timeline is tracks, clips and cues.
type Timeline struct {
	Duration float64 `json:"duration"`
	Tracks   []Track `json:"tracks"`
	Clips    []Clip  `json:"clips"`
	Cues     []Cue   `json:"cues"`
}

// Track targets a surface, an object or everything.
type Track struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Target Target `json:"target"`
}

// Target of a track.
type Target struct {
	Kind string  `json:"kind"`
	ID   *string `json:"id"`
}

// Clip is timed content.
type Clip struct {
	ID      string         `json:"id"`
	TrackID string         `json:"trackId"`
	Effect  string         `json:"effect"`
	Start   float64        `json:"start"`
	End     float64        `json:"end"`
	FadeIn  float64        `json:"fadeIn"`
	FadeOut float64        `json:"fadeOut"`
	Params  map[string]any `json:"params"`
}

// Cue is a GO stop.
type Cue struct {
	ID         string  `json:"id"`
	At         float64 `json:"at"`
	Label      string  `json:"label"`
	AutoFollow bool    `json:"autoFollow"`
}

// New is an empty scene.
func New(id, setupID, name string) Scene {
	return Scene{ID: id, SetupID: setupID, Name: name, Version: 1, Mode: ModeStatic, Underlay: DefaultUnderlay(), Points: []Point{},
		Objects: []Object{}, Timeline: Timeline{Duration: 20, Tracks: []Track{}, Clips: []Clip{}, Cues: []Cue{}}}
}

// Normalize replaces nil slices and maps with empty ones so the JSON never carries null where a list is expected.
func (s *Scene) Normalize() {
	if s.Mode == "" {
		s.Mode = ModeStatic
	}
	if s.Underlay.From == "" {
		s.Underlay.From = ModeStatic
	}
	for _, m := range BackdropModes {
		st := s.Backdrop.Stack(m)
		if st.Layers == nil {
			st.Layers = []Layer{}
		}
		for i := range st.Layers {
			if st.Layers[i].Params == nil {
				st.Layers[i].Params = map[string]any{}
			}
		}
	}
	if s.Points == nil {
		s.Points = []Point{}
	}
	if s.Objects == nil {
		s.Objects = []Object{}
	}
	for i := range s.Objects {
		o := &s.Objects[i]
		if o.Tags == nil {
			o.Tags = []string{}
		}
		if o.Surfaces == nil {
			o.Surfaces = []Surface{}
		}
		for j := range o.Surfaces {
			sf := &o.Surfaces[j]
			if sf.Effects == nil {
				sf.Effects = []SurfaceEffect{}
			}
			if sf.PointIDs == nil {
				sf.PointIDs = []string{}
			}
			for k := range sf.Effects {
				if sf.Effects[k].Params == nil {
					sf.Effects[k].Params = map[string]any{}
				}
			}
		}
	}
	t := &s.Timeline
	if t.Tracks == nil {
		t.Tracks = []Track{}
	}
	if t.Clips == nil {
		t.Clips = []Clip{}
	}
	for i := range t.Clips {
		if t.Clips[i].Params == nil {
			t.Clips[i].Params = map[string]any{}
		}
	}
	if t.Cues == nil {
		t.Cues = []Cue{}
	}
}

// Decode parses a scene document. Documents from before modes (v1, `backdrop: { layers }`) are upgraded on the way
// in (see Upgrade).
func Decode(doc []byte) (*Scene, error) {
	doc, _, err := Upgrade(doc)
	if err != nil {
		return nil, err
	}
	var s Scene
	if err := json.Unmarshal(doc, &s); err != nil {
		return nil, err
	}
	s.Normalize()
	return &s, nil
}

// Encode is the canonical JSON of a scene.
func (s *Scene) Encode() []byte {
	s.Normalize()
	b, _ := json.Marshal(s)
	return b
}

// Point returns a point by id.
func (s *Scene) Point(id string) *Point {
	for i := range s.Points {
		if s.Points[i].ID == id {
			return &s.Points[i]
		}
	}
	return nil
}

// PointIndex returns a point's index or -1.
func (s *Scene) PointIndex(id string) int {
	for i := range s.Points {
		if s.Points[i].ID == id {
			return i
		}
	}
	return -1
}

// FindSurface returns the object and surface indexes of a surface id.
func (s *Scene) FindSurface(id string) (oi, si int, ok bool) {
	for i := range s.Objects {
		for j := range s.Objects[i].Surfaces {
			if s.Objects[i].Surfaces[j].ID == id {
				return i, j, true
			}
		}
	}
	return -1, -1, false
}

// FindObject returns an object's index by id or name.
func (s *Scene) FindObject(idOrName string) int {
	for i := range s.Objects {
		if s.Objects[i].ID == idOrName {
			return i
		}
	}
	for i := range s.Objects {
		if s.Objects[i].Name == idOrName {
			return i
		}
	}
	return -1
}

// SurfacePoints returns a surface's points in order.
func (s *Scene) SurfacePoints(sf *Surface) []Point {
	out := make([]Point, 0, len(sf.PointIDs))
	for _, id := range sf.PointIDs {
		if p := s.Point(id); p != nil {
			out = append(out, *p)
		}
	}
	return out
}
