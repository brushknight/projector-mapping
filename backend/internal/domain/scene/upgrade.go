package scene

import (
	"encoding/json"
	"fmt"
)

// Upgrade brings a stored scene document to the current format and reports whether it changed anything; current
// documents pass through untouched. Two steps:
//
//   - Modes (protocol §1, "Upgrade of older documents"): see upgradeModes.
//   - The light model (protocol §15, "Upgrade"): see UpgradeStack; a scene without kind gets the inferred one.
func Upgrade(doc []byte) ([]byte, bool, error) {
	s, changed, err := decode(doc)
	if err != nil {
		return nil, false, err
	}
	if !changed {
		return doc, false, nil
	}
	return s.Encode(), true, nil
}

// decode parses a document, upgrading it, and reports whether it was upgraded.
func decode(doc []byte) (*Scene, bool, error) {
	doc, changed, err := upgradeModes(doc)
	if err != nil {
		return nil, false, err
	}
	var s Scene
	if err := json.Unmarshal(doc, &s); err != nil {
		return nil, false, err
	}
	if UpgradeStack(ModeStatic, &s.Backdrop.Static) {
		changed = true
	}
	if UpgradeStack(ModeLive, &s.Backdrop.Live) {
		changed = true
	}
	if s.Kind == "" {
		s.Kind = InferKind(&s)
		changed = true
	}
	s.Normalize()
	return &s, changed, nil
}

// UpgradeStack moves a static or live stack from before the light model (no attachments) to it: every gobo layer
// becomes an attachment (same id, gobo = its ref, rotation = its light angle, offsets and scale from its light,
// opacity and visibility from the layer, the same params) and the stack light takes the first gobo's light
// (intensity, colour, fx, focus = 1 − softness). static keeps no layers and gets the default light when it had no
// gobo; live keeps its other layers and has no light when it had no gobo. It reports whether it changed the stack;
// a stack that has attachments (even none) is current.
func UpgradeStack(mode string, st *LayerStack) bool {
	if (mode != ModeStatic && mode != ModeLive) || st.Attachments != nil {
		return false
	}
	st.Attachments = []Attachment{}
	keep := []Layer{}
	var first *Light
	for _, l := range st.Layers {
		if l.Kind != "gobo" {
			keep = append(keep, l)
			continue
		}
		if first == nil && l.Light != nil {
			first = l.Light
		}
		st.Attachments = append(st.Attachments, attachmentOf(l))
	}
	if first != nil && st.Light == nil {
		lt := DefaultStackLight()
		lt.Intensity, lt.Color, lt.FX = clamp(first.Intensity, 0, 1), first.Color, first.FX
		lt.Focus = clamp(1-first.Softness, 0, 1)
		if lt.Color.Mode == "" {
			lt.Color = DefaultStackLight().Color
		}
		if lt.FX.Kind == "" {
			lt.FX = DefaultStackLight().FX
		}
		st.Light = &lt
	}
	if mode == ModeStatic {
		st.Layers = []Layer{}
		if st.Light == nil {
			lt := DefaultStackLight()
			st.Light = &lt
		}
	} else {
		st.Layers = keep
	}
	return true
}

// attachmentOf turns a gobo layer into an attachment.
func attachmentOf(l Layer) Attachment {
	a := Attachment{ID: l.ID, Gobo: l.Ref, Name: l.Name, Visible: l.Visible, Opacity: clamp(l.Opacity, 0, 1), Scale: 1, Params: map[string]any{}}
	for k, v := range l.Params {
		a.Params[k] = v
	}
	if lt := l.Light; lt != nil {
		a.Rotation = clamp(lt.Angle, -360, 360)
		a.OffsetX, a.OffsetY = clamp(lt.OffsetX, -2, 2), clamp(lt.OffsetY, -2, 2)
		if lt.Scale > 0 {
			a.Scale = clamp(lt.Scale, 0.05, 10)
		}
	}
	return a
}

func clamp(v, lo, hi float64) float64 {
	if v != v {
		return lo
	}
	return max(lo, min(hi, v))
}

// upgradeModes converts a scene document from before modes (protocol v1: `backdrop: { layers: [...] }`, no `mode`) to
// per-mode stacks. Gobo layers go to static, gradient and solid layers to color, photo layers to scenery and
// procedural layers to live, with copies of the gobo layers under them (ids suffixed _live) so a multiply layer
// such as tree sway still has light to darken. The mode becomes live when there were procedural layers, else the
// first non-empty of static, color, scenery, else static. It reports whether it changed anything; current documents
// pass through untouched.
func upgradeModes(doc []byte) ([]byte, bool, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(doc, &top); err != nil {
		return nil, false, err
	}
	raw, ok := top["backdrop"]
	if !ok {
		return doc, false, nil
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return doc, false, nil
	}
	legacy, isLegacy := probe["layers"]
	if !isLegacy {
		return doc, false, nil
	}
	var layers []Layer
	if len(legacy) > 0 && string(legacy) != "null" {
		if err := json.Unmarshal(legacy, &layers); err != nil {
			return nil, false, fmt.Errorf("upgrade backdrop: %w", err)
		}
	}
	b := Backdrop{Static: LayerStack{Layers: []Layer{}}, Live: LayerStack{Layers: []Layer{}}, Color: LayerStack{Layers: []Layer{}},
		Scenery: LayerStack{Layers: []Layer{}}}
	var gobos, procedural []Layer
	for _, l := range layers {
		switch l.Kind {
		case "gobo":
			b.Static.Layers = append(b.Static.Layers, l)
			gobos = append(gobos, l)
		case "procedural":
			procedural = append(procedural, l)
		case "gradient", "solid":
			b.Color.Layers = append(b.Color.Layers, l)
		case "photo":
			b.Scenery.Layers = append(b.Scenery.Layers, l)
		default:
			b.Static.Layers = append(b.Static.Layers, l)
		}
	}
	if len(procedural) > 0 {
		for _, g := range gobos {
			c := g
			c.ID = g.ID + "_live"
			if g.Light != nil {
				lt := *g.Light
				c.Light = &lt
			}
			c.Params = map[string]any{}
			for k, v := range g.Params {
				c.Params[k] = v
			}
			b.Live.Layers = append(b.Live.Layers, c)
		}
		b.Live.Layers = append(b.Live.Layers, procedural...)
	}
	mode := ModeStatic
	switch {
	case len(procedural) > 0:
		mode = ModeLive
	case len(b.Static.Layers) > 0:
		mode = ModeStatic
	case len(b.Color.Layers) > 0:
		mode = ModeColor
	case len(b.Scenery.Layers) > 0:
		mode = ModeScenery
	}
	// plain stacks: the light model upgrade (UpgradeStack) runs next and turns the gobo layers into attachments
	nb, err := json.Marshal(map[string]plainStack{ModeStatic: {b.Static.Layers}, ModeLive: {b.Live.Layers},
		ModeColor: {b.Color.Layers}, ModeScenery: {b.Scenery.Layers}})
	if err != nil {
		return nil, false, err
	}
	top["backdrop"] = nb
	if _, has := top["mode"]; !has {
		top["mode"], _ = json.Marshal(mode)
	}
	if _, has := top["underlay"]; !has {
		top["underlay"], _ = json.Marshal(DefaultUnderlay())
	}
	out, err := json.Marshal(top)
	if err != nil {
		return nil, false, err
	}
	return out, true, nil
}
