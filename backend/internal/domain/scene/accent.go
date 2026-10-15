package scene

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// ObjectAccent draws the mapped objects over a backdrop mode (protocol §19): each object's outer silhouette (the
// union of its faces, no inner edges, no details) as a crisp line with a glow, and an optional fill. One setting per
// scene, used in every backdrop mode (static, live, color, scenery), never in objects mode. Absent = off.
type ObjectAccent struct {
	On      bool          `json:"on"`
	Objects AccentObjects `json:"objects"`
	Outline AccentOutline `json:"outline"`
	Fill    AccentFill    `json:"fill"`
}

// AccentOutline is the silhouette line: width in scene px (0…64), #rrggbb colour, glow 0…1.
type AccentOutline struct {
	On    bool    `json:"on"`
	Width float64 `json:"width"`
	Color string  `json:"color"`
	Glow  float64 `json:"glow"`
}

// AccentFill fills the silhouette: light (a soft light added inside), cut (the backdrop blocked inside) or only (the
// backdrop shown only inside), at opacity 0…1.
type AccentFill struct {
	On      bool    `json:"on"`
	Opacity float64 `json:"opacity"`
	Mode    string  `json:"mode"`
}

// AccentFillModes are the fill modes.
var AccentFillModes = map[string]bool{"light": true, "cut": true, "only": true}

// AccentObjects is "all" or a list of object ids.
type AccentObjects struct {
	All bool
	IDs []string
}

func (a AccentObjects) MarshalJSON() ([]byte, error) {
	if a.All {
		return []byte(`"all"`), nil
	}
	ids := a.IDs
	if ids == nil {
		ids = []string{}
	}
	return json.Marshal(ids)
}

func (a *AccentObjects) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		if s != "all" {
			return fmt.Errorf(`objectAccent.objects is "all" or a list of object ids, not %q`, s)
		}
		*a = AccentObjects{All: true}
		return nil
	}
	var ids []string
	if err := json.Unmarshal(b, &ids); err != nil {
		return fmt.Errorf(`objectAccent.objects is "all" or a list of object ids`)
	}
	*a = AccentObjects{IDs: ids}
	return nil
}

// DefaultObjectAccent is off, every object, a 3 px white line with a little glow, the fill off (cut at 50 %).
func DefaultObjectAccent() ObjectAccent {
	return ObjectAccent{Objects: AccentObjects{All: true}, Outline: AccentOutline{On: true, Width: 3, Color: "#ffffff", Glow: 0.3},
		Fill: AccentFill{Opacity: 0.5, Mode: "cut"}}
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// objectAccent checks the ranges. Ids of objects that no longer exist are allowed (deleting an object never fails
// on the accent); they draw nothing.
func (c *checker) objectAccent(a *ObjectAccent) {
	if a == nil {
		return
	}
	if !a.Objects.All && len(a.Objects.IDs) > 500 {
		c.fail("objectAccent.objects lists more than 500 objects")
	}
	c.rng("objectAccent.outline.width", a.Outline.Width, 0, 64)
	c.rng("objectAccent.outline.glow", a.Outline.Glow, 0, 1)
	if !hexColor.MatchString(a.Outline.Color) {
		c.fail("objectAccent.outline.color %q is not #rrggbb", a.Outline.Color)
	}
	c.rng("objectAccent.fill.opacity", a.Fill.Opacity, 0, 1)
	if !AccentFillModes[a.Fill.Mode] {
		c.fail("objectAccent.fill.mode %q is not one of light, cut, only", a.Fill.Mode)
	}
}
