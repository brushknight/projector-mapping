package scene

import (
	"encoding/json"
	"fmt"
)

// Upgrade converts a scene document from before modes (protocol v1: `backdrop: { layers: [...] }`, no `mode`) to
// per-mode stacks. Gobo layers go to static, gradient and solid layers to color, photo layers to scenery and
// procedural layers to live, with copies of the gobo layers under them (ids suffixed _live) so a multiply layer
// such as tree sway still has light to darken. The mode becomes live when there were procedural layers, else the
// first non-empty of static, color, scenery, else static. It reports whether it changed anything; current documents
// pass through untouched.
func Upgrade(doc []byte) ([]byte, bool, error) {
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
	nb, err := json.Marshal(b)
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
