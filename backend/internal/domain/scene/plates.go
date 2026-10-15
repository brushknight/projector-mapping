package scene

import (
	"fmt"
	"math"
	"sort"
)

// FormatVersion is the scene and preset document format (protocol §16, Migration): 6 since the plate library
// (catalog 6). A stored document without `format` (or below 6) is from before it: the server upgrades it on start.
const FormatVersion = 6

// plateTarget is where a removed attachment goes: a plate id and, for a parametric window, the geometry that keeps
// the old attachment's look (from its own params where it had them).
type plateTarget struct {
	to     string
	params func(old map[string]any) map[string]any
}

func fixed(to string) plateTarget { return plateTarget{to: to} }

// window keeps the old panes: cols and rows from the old params (with the old gobo's defaults) over extra.
func window(to string, cols, rows float64, extra map[string]any) plateTarget {
	return plateTarget{to: to, params: func(old map[string]any) map[string]any {
		p := map[string]any{"cols": clamp(math.Round(numOr(old, "cols", cols)), 1, 12), "rows": clamp(math.Round(numOr(old, "rows", rows)), 1, 16)}
		for k, v := range extra {
			p[k] = v
		}
		return p
	}}
}

// slats keeps the old slat count on a blinds preset.
func slats(to string, n float64, extra map[string]any) plateTarget {
	return plateTarget{to: to, params: func(old map[string]any) map[string]any {
		p := map[string]any{"slats": clamp(math.Round(numOr(old, "slats", n)), 1, 120)}
		for k, v := range extra {
			p[k] = v
		}
		return p
	}}
}

func numOr(m map[string]any, k string, d float64) float64 {
	if v, ok := m[k].(float64); ok && v == v {
		return v
	}
	return d
}

// RemovedGobos maps every attachment the plate library removed (the 33 attachments of catalog 4 and the 23 original
// plates of catalog 5) to the closest remaining plate or window preset (protocol §16, Migration).
var RemovedGobos = map[string]plateTarget{
	// catalog 4 windows: the window presets, keeping their panes
	"window-4": window("plate-grid-window", 2, 2, map[string]any{"sashes": 1.0}),
	"window":   window("plate-grid-window", 2, 3, map[string]any{"sashes": 1.0}),
	"arch":     window("plate-arched-window", 2, 3, nil),
	"gothic":   fixed("plate-palace-window"),
	"porthole": fixed("plate-circle"),
	"french-doors": plateTarget{to: "plate-tall-grid-window", params: func(old map[string]any) map[string]any {
		return map[string]any{"sashes": 2.0, "cols": clamp(math.Round(numOr(old, "cols", 4)/2), 1, 12), "rows": clamp(math.Round(numOr(old, "rows", 5)), 1, 16)}
	}},
	"skylight": window("plate-skewed-window", 3, 3, nil),
	"barn":     window("plate-grid-window", 2, 2, map[string]any{"sashes": 1.0}),
	// blinds: the blinds presets, keeping the slat count
	"blinds-fine":     fixed("plate-fine-horizontal-lines"),
	"blinds":          slats("plate-slat-blinds", 22, nil),
	"blinds-wide":     fixed("plate-louvre"),
	"vertical-blinds": slats("plate-slat-blinds", 14, map[string]any{"vertical": true}),
	"shutters":        slats("plate-blinds", 16, nil),
	// nature
	"leaves-light": fixed("plate-leaf-breakup"),
	"tree":         fixed("plate-tree-with-leaves"),
	"leaves-dense": fixed("plate-foliage-breakup"),
	"palm":         fixed("plate-jungle"),
	"branch":       fixed("plate-bare-branches"),
	"ivy":          fixed("plate-vine-leaves"),
	"bamboo":       fixed("plate-fern-leaves"),
	// patterns
	"dots":      fixed("plate-dots"),
	"lattice":   fixed("plate-window-grid-iii"),
	"moroccan":  fixed("plate-window-grid-iii"),
	"honeycomb": fixed("plate-bubbles"),
	"stripes":   fixed("plate-louvre"),
	"grid":      fixed("plate-tall-grid-window"),
	"stars":     fixed("plate-starfield"),
	"water":     fixed("plate-water-ripples"),
	// spots: the round hole
	"spot":      fixed("plate-circle"),
	"spot-soft": fixed("plate-circle"),
	"oval":      fixed("plate-circle"),
	"shutter":   fixed("plate-circle"),
	"iris":      fixed("plate-circle"),
	// catalog 5 original plates
	"plate-curved-venetian": fixed("plate-blinds"),
	"plate-bamboo-stalks":   fixed("plate-fern-leaves"),
	"plate-palm-silhouette": fixed("plate-jungle"),
	"plate-monstera":        fixed("plate-jungle"),
	"plate-jungle-breakup":  fixed("plate-jungle"),
	"plate-stained-glass":   fixed("plate-diamond-window"),
	"plate-moroccan-arch":   fixed("plate-window-grid-iii"),
	"plate-honeycomb":       fixed("plate-bubbles"),
	"plate-concentric":      fixed("plate-rings"),
	"plate-spiral":          fixed("plate-swirl"),
	"plate-skyline":         fixed("plate-tall-grid-window"),
	"plate-starburst-fine":  fixed("plate-radial"),
	"plate-starburst-bold":  fixed("plate-radial-burst"),
	"plate-deco-fan":        fixed("plate-fan-rays"),
	"plate-diagonal-blinds": fixed("plate-blinds"),
	"plate-portholes":       fixed("plate-dots"),
	"plate-god-rays":        fixed("plate-fan-rays"),
	"plate-wave-lines":      fixed("plate-water-ripples"),
	"plate-triangles":       fixed("plate-breakup"),
	"plate-dapple-fine":     fixed("plate-foliage-breakup"),
	"plate-dapple-bold":     fixed("plate-bubbles"),
	"plate-mesh-fence":      fixed("plate-diamond-window"),
	"plate-curtain-window":  fixed("plate-grid-window"),
}

// RemovedGoboIDs lists RemovedGobos' keys, sorted.
func RemovedGoboIDs() []string {
	out := make([]string, 0, len(RemovedGobos))
	for k := range RemovedGobos {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// PlateFor is the plate a removed gobo maps to ("" when the id was not removed).
func PlateFor(gobo string) string { return RemovedGobos[gobo].to }

// keptParams are the params an attachment keeps across the move to a plate: the wall params and the light field.
var keptParams = map[string]bool{"throw": true, "skew": true, "depth": true, "field": true}

// MigrateGobos moves every attachment of a static or live stack whose gobo the plate library removed to its plate
// (see RemovedGobos): the id, name, placement, opacity and motion stay; params keep throw, skew, depth and field,
// plus the window geometry the old gobo maps to. It returns one note per moved attachment, for the log.
func MigrateGobos(where string, st *LayerStack) []string {
	var notes []string
	for i := range st.Attachments {
		a := &st.Attachments[i]
		t, ok := RemovedGobos[a.Gobo]
		if !ok {
			continue
		}
		params := map[string]any{}
		for k, v := range a.Params {
			if keptParams[k] {
				params[k] = v
			}
		}
		if f, ok := params["field"].(string); ok && f != "round" && f != "fill" && f != "stretch" && f != "tile" {
			delete(params, "field")
		}
		if t.params != nil {
			for k, v := range t.params(a.Params) {
				params[k] = v
			}
		}
		notes = append(notes, fmt.Sprintf("%s attachment %s: %s → %s", where, a.ID, a.Gobo, t.to))
		a.Gobo, a.Params = t.to, params
	}
	return notes
}

// ScaleBrightness multiplies the brightness of every photo and video layer by 1.4, clamped to 1 (protocol §16, Video
// sound and brightness): before format 6 the renderers drew brightness × 1.4, now 1 is the original picture. It
// reports whether it changed anything.
func ScaleBrightness(st *LayerStack) bool {
	changed := false
	for i := range st.Layers {
		l := &st.Layers[i]
		if l.Kind != "photo" && l.Kind != "video" {
			continue
		}
		if b, ok := l.Params["brightness"].(float64); ok {
			l.Params["brightness"] = math.Round(clamp(b*1.4, 0, 1)*1000) / 1000
			changed = true
		}
	}
	return changed
}
