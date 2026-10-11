// Package setup holds a projector rig: its output framebuffer, orientation, flips, master and blackout fade, and the
// transform between scene pixels and physical framebuffer pixels.
package setup

import (
	"fmt"
	"math"
)

// Orientation of the authored frame on the physical framebuffer.
type Orientation string

const (
	Landscape   Orientation = "landscape"
	PortraitCW  Orientation = "portrait-cw"
	PortraitCCW Orientation = "portrait-ccw"
)

func (o Orientation) IsValid() bool { return o == Landscape || o == PortraitCW || o == PortraitCCW }

// TestPatterns the output can draw on top of everything.
var TestPatterns = []string{"off", "grid", "white", "crosshair", "corners"}

// Test patterns turn themselves off after TestPatternDefault unless renewed; a request may ask for 1 s up to
// TestPatternMax.
const (
	TestPatternDefault = 60
	TestPatternMax     = 600
)

// Output is the physical framebuffer and how the scene sits on it.
type Output struct {
	Width       int         `json:"width"`
	Height      int         `json:"height"`
	Orientation Orientation `json:"orientation"`
	FlipH       bool        `json:"flipH"`
	FlipV       bool        `json:"flipV"`
}

// Setup is a projector rig.
type Setup struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Output         Output  `json:"output"`
	Master         float64 `json:"master"`
	BlackoutFadeMs int     `json:"blackoutFadeMs"`
	TestPattern    string  `json:"testPattern"`
	// TestPatternUntil is the server Unix ns when the test pattern goes back to off (nil while off).
	TestPatternUntil *int64  `json:"testPatternUntil"`
	ReferenceAsset   *string `json:"referenceAsset"`
	CalibrationID    *string `json:"calibrationId"`
}

// Default is a new 1920x1080 landscape rig.
func Default(id, name string) Setup {
	return Setup{ID: id, Name: name, Output: Output{Width: 1920, Height: 1080, Orientation: Landscape}, Master: 1,
		BlackoutFadeMs: 500, TestPattern: "off"}
}

// Validate checks the rig's values.
func (s *Setup) Validate() error {
	switch {
	case s.ID == "":
		return fmt.Errorf("setup needs an id")
	case s.Output.Width < 16 || s.Output.Width > 16384 || s.Output.Height < 16 || s.Output.Height > 16384:
		return fmt.Errorf("output size %dx%d is out of range", s.Output.Width, s.Output.Height)
	case !s.Output.Orientation.IsValid():
		return fmt.Errorf("orientation %q is not one of landscape, portrait-cw, portrait-ccw", s.Output.Orientation)
	case s.Master < 0 || s.Master > 1:
		return fmt.Errorf("master must be 0..1")
	case s.BlackoutFadeMs < 0 || s.BlackoutFadeMs > 60000:
		return fmt.Errorf("blackoutFadeMs must be 0..60000")
	}
	ok := false
	for _, p := range TestPatterns {
		ok = ok || p == s.TestPattern
	}
	if !ok {
		return fmt.Errorf("testPattern %q is not one of off, grid, white, crosshair, corners", s.TestPattern)
	}
	return nil
}

// SceneSize is the authored frame: width x height, swapped for portrait.
func (o Output) SceneSize() (w, h float64) {
	if o.Orientation == PortraitCW || o.Orientation == PortraitCCW {
		return float64(o.Height), float64(o.Width)
	}
	return float64(o.Width), float64(o.Height)
}

// SceneToPhysical maps a scene pixel to a physical framebuffer pixel: rotate first (portrait-cw turns the authored
// frame 90° clockwise), then flip in physical space.
func (o Output) SceneToPhysical(x, y float64) (float64, float64) {
	sw, sh := o.SceneSize()
	var px, py float64
	switch o.Orientation {
	case PortraitCW:
		px, py = sh-y, x
	case PortraitCCW:
		px, py = y, sw-x
	default:
		px, py = x, y
	}
	if o.FlipH {
		px = float64(o.Width) - px
	}
	if o.FlipV {
		py = float64(o.Height) - py
	}
	return px, py
}

// PhysicalToScene is the inverse of SceneToPhysical.
func (o Output) PhysicalToScene(px, py float64) (float64, float64) {
	if o.FlipH {
		px = float64(o.Width) - px
	}
	if o.FlipV {
		py = float64(o.Height) - py
	}
	sw, sh := o.SceneSize()
	switch o.Orientation {
	case PortraitCW:
		return py, sh - px
	case PortraitCCW:
		return sw - py, px
	}
	return px, py
}

// Round2 rounds a coordinate to 1/100 px for storage.
func Round2(v float64) float64 { return math.Round(v*100) / 100 }
