// Package catalog is the built-in catalog (gobos, procedural layers, gradients, scenery, effects) and the Effect entity
// that user and agent effects share with the built-ins.
package catalog

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// Param is one entry of a param schema: {type, min?, max?, step?, default, label?, unit?, options?}.
type Param struct {
	Type    string   `json:"type"`
	Min     *float64 `json:"min,omitempty"`
	Max     *float64 `json:"max,omitempty"`
	Step    *float64 `json:"step,omitempty"`
	Default any      `json:"default,omitempty"`
	Label   string   `json:"label,omitempty"`
	Unit    string   `json:"unit,omitempty"`
	Options []string `json:"options,omitempty"`
}

// Schema is a param schema keyed by param name.
type Schema map[string]Param

// Item is any catalog entry; kind-specific fields stay in Raw.
type Item struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Params Schema          `json:"params,omitempty"`
	Asset  string          `json:"asset,omitempty"`
	Raw    json.RawMessage `json:"-"`
}

// Effect is a catalog or user/agent-made effect.
type Effect struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Kind   string          `json:"kind"`   // builtin | glsl | js
	Origin string          `json:"origin"` // builtin | user | agent:codex | agent:claude
	Params json.RawMessage `json:"params"`
	Source *string         `json:"source"`
	Group  string          `json:"group,omitempty"`
}

var effectKinds = map[string]bool{"builtin": true, "glsl": true, "js": true}

// ValidateEffect checks a user or agent effect before it is stored.
func ValidateEffect(e *Effect) error {
	switch {
	case e.Name == "":
		return fmt.Errorf("an effect needs a name")
	case !effectKinds[e.Kind] || e.Kind == "builtin":
		return fmt.Errorf("kind must be glsl or js")
	case e.Source == nil || *e.Source == "":
		return fmt.Errorf("an effect needs source")
	case len(*e.Source) > 256*1024:
		return fmt.Errorf("source is larger than 256 KB")
	}
	if len(e.Params) == 0 || string(e.Params) == "null" {
		e.Params = json.RawMessage("{}")
	}
	var s Schema
	if err := json.Unmarshal(e.Params, &s); err != nil {
		return fmt.Errorf("params must be a param schema object: %v", err)
	}
	for k, p := range s {
		switch p.Type {
		case "number", "integer", "boolean", "color", "enum", "string", "strokes":
		default:
			return fmt.Errorf("param %s has unknown type %q", k, p.Type)
		}
	}
	return nil
}

var glslEffectFn = regexp.MustCompile(`vec4\s+effect\s*\(\s*vec2\s+\w+\s*,\s*float\s+\w+\s*,\s*float\s+\w+\s*\)`)
var jsDefault = regexp.MustCompile(`export\s+default`)

// LintSource is a static check of an effect's source (the real compile happens in the renderer). It returns the
// problems found, empty when none.
func LintSource(kind, src string) []string {
	var out []string
	depth := 0
	for _, r := range src {
		switch r {
		case '{':
			depth++
		case '}':
			depth--
		}
		if depth < 0 {
			break
		}
	}
	if depth != 0 {
		out = append(out, "braces do not balance")
	}
	switch kind {
	case "glsl":
		if !glslEffectFn.MatchString(src) {
			out = append(out, "define vec4 effect(vec2 uv, float t, float progress)")
		}
		for _, bad := range []string{"texture(", "texture2D(", "gl_FragColor", "#extension"} {
			if regexp.MustCompile(regexp.QuoteMeta(bad)).MatchString(src) {
				out = append(out, fmt.Sprintf("%s is not allowed (see docs://effect-api)", bad))
			}
		}
	case "js":
		if !jsDefault.MatchString(src) {
			out = append(out, "export a default render(ctx, args) function")
		}
		for _, bad := range []string{"fetch(", "XMLHttpRequest", "importScripts", "setTimeout", "setInterval", "WebSocket"} {
			if regexp.MustCompile(regexp.QuoteMeta(bad)).MatchString(src) {
				out = append(out, fmt.Sprintf("%s is not available in the effect worker", bad))
			}
		}
	}
	return out
}

// Catalog is the parsed contract/catalog.json.
type Catalog struct {
	Version      int      `json:"version"`
	Light        Light    `json:"light"`
	Gobos        []Item   `json:"gobos"`
	Procedural   []Item   `json:"procedural"`
	Gradients    []Item   `json:"gradients"`
	Scenery      []Item   `json:"scenery"`
	Effects      []Effect `json:"effects"`
	GradientPrms Schema   `json:"gradientParams"`
	PhotoParams  Schema   `json:"photoParams"`

	Raw json.RawMessage `json:"-"`
}

// Light is the light block of the catalog.
type Light struct {
	Params Schema   `json:"params"`
	FX     []string `json:"fx"`
}

// Parse reads catalog.json.
func Parse(b []byte) (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	c.Raw = b
	return &c, nil
}

func find(items []Item, id string) *Item {
	for i := range items {
		if items[i].ID == id {
			return &items[i]
		}
	}
	return nil
}

// LayerSchema returns the param schema for a layer kind and ref, and whether the ref exists.
func (c *Catalog) LayerSchema(kind, ref string) (Schema, bool) {
	switch kind {
	case "gobo":
		return nil, find(c.Gobos, ref) != nil
	case "procedural":
		if it := find(c.Procedural, ref); it != nil {
			return it.Params, true
		}
	case "gradient":
		return c.GradientPrms, find(c.Gradients, ref) != nil
	case "photo":
		if len(ref) > 6 && ref[:6] == "asset:" {
			return c.PhotoParams, true
		}
		return c.PhotoParams, find(c.Scenery, ref) != nil
	case "solid":
		return nil, true
	}
	return nil, false
}

// Effect returns a built-in effect by id.
func (c *Catalog) Effect(id string) *Effect {
	for i := range c.Effects {
		if c.Effects[i].ID == id {
			return &c.Effects[i]
		}
	}
	return nil
}

// HasScenery tells whether a scenery id exists.
func (c *Catalog) HasScenery(id string) bool { return find(c.Scenery, id) != nil }

// Gradient returns a gradient's default params.
func (c *Catalog) Gradient(id string) map[string]any {
	it := find(c.Gradients, id)
	if it == nil {
		return nil
	}
	var g struct {
		Defaults map[string]any `json:"defaults"`
	}
	_ = json.Unmarshal(it.Raw, &g)
	return g.Defaults
}

// UnmarshalJSON keeps each item's raw JSON.
func (i *Item) UnmarshalJSON(b []byte) error {
	type plain Item
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*i = Item(p)
	i.Raw = append(json.RawMessage(nil), b...)
	return nil
}

// CheckParams validates values against a schema: numbers in range, enums in options, colors as #rrggbb. Unknown keys
// pass (renderers ignore them).
func CheckParams(s Schema, values map[string]any, where string) error {
	for k, v := range values {
		p, ok := s[k]
		if !ok {
			continue
		}
		switch p.Type {
		case "number", "integer":
			f, ok := v.(float64)
			if !ok {
				return fmt.Errorf("%s.%s must be a number", where, k)
			}
			if p.Type == "integer" && f != float64(int64(f)) {
				return fmt.Errorf("%s.%s must be an integer", where, k)
			}
			if p.Min != nil && f < *p.Min || p.Max != nil && f > *p.Max {
				return fmt.Errorf("%s.%s = %v is outside %v..%v", where, k, f, deref(p.Min), deref(p.Max))
			}
		case "boolean":
			if _, ok := v.(bool); !ok {
				return fmt.Errorf("%s.%s must be true or false", where, k)
			}
		case "color":
			s, ok := v.(string)
			if !ok || !IsColor(s) {
				return fmt.Errorf("%s.%s must be a #rrggbb color", where, k)
			}
		case "enum":
			s, _ := v.(string)
			found := false
			for _, o := range p.Options {
				found = found || o == s
			}
			if !found {
				return fmt.Errorf("%s.%s must be one of %v", where, k, p.Options)
			}
		case "string":
			if _, ok := v.(string); !ok {
				return fmt.Errorf("%s.%s must be a string", where, k)
			}
		case "strokes":
			if err := CheckStrokes(v, where+"."+k); err != nil {
				return err
			}
		}
	}
	return nil
}

// Stroke limits per value (protocol §1, effect drawing).
const (
	MaxStrokes      = 2000
	MaxStrokePoints = 20000
)

var strokeTools = map[string]int{"pen": 2, "line": 2, "rect": 2, "ellipse": 2, "text": 1}

// CheckStrokes validates a drawing's strokes: tool, points in surface UV (a little outside 0..1 is fine), #rrggbb
// colour, width and text size in surface px.
func CheckStrokes(v any, where string) error {
	list, ok := v.([]any)
	if !ok {
		return fmt.Errorf("%s must be an array of strokes", where)
	}
	if len(list) > MaxStrokes {
		return fmt.Errorf("%s has %d strokes; at most %d", where, len(list), MaxStrokes)
	}
	total := 0
	for i, raw := range list {
		w := fmt.Sprintf("%s[%d]", where, i)
		st, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be a stroke object", w)
		}
		tool, _ := st["tool"].(string)
		minPts, known := strokeTools[tool]
		if !known {
			return fmt.Errorf("%s.tool must be pen, line, rect, ellipse or text", w)
		}
		pts, ok := st["points"].([]any)
		if !ok || len(pts) < minPts {
			return fmt.Errorf("%s.points needs at least %d [u, v] points", w, minPts)
		}
		total += len(pts)
		for j, p := range pts {
			uv, ok := p.([]any)
			if !ok || len(uv) != 2 {
				return fmt.Errorf("%s.points[%d] must be [u, v]", w, j)
			}
			for _, c := range uv {
				f, ok := c.(float64)
				if !ok || f < -1 || f > 2 {
					return fmt.Errorf("%s.points[%d] must be numbers in surface UV (-1..2)", w, j)
				}
			}
		}
		if col, ok := st["color"].(string); !ok || !IsColor(col) {
			return fmt.Errorf("%s.color must be a #rrggbb color", w)
		}
		if wd, ok := st["width"].(float64); !ok || wd < 0 || wd > 500 {
			return fmt.Errorf("%s.width must be a number 0..500 (surface px)", w)
		}
		if sz, has := st["size"]; has && sz != nil {
			if f, ok := sz.(float64); !ok || f <= 0 || f > 2000 {
				return fmt.Errorf("%s.size must be a number 1..2000 (surface px)", w)
			}
		}
		if tx, has := st["text"]; has && tx != nil {
			if t, ok := tx.(string); !ok || len(t) > 500 {
				return fmt.Errorf("%s.text must be a string of at most 500 bytes", w)
			}
		}
		if f, has := st["fill"]; has && f != nil {
			if _, ok := f.(bool); !ok {
				return fmt.Errorf("%s.fill must be true or false", w)
			}
		}
	}
	if total > MaxStrokePoints {
		return fmt.Errorf("%s has %d points; at most %d", where, total, MaxStrokePoints)
	}
	return nil
}

func deref(f *float64) any {
	if f == nil {
		return "∞"
	}
	return *f
}

var colorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// IsColor tells whether s is #rrggbb.
func IsColor(s string) bool { return colorRe.MatchString(s) }
