package scene

import (
	"fmt"
	"math"
	"strings"

	"projmap/internal/domain/catalog"
)

// Refs tells validation which catalog and user entries exist.
type Refs interface {
	// LayerSchema returns the param schema of a layer kind+ref and whether the ref exists.
	LayerSchema(kind, ref string) (catalog.Schema, bool)
	// EffectSchema returns an effect's param schema (built-in or stored) and whether it exists.
	EffectSchema(id string) (catalog.Schema, bool)
}

var (
	layerKinds   = set("gobo", "procedural", "gradient", "photo", "solid")
	blends       = set("normal", "multiply", "screen", "add")
	colorModes   = set("cct", "hsi")
	fxKinds      = set("none", "candle", "fire", "lightning", "paparazzi", "tv", "breathe", "strobe", "police")
	surfaceKinds = set("quad", "tri", "poly", "circle", "line", "mask")
	roles        = set("face", "edge", "detail")
	targetKinds  = set("surface", "object", "all")
)

func set(v ...string) map[string]bool {
	m := map[string]bool{}
	for _, s := range v {
		m[s] = true
	}
	return m
}

type checker struct{ errs []string }

func (c *checker) fail(format string, a ...any) { c.errs = append(c.errs, fmt.Sprintf(format, a...)) }

func (c *checker) rng(name string, v, lo, hi float64) {
	if math.IsNaN(v) || v < lo || v > hi {
		c.fail("%s = %v is outside %v..%v", name, v, lo, hi)
	}
}

// ValidationError lists every problem of a document.
type ValidationError struct{ Problems []string }

func (e *ValidationError) Error() string {
	if len(e.Problems) > 4 {
		return strings.Join(e.Problems[:4], "; ") + fmt.Sprintf("; and %d more", len(e.Problems)-4)
	}
	return strings.Join(e.Problems, "; ")
}

// Validate checks the scene's structure: unique ids, referenced points, kinds, catalog refs and numeric ranges.
func (s *Scene) Validate(refs Refs) error {
	c := &checker{}
	ids := map[string]string{}
	uniq := func(kind, id string) {
		if id == "" {
			c.fail("a %s needs an id", kind)
			return
		}
		if prev, ok := ids[kind+":"+id]; ok {
			c.fail("%s id %s is used twice (%s)", kind, id, prev)
		}
		ids[kind+":"+id] = kind
	}
	if s.ID == "" {
		c.fail("the scene needs an id")
	}
	if !Modes[s.Mode] {
		c.fail("mode %q is not one of static, live, color, scenery, objects", s.Mode)
	}
	if !IsBackdropMode(s.Underlay.From) {
		c.fail("underlay.from %q is not one of static, live, color, scenery", s.Underlay.From)
	}
	c.rng("underlay.level", s.Underlay.Level, 0, 1)
	for i, ml := range s.Backdrop.All() {
		l := ml.Layer
		w := fmt.Sprintf("layer %s (%s)", l.ID, ml.Mode)
		uniq("layer", l.ID)
		if !layerKinds[l.Kind] {
			c.fail("%s: kind %q is not one of gobo, procedural, gradient, photo, solid", w, l.Kind)
			continue
		}
		if !blends[l.Blend] {
			c.fail("%s: blend %q is not one of normal, multiply, screen, add", w, l.Blend)
		}
		c.rng(w+" opacity", l.Opacity, 0, 1)
		schema, ok := refs.LayerSchema(l.Kind, l.Ref)
		if !ok {
			c.fail("%s: %s %q is not in the catalog", w, l.Kind, l.Ref)
		}
		if err := catalog.CheckParams(schema, l.Params, w+" params"); err != nil {
			c.fail("%v", err)
		}
		if l.Kind == "solid" {
			if col, ok := l.Params["color"].(string); ok && !catalog.IsColor(col) {
				c.fail("%s: color must be #rrggbb", w)
			}
		}
		if l.Light != nil {
			lt := l.Light
			c.rng(w+" light.intensity", lt.Intensity, 0, 1)
			c.rng(w+" light.softness", lt.Softness, 0, 1)
			c.rng(w+" light.angle", lt.Angle, -360, 360)
			c.rng(w+" light.scale", lt.Scale, 0.05, 10)
			if !colorModes[lt.Color.Mode] {
				c.fail("%s: light.color.mode must be cct or hsi", w)
			}
			c.rng(w+" light.color.kelvin", lt.Color.Kelvin, 1000, 12000)
			c.rng(w+" light.color.tint", lt.Color.Tint, -1, 1)
			c.rng(w+" light.color.hue", lt.Color.Hue, 0, 360)
			c.rng(w+" light.color.sat", lt.Color.Sat, 0, 1)
			if !fxKinds[lt.FX.Kind] {
				c.fail("%s: light.fx.kind %q is unknown", w, lt.FX.Kind)
			}
			c.rng(w+" light.fx.speed", lt.FX.Speed, 0, 1)
		} else if l.Kind == "gobo" || l.Kind == "procedural" {
			c.fail("%s: a %s layer needs light", w, l.Kind)
		}
		_ = i
	}
	points := map[string]bool{}
	for _, p := range s.Points {
		uniq("point", p.ID)
		points[p.ID] = true
		if math.IsNaN(p.X) || math.IsNaN(p.Y) || math.Abs(p.X) > 100000 || math.Abs(p.Y) > 100000 {
			c.fail("point %s has an invalid position", p.ID)
		}
	}
	surfaces := map[string]*Surface{}
	objects := map[string]bool{}
	for oi := range s.Objects {
		o := &s.Objects[oi]
		uniq("object", o.ID)
		objects[o.ID] = true
		for si := range o.Surfaces {
			sf := &o.Surfaces[si]
			uniq("surface", sf.ID)
			surfaces[sf.ID] = sf
		}
	}
	for oi := range s.Objects {
		for si := range s.Objects[oi].Surfaces {
			sf := &s.Objects[oi].Surfaces[si]
			w := "surface " + sf.ID
			if !surfaceKinds[sf.Kind] {
				c.fail("%s: kind %q is not one of quad, tri, poly, circle, line, mask", w, sf.Kind)
			}
			if !roles[sf.Role] {
				c.fail("%s: role %q is not one of face, edge, detail", w, sf.Role)
			}
			n := len(sf.PointIDs)
			switch sf.Kind {
			case "quad":
				if n != 4 {
					c.fail("%s: a quad needs 4 points, has %d", w, n)
				}
			case "tri":
				if n != 3 {
					c.fail("%s: a tri needs 3 points, has %d", w, n)
				}
			case "poly", "mask":
				if n < 3 {
					c.fail("%s: a %s needs at least 3 points", w, sf.Kind)
				}
			case "circle":
				if n != 2 {
					c.fail("%s: a circle needs 2 points (centre, rim)", w)
				}
			case "line":
				if n < 2 {
					c.fail("%s: a line needs at least 2 points", w)
				}
			}
			for _, pid := range sf.PointIDs {
				if !points[pid] {
					c.fail("%s: point %s does not exist", w, pid)
				}
			}
			if sf.ParentID != nil {
				if p, ok := surfaces[*sf.ParentID]; !ok || p == sf {
					c.fail("%s: parent %s does not exist", w, *sf.ParentID)
				}
			}
			if sf.Mesh != nil {
				if sf.Kind != "quad" {
					c.fail("%s: only quads have a mesh", w)
				} else if sf.Mesh.Cols < 1 || sf.Mesh.Rows < 1 || sf.Mesh.Cols > 32 || sf.Mesh.Rows > 32 {
					c.fail("%s: mesh cols and rows must be 1..32", w)
				} else if len(sf.Mesh.Offsets) != 0 && len(sf.Mesh.Offsets) != (sf.Mesh.Cols+1)*(sf.Mesh.Rows+1) {
					c.fail("%s: mesh needs (cols+1)x(rows+1) offsets", w)
				}
			}
			c.rng(w+" opacity", sf.Opacity, 0, 1)
			c.rng(w+" softEdge", sf.SoftEdge, 0, 500)
			for _, e := range sf.Effects {
				uniq("surface effect", e.ID)
				schema, ok := refs.EffectSchema(e.Effect)
				if !ok {
					c.fail("%s: effect %q does not exist", w, e.Effect)
					continue
				}
				if err := catalog.CheckParams(schema, e.Params, w+" effect "+e.ID); err != nil {
					c.fail("%v", err)
				}
			}
		}
	}
	t := &s.Timeline
	c.rng("timeline.duration", t.Duration, 0.1, 24*3600)
	tracks := map[string]bool{}
	for _, tr := range t.Tracks {
		uniq("track", tr.ID)
		tracks[tr.ID] = true
		w := "track " + tr.ID
		if !targetKinds[tr.Target.Kind] {
			c.fail("%s: target kind %q is not one of surface, object, all", w, tr.Target.Kind)
			continue
		}
		switch tr.Target.Kind {
		case "surface":
			if tr.Target.ID == nil || surfaces[*tr.Target.ID] == nil {
				c.fail("%s: target surface does not exist", w)
			}
		case "object":
			if tr.Target.ID == nil || !objects[*tr.Target.ID] {
				c.fail("%s: target object does not exist", w)
			}
		}
	}
	for _, cl := range t.Clips {
		uniq("clip", cl.ID)
		w := "clip " + cl.ID
		if !tracks[cl.TrackID] {
			c.fail("%s: track %s does not exist", w, cl.TrackID)
		}
		if cl.Start < 0 || cl.End <= cl.Start {
			c.fail("%s: needs 0 <= start < end", w)
		}
		if cl.FadeIn < 0 || cl.FadeOut < 0 || cl.FadeIn+cl.FadeOut > cl.End-cl.Start+1e-9 {
			c.fail("%s: fades must fit inside the clip", w)
		}
		schema, ok := refs.EffectSchema(cl.Effect)
		if !ok {
			c.fail("%s: effect %q does not exist", w, cl.Effect)
		} else if err := catalog.CheckParams(schema, cl.Params, w+" params"); err != nil {
			c.fail("%v", err)
		}
	}
	for _, cu := range t.Cues {
		uniq("cue", cu.ID)
		if cu.At < 0 {
			c.fail("cue %s: at must be >= 0", cu.ID)
		}
	}
	if len(c.errs) > 0 {
		return &ValidationError{Problems: c.errs}
	}
	return nil
}
