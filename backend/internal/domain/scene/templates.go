package scene

import (
	"encoding/json"
	"fmt"

	"projmap/internal/domain/catalog"
)

// NewAttachment is an attachment of a catalog gobo as a fresh pick makes it: the gobo's scale and rotation, every
// param at its catalog default (params override them), visible, blocking all light, no motion.
func NewAttachment(cat *catalog.Catalog, gobo string, params map[string]any) (Attachment, error) {
	g := cat.Gobo(gobo)
	if g == nil {
		return Attachment{}, fmt.Errorf("gobo %q is not in the catalog", gobo)
	}
	p := cat.GoboDefaults(gobo)
	for k, v := range params {
		p[k] = v
	}
	return Attachment{ID: NewID("att"), Gobo: g.ID, Name: g.Name, Visible: true, Opacity: 1, Rotation: g.Attachment.Rotation,
		Scale: g.Attachment.Scale, Params: p}, nil
}

// PresetMotion is a catalog motion preset's Motion (nil when the preset does not exist).
func PresetMotion(cat *catalog.Catalog, id string) *Motion {
	mp := cat.MotionPreset(id)
	if mp == nil {
		return nil
	}
	var m Motion
	if json.Unmarshal(mp.Motion, &m) != nil {
		return nil
	}
	m.Preset = mp.ID
	return &m
}

// NewLayer is a backdrop layer of a catalog item with its defaults: params from the item's schema (a gradient's own
// defaults, the photo or video params), a light for procedural and gobo layers.
func NewLayer(cat *catalog.Catalog, kind, ref string) (Layer, error) {
	l := Layer{ID: NewID("lay"), Kind: kind, Ref: ref, Name: ref, Visible: true, Opacity: 1, Blend: "normal", Params: map[string]any{}}
	schema, ok := cat.LayerSchema(kind, ref)
	if kind == LayerVideo {
		if !IsVideoRef(ref) {
			return Layer{}, fmt.Errorf("a video ref is asset:<sha> or youtube:<id>, not %q", ref)
		}
	} else if !ok {
		return Layer{}, fmt.Errorf("%s %q is not in the catalog", kind, ref)
	}
	l.Params = catalog.Defaults(schema)
	var it *catalog.Item
	switch kind {
	case "gradient":
		for k, v := range cat.Gradient(ref) {
			l.Params[k] = v
		}
		it = findItem(cat.Gradients, ref)
	case "procedural":
		it = cat.ProceduralItem(ref)
		l.Light = DefaultLight()
	case "gobo":
		l.Light = DefaultLight()
		if g := cat.Gobo(ref); g != nil {
			l.Name = g.Name
		}
	case "photo":
		it = findItem(cat.Scenery, ref)
	case LayerGenerator:
		it = cat.Generator(ref)
	}
	if it != nil && it.Name != "" {
		l.Name = it.Name
	}
	return l, nil
}

func findItem(items []catalog.Item, id string) *catalog.Item {
	for i := range items {
		if items[i].ID == id {
			return &items[i]
		}
	}
	return nil
}

// FromTemplate builds a new scene from a catalog scene template (protocol §15, Scene kinds):
//
//   - static-window: the static light at 3200 K, intensity 0.85, focus 0.68, one window-4 attachment with the sun-lr
//     motion present but off, parked mid-path (phase 0.5).
//   - live-window-tree: the live light at 3200 K with a window-4 attachment and a tree-sway layer (multiply).
//   - color-ember: one ember gradient layer. scenery-flowers: one flowers photo layer.
//   - mapping-empty: mode objects, no objects.
func FromTemplate(cat *catalog.Catalog, template, id, setupID, name string) (Scene, error) {
	tpl := cat.SceneTemplate(template)
	if tpl == nil {
		return Scene{}, fmt.Errorf("template %q is not in the catalog", template)
	}
	s := New(id, setupID, name)
	s.Kind, s.Mode = tpl.Kind, KindMode(tpl.Kind)
	s.Normalize()
	warm := func() *StackLight {
		l := DefaultStackLight()
		l.Color.Kelvin = 3200
		return &l
	}
	window := func() (Attachment, error) { return NewAttachment(cat, "window-4", nil) }
	switch tpl.ID {
	case "static-window":
		a, err := window()
		if err != nil {
			return Scene{}, err
		}
		if m := PresetMotion(cat, "sun-lr"); m != nil {
			// parked in the middle of its path: at phase 0 the window would sit at from, off the frame
			m.On, m.Phase = false, 0.5
			a.Motion = m
		}
		l := warm()
		l.Intensity, l.Focus = 0.85, 0.68
		s.Backdrop.Static.Light, s.Backdrop.Static.Attachments = l, []Attachment{a}
	case "live-window-tree":
		a, err := window()
		if err != nil {
			return Scene{}, err
		}
		tree, err := NewLayer(cat, "procedural", "tree-sway")
		if err != nil {
			return Scene{}, err
		}
		tree.Blend, tree.Opacity = "multiply", 0.88
		l := warm()
		if g := cat.Gobo("window-4"); g != nil && g.Focus > 0 {
			l.Focus = g.Focus
		}
		s.Backdrop.Live = LayerStack{Layers: []Layer{tree}, Light: l, Attachments: []Attachment{a}}
	case "color-ember":
		l, err := NewLayer(cat, "gradient", "ember")
		if err != nil {
			return Scene{}, err
		}
		s.Backdrop.Color.Layers = []Layer{l}
	case "scenery-flowers":
		l, err := NewLayer(cat, "photo", "flowers")
		if err != nil {
			return Scene{}, err
		}
		s.Backdrop.Scenery.Layers = []Layer{l}
	case "mapping-empty":
	default:
		return Scene{}, fmt.Errorf("template %q has no recipe on this server", template)
	}
	s.Normalize()
	return s, nil
}
