package scene

import "encoding/json"

// Content layer kinds (protocol §12).
const (
	ContentMedia    = "media"
	ContentGradient = "gradient"
)

// ContentLayer is a picture or a gradient drawn inside a surface (a surface layer) or across an object's unfolded
// faces (an object layer, drawn on the object's atlas).
type ContentLayer struct {
	ID          string  `json:"id"`
	Kind        string  `json:"kind"`
	Name        string  `json:"name"`
	Visible     bool    `json:"visible"`
	Opacity     float64 `json:"opacity"`
	Blend       string  `json:"blend"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Scale       float64 `json:"scale"`
	Rotation    float64 `json:"rotation"`
	Reveal      float64 `json:"reveal"`
	RevealAngle float64 `json:"revealAngle"`
	// media only
	Src   string `json:"src,omitempty"`
	Media string `json:"media,omitempty"`
	Fit   string `json:"fit,omitempty"`
	Crop  *Crop  `json:"crop,omitempty"`
	// gradient only
	Stops  []GradientStop `json:"stops,omitempty"`
	Angle  *float64       `json:"angle,omitempty"`
	Offset *float64       `json:"offset,omitempty"`
	Repeat *bool          `json:"repeat,omitempty"`
}

// Crop is the part of a media source to use, in source fractions.
type Crop struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// GradientStop is one colour stop of a gradient content layer.
type GradientStop struct {
	Color string  `json:"color"`
	Pos   float64 `json:"pos"`
}

// UnmarshalJSON fills the defaults of missing common fields: visible true, opacity 1, blend normal, scale 1,
// reveal 1 (x, y, rotation and revealAngle are 0).
func (l *ContentLayer) UnmarshalJSON(b []byte) error {
	type plain ContentLayer
	p := plain{Visible: true, Opacity: 1, Blend: "normal", Scale: 1, Reveal: 1}
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*l = ContentLayer(p)
	return nil
}

// Atlas is an object's faces unfolded flat, in atlas pixels; object layers are drawn on it.
type Atlas struct {
	Width  float64              `json:"width"`
	Height float64              `json:"height"`
	Faces  map[string]AtlasRect `json:"faces"`
}

// AtlasRect is the axis-aligned rect a face covers in the atlas; Rotation (0, 90, 180, 270, clockwise) turns the
// face's UV inside it.
type AtlasRect struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	Rotation int     `json:"rotation"`
}

// ContentLayers returns every content layer of the scene (object layers, then each surface's) with where it lives.
func (s *Scene) ContentLayers() []*ContentLayer {
	var out []*ContentLayer
	for oi := range s.Objects {
		o := &s.Objects[oi]
		for i := range o.Layers {
			out = append(out, &o.Layers[i])
		}
		for si := range o.Surfaces {
			sf := &o.Surfaces[si]
			for i := range sf.Layers {
				out = append(out, &sf.Layers[i])
			}
		}
	}
	return out
}
