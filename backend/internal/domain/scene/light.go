package scene

import (
	"crypto/rand"
	"encoding/json"
	"math/big"
)

// Pt is a point or offset in frame fractions (x of the width, y of the height).
type Pt struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// StackLight is the light of the static and live stacks (protocol §15): a spotlight that lights the whole frame,
// coloured by its colour, a colour layer or the stack's background layers, masked by the attachments. Focus sharpens
// the attachments (and in live the multiply layers that join the mask), BackgroundFocus the background (protocol §16).
// Haze is gone since §16: an old document's haze is dropped on decode and never written.
type StackLight struct {
	Intensity float64 `json:"intensity"`
	// Focus is the attachment focus: 1 sharp (the default), 0 fully soft.
	Focus float64 `json:"focus"`
	// BackgroundFocus blurs what lies under the attachments: the colour layer and background layers in static, the
	// live layers in live. 1 sharp (the default).
	BackgroundFocus float64 `json:"backgroundFocus"`
	Color           Color   `json:"color"`
	FX              LightFX `json:"fx"`
	// ColorLayer colours the light before the masks; nil = the light's own colour.
	ColorLayer *ColorLayer `json:"colorLayer"`
	Fringe     float64     `json:"fringe"`
	Vignette   float64     `json:"vignette"`
	// Slide pans the whole composed light inside the frame (frame fractions, -1..1).
	Slide Pt `json:"slide"`
	// Motion drives the slide, turns and scales every attachment and drifts the CCT; nil = none.
	Motion *Motion `json:"motion"`
}

// DefaultKelvin is the colour temperature of a new stack light.
const DefaultKelvin = 5600

// DefaultStackLight is the light a static stack gets when it has none: 5600 K, intensity 0.85, both focus rings sharp
// (1), colour fringe 0.2, no vignette (protocol §16).
func DefaultStackLight() StackLight {
	return StackLight{Intensity: 0.85, Focus: 1, BackgroundFocus: 1, Color: Color{Mode: "cct", Kelvin: DefaultKelvin, Tint: 0, Hue: 212, Sat: 0.7},
		FX: LightFX{Kind: "none", Speed: 0.35}, Fringe: 0.2, Vignette: 0}
}

// UnmarshalJSON fills absent fields with the defaults.
func (l *StackLight) UnmarshalJSON(b []byte) error {
	type plain StackLight
	p := plain(DefaultStackLight())
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*l = StackLight(p)
	return nil
}

// ColorLayer kinds.
const (
	ColorLayerGradient  = "gradient"
	ColorLayerGenerator = "generator"
)

// ColorLayer colours a stack light: a catalog gradient or a colour generator.
type ColorLayer struct {
	Kind   string         `json:"kind"`
	Ref    string         `json:"ref"`
	Params map[string]any `json:"params"`
}

// Attachment is a gobo in front of the stack light: a mask that blocks light.
type Attachment struct {
	ID      string  `json:"id"`
	Gobo    string  `json:"gobo"`
	Name    string  `json:"name"`
	Visible bool    `json:"visible"`
	Opacity float64 `json:"opacity"`
	// Rotation in degrees; OffsetX, OffsetY in frame fractions from the frame centre; Scale a factor.
	Rotation float64        `json:"rotation"`
	OffsetX  float64        `json:"offsetX"`
	OffsetY  float64        `json:"offsetY"`
	Scale    float64        `json:"scale"`
	Params   map[string]any `json:"params"`
	// Motion moves this attachment; nil = none.
	Motion *Motion `json:"motion"`
}

// UnmarshalJSON fills absent fields with the defaults (visible, opacity 1, scale 1).
func (a *Attachment) UnmarshalJSON(b []byte) error {
	type plain Attachment
	p := plain{Visible: true, Opacity: 1, Scale: 1}
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*a = Attachment(p)
	return nil
}

// Motion easings and loops (protocol §15).
var (
	MotionEasings = []string{"linear", "in", "out", "inOut", "sine"}
	MotionLoops   = []string{"once", "loop", "pingpong"}
)

// Motion moves a stack light, an attachment or a photo or video layer on the server clock.
type Motion struct {
	On     bool   `json:"on"`
	Preset string `json:"preset"`
	From   Pt     `json:"from"`
	Via    *Pt    `json:"via"`
	To     Pt     `json:"to"`
	// Duration of one pass in seconds.
	Duration   float64 `json:"duration"`
	Easing     string  `json:"easing"`
	Loop       string  `json:"loop"`
	Rotate     float64 `json:"rotate"`
	ScaleFrom  float64 `json:"scaleFrom"`
	ScaleTo    float64 `json:"scaleTo"`
	KelvinFrom float64 `json:"kelvinFrom"`
	KelvinTo   float64 `json:"kelvinTo"`
	Phase      float64 `json:"phase"`
	// StartedAt is server Unix ms.
	StartedAt float64 `json:"startedAt"`
}

// DefaultMotion is what absent motion fields decode to: on, a 60 s linear loop, scale 1 → 1.
func DefaultMotion() Motion {
	return Motion{On: true, Duration: 60, Easing: "linear", Loop: "loop", ScaleFrom: 1, ScaleTo: 1}
}

// UnmarshalJSON fills absent fields with the defaults.
func (m *Motion) UnmarshalJSON(b []byte) error {
	type plain Motion
	p := plain(DefaultMotion())
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*m = Motion(p)
	return nil
}

// Scene kinds (protocol §15): what a scene is for; each puts one mode on air.
const (
	KindStatic  = "static"
	KindLive    = "live"
	KindColor   = "color"
	KindScenery = "scenery"
	KindMapping = "mapping"
)

// Kinds are every scene kind.
var Kinds = map[string]bool{KindStatic: true, KindLive: true, KindColor: true, KindScenery: true, KindMapping: true}

// KindMode is the mode a kind puts on air: the kind itself, objects for mapping.
func KindMode(kind string) string {
	if kind == KindMapping {
		return ModeObjects
	}
	if IsBackdropMode(kind) {
		return kind
	}
	return ModeStatic
}

// InferKind is the kind of a scene that has none: mapping when it has objects, else its mode (objects → mapping).
func InferKind(s *Scene) string {
	if len(s.Objects) > 0 || s.Mode == ModeObjects {
		return KindMapping
	}
	if IsBackdropMode(s.Mode) {
		return s.Mode
	}
	return KindStatic
}

const base36 = "0123456789abcdefghijklmnopqrstuvwxyz"

// NewID is prefix_<8 base36>, the shape clients use for ids inside the scene (att_k3j9x0aa).
func NewID(prefix string) string {
	b := make([]byte, 8)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(36))
		b[i] = base36[n.Int64()]
	}
	return prefix + "_" + string(b)
}
