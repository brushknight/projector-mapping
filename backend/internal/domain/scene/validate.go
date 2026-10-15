package scene

import (
	"fmt"
	"math"
	"regexp"
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
	layerKinds   = set("gobo", "procedural", "gradient", "photo", "solid", LayerVideo, LayerGenerator)
	blends       = set("normal", "multiply", "screen", "add")
	colorModes   = set("cct", "hsi")
	fxKinds      = set("none", "candle", "fire", "lightning", "paparazzi", "tv", "breathe", "strobe", "police")
	surfaceKinds = set("quad", "tri", "poly", "circle", "line", "mask")
	roles        = set("face", "edge", "detail")
	targetKinds  = set("surface", "object", "all", "layer", TargetSound)
	padColors    = set(PadColors...)
	padIcons     = set(PadIcons...)
	padKey       = regexp.MustCompile(`^[a-z0-9]$`)
	contentKinds = set(ContentMedia, ContentGradient)
	mediaKinds   = set("image", "video")
	fits         = set("fill", "fit", "stretch")
	atlasTurns   = map[int]bool{0: true, 90: true, 180: true, 270: true}
	// layerClipEffects are the effects of clips on a content layer track; their params are only {from, to}.
	layerClipEffects = set("reveal", "sweep")
	easings          = set(MotionEasings...)
	loops            = set(MotionLoops...)
	colorLayerKinds  = set(ColorLayerGradient, ColorLayerGenerator)
)

// MaxAtlasSize is the largest atlas width or height in atlas pixels.
const MaxAtlasSize = 16384

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
	if !Kinds[s.Kind] {
		c.fail("kind %q is not one of static, live, color, scenery, mapping", s.Kind)
	}
	// (protocol §16) the static stack's layers are its background: colour, gradient, animated colour or an effect,
	// under the attachments; gobos go in attachments
	for _, l := range s.Backdrop.Static.Layers {
		if !StaticLayerKinds[l.Kind] {
			c.fail("layer %s (static): the static stack takes background layers of kind solid, gradient, generator or procedural, not %q: put gobos in backdrop.static.attachments", l.ID, l.Kind)
		}
	}
	// backdrop ids: layers and attachments share one namespace (motion tracks target either)
	backdropIDs := map[string]bool{}
	for _, m := range []string{ModeStatic, ModeLive} {
		st := s.Backdrop.Stack(m)
		if m == ModeStatic && st.Light == nil {
			c.fail("the static stack needs a light")
		}
		if st.Light != nil {
			c.stackLight("backdrop."+m+".light", st.Light, refs)
		}
		for i := range st.Attachments {
			a := &st.Attachments[i]
			uniq("layer", a.ID)
			backdropIDs[a.ID] = true
			c.attachment(fmt.Sprintf("attachment %s (%s)", a.ID, m), a, refs)
		}
	}
	if !IsBackdropMode(s.Underlay.From) {
		c.fail("underlay.from %q is not one of static, live, color, scenery", s.Underlay.From)
	}
	c.rng("underlay.level", s.Underlay.Level, 0, 1)
	for i, ml := range s.Backdrop.All() {
		l := ml.Layer
		w := fmt.Sprintf("layer %s (%s)", l.ID, ml.Mode)
		uniq("layer", l.ID)
		backdropIDs[l.ID] = true
		if !layerKinds[l.Kind] {
			c.fail("%s: kind %q is not one of gobo, procedural, gradient, photo, solid, video, generator", w, l.Kind)
			continue
		}
		if !blends[l.Blend] {
			c.fail("%s: blend %q is not one of normal, multiply, screen, add", w, l.Blend)
		}
		c.rng(w+" opacity", l.Opacity, 0, 1)
		schema, ok := refs.LayerSchema(l.Kind, l.Ref)
		if l.Kind == LayerVideo && !IsVideoRef(l.Ref) {
			c.fail("%s: a video ref must be asset:<sha> or youtube:<11 characters>, not %q", w, l.Ref)
		} else if !ok {
			c.fail("%s: %s %q is not in the catalog", w, l.Kind, l.Ref)
		}
		if err := catalog.CheckParams(schema, l.Params, w+" params"); err != nil {
			c.fail("%v", err)
		}
		if l.Kind == "gradient" {
			c.stops(w, l.Params)
		}
		if l.Motion != nil {
			if l.Kind != "photo" && l.Kind != LayerVideo {
				c.fail("%s: only photo and video layers have a motion", w)
			}
			c.motion(w+" motion", l.Motion)
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
			c.lightColor(w+" light", lt.Color, lt.FX)
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
	contentLayers := map[string]bool{}
	for oi := range s.Objects {
		o := &s.Objects[oi]
		for i := range o.Layers {
			uniq("content layer", o.Layers[i].ID)
			contentLayers[o.Layers[i].ID] = true
			c.contentLayer("object "+o.ID+" layer "+o.Layers[i].ID, &o.Layers[i], refs)
		}
		for si := range o.Surfaces {
			sf := &o.Surfaces[si]
			for i := range sf.Layers {
				uniq("content layer", sf.Layers[i].ID)
				contentLayers[sf.Layers[i].ID] = true
				c.contentLayer("surface "+sf.ID+" layer "+sf.Layers[i].ID, &sf.Layers[i], refs)
			}
		}
		if o.Atlas != nil {
			c.atlas("object "+o.ID+" atlas", o)
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
	c.pads(s.Sounds.Pads)
	t := &s.Timeline
	c.rng("timeline.duration", t.Duration, 0.1, 24*3600)
	tracks := map[string]bool{}
	layerTracks := map[string]bool{}
	motionTracks := map[string]bool{}
	soundTracks := map[string]bool{}
	for _, tr := range t.Tracks {
		uniq("track", tr.ID)
		tracks[tr.ID] = true
		w := "track " + tr.ID
		if !targetKinds[tr.Target.Kind] {
			c.fail("%s: target kind %q is not one of surface, object, all, layer, sound", w, tr.Target.Kind)
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
		case TargetSound:
			soundTracks[tr.ID] = true
			if tr.Target.ID != nil {
				c.fail("%s: a sound track's target id must be null", w)
			}
		case "layer":
			switch {
			case tr.Target.ID == nil:
				c.fail("%s: a layer track needs a target id", w)
			case contentLayers[*tr.Target.ID]:
				layerTracks[tr.ID] = true
			case backdropIDs[*tr.Target.ID] || *tr.Target.ID == LightStatic || *tr.Target.ID == LightLive ||
				strings.HasPrefix(*tr.Target.ID, "att_") || strings.HasPrefix(*tr.Target.ID, "lay_"):
				// a motion track may outlive its attachment or layer (a preset or a pick replaced the stack): it
				// then moves nothing until a target with that id comes back
				motionTracks[tr.ID] = true
			default:
				c.fail("%s: target %s is not a content layer, an attachment, a backdrop layer, %s or %s", w, *tr.Target.ID, LightStatic, LightLive)
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
		if layerTracks[cl.TrackID] {
			c.layerClip(w, cl)
			continue
		}
		if motionTracks[cl.TrackID] {
			c.motionClip(w, cl)
			continue
		}
		if soundTracks[cl.TrackID] {
			c.soundClip(w, cl)
			continue
		}
		if cl.Effect == EffectSound {
			c.fail("%s: effect sound only goes on a sound track", w)
			continue
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
		if cu.Sound != nil {
			if cu.Sound.Sound == "" {
				c.fail("cue %s: sound.sound needs a sound sha", cu.ID)
			}
			c.rng("cue "+cu.ID+" sound.volume", cu.Sound.Volume, 0, 1)
		}
	}
	if len(c.errs) > 0 {
		return &ValidationError{Problems: c.errs}
	}
	return nil
}

// contentLayer checks one surface or object content layer (protocol §12).
func (c *checker) contentLayer(w string, l *ContentLayer, refs Refs) {
	if !contentKinds[l.Kind] {
		c.fail("%s: kind %q is not one of media, gradient", w, l.Kind)
		return
	}
	if !blends[l.Blend] {
		c.fail("%s: blend %q is not one of normal, multiply, screen, add", w, l.Blend)
	}
	c.rng(w+" opacity", l.Opacity, 0, 1)
	c.rng(w+" scale", l.Scale, 0.01, 100)
	c.rng(w+" x", l.X, -10, 10)
	c.rng(w+" y", l.Y, -10, 10)
	c.rng(w+" rotation", l.Rotation, -36000, 36000)
	c.rng(w+" reveal", l.Reveal, 0, 1)
	c.rng(w+" revealAngle", l.RevealAngle, -36000, 36000)
	switch l.Kind {
	case ContentMedia:
		switch {
		case l.Src == "":
			c.fail("%s: a media layer needs src (a scenery id or asset:<sha>)", w)
		case strings.HasPrefix(l.Src, "asset:"):
			if strings.TrimPrefix(l.Src, "asset:") == "" {
				c.fail("%s: src asset: needs a sha", w)
			}
		default:
			if _, ok := refs.LayerSchema("photo", l.Src); !ok {
				c.fail("%s: src %q is not a scenery id or asset:<sha>", w, l.Src)
			}
		}
		if !mediaKinds[l.Media] {
			c.fail("%s: media %q is not one of image, video", w, l.Media)
		}
		if !fits[l.Fit] {
			c.fail("%s: fit %q is not one of fill, fit, stretch", w, l.Fit)
		}
		if cr := l.Crop; cr != nil {
			c.rng(w+" crop.x", cr.X, 0, 1)
			c.rng(w+" crop.y", cr.Y, 0, 1)
			c.rng(w+" crop.w", cr.W, 0, 1)
			c.rng(w+" crop.h", cr.H, 0, 1)
			if cr.W <= 0 || cr.H <= 0 {
				c.fail("%s: crop.w and crop.h must be above 0", w)
			}
		}
	case ContentGradient:
		if len(l.Stops) < 1 || len(l.Stops) > 8 {
			c.fail("%s: a gradient needs 1..8 stops, has %d", w, len(l.Stops))
		}
		for i, st := range l.Stops {
			if !catalog.IsColor(st.Color) {
				c.fail("%s: stop %d color must be #rrggbb", w, i)
			}
			c.rng(fmt.Sprintf("%s stop %d pos", w, i), st.Pos, 0, 1)
		}
		if l.Angle != nil {
			c.rng(w+" angle", *l.Angle, -36000, 36000)
		}
		if l.Offset != nil {
			c.rng(w+" offset", *l.Offset, -10, 10)
		}
	}
}

// atlas checks an object's atlas: its size, and that each rect is a face of the object with a quarter turn.
func (c *checker) atlas(w string, o *Object) {
	a := o.Atlas
	c.rng(w+" width", a.Width, 1, MaxAtlasSize)
	c.rng(w+" height", a.Height, 1, MaxAtlasSize)
	own := map[string]bool{}
	for _, sf := range o.Surfaces {
		own[sf.ID] = true
	}
	for id, r := range a.Faces {
		fw := w + " face " + id
		if !own[id] {
			c.fail("%s: %s is not a surface of the object", fw, id)
		}
		if math.IsNaN(r.X) || math.IsNaN(r.Y) || math.Abs(r.X) > MaxAtlasSize || math.Abs(r.Y) > MaxAtlasSize {
			c.fail("%s: x, y are invalid", fw)
		}
		if math.IsNaN(r.W) || math.IsNaN(r.H) || r.W <= 0 || r.H <= 0 || r.W > MaxAtlasSize || r.H > MaxAtlasSize {
			c.fail("%s: w and h must be above 0", fw)
		}
		if !atlasTurns[r.Rotation] {
			c.fail("%s: rotation %d is not one of 0, 90, 180, 270", fw, r.Rotation)
		}
	}
}

// layerClip checks a clip on a layer track: effect reveal or sweep, params only numeric from and to (0..1 for reveal,
// -10..10 for sweep, the ranges of the values they drive).
func (c *checker) layerClip(w string, cl Clip) {
	if !layerClipEffects[cl.Effect] {
		c.fail("%s: a clip on a layer track needs effect reveal or sweep, not %q", w, cl.Effect)
	}
	for k, v := range cl.Params {
		if k != "from" && k != "to" {
			c.fail("%s: param %q is unknown (a layer clip takes from, to)", w, k)
			continue
		}
		f, ok := v.(float64)
		if !ok {
			c.fail("%s: param %s must be a number", w, k)
			continue
		}
		if cl.Effect == "reveal" {
			c.rng(w+" "+k, f, 0, 1)
		} else {
			c.rng(w+" "+k, f, -10, 10)
		}
	}
}

// pads checks the soundboard: unique ids, names 1..40 characters, volume 0..1, colour and icon from the lists, key
// a-z or 0-9 (or none). A pad may have no sound yet (playing it answers bad_request).
func (c *checker) pads(pads []Pad) {
	ids := map[string]bool{}
	for i, p := range pads {
		w := fmt.Sprintf("pad %d (%s)", i, p.ID)
		if p.ID == "" {
			c.fail("%s needs an id", w)
		} else if ids[p.ID] {
			c.fail("%s: id is used twice", w)
		}
		ids[p.ID] = true
		if n := len([]rune(strings.TrimSpace(p.Name))); n < 1 || n > 40 {
			c.fail("%s: name must be 1..40 characters", w)
		}
		c.rng(w+" volume", p.Volume, 0, 1)
		if !padColors[p.Color] {
			c.fail("%s: color %q is not one of %s", w, p.Color, strings.Join(PadColors, ", "))
		}
		if !padIcons[p.Icon] {
			c.fail("%s: icon %q is not one of %s", w, p.Icon, strings.Join(PadIcons, ", "))
		}
		if p.Key != "" && !padKey.MatchString(p.Key) {
			c.fail("%s: key must be one of a-z or 0-9", w)
		}
	}
}

// soundClip checks a clip on a sound track: effect sound, params sound (a sha), offset >= 0 and volume 0..1.
func (c *checker) soundClip(w string, cl Clip) {
	if cl.Effect != EffectSound {
		c.fail("%s: a clip on a sound track needs effect sound, not %q", w, cl.Effect)
	}
	if s, ok := cl.Params["sound"].(string); !ok || s == "" {
		c.fail("%s: params.sound must be a sound sha", w)
	}
	if v, has := cl.Params["offset"]; has {
		if f, ok := v.(float64); !ok || f < 0 || math.IsNaN(f) {
			c.fail("%s: params.offset must be a number >= 0", w)
		}
	}
	if v, has := cl.Params["volume"]; has {
		if f, ok := v.(float64); !ok {
			c.fail("%s: params.volume must be a number", w)
		} else {
			c.rng(w+" params.volume", f, 0, 1)
		}
	}
}

// LayerVideo is the backdrop layer kind of a video (protocol §14).
const LayerVideo = "video"

// LayerGenerator is the backdrop layer kind of a colour generator (protocol §15).
const LayerGenerator = "generator"

// Track target ids of the stack lights (protocol §15, motion clips).
const (
	LightStatic = "light:static"
	LightLive   = "light:live"
)

// StaticLayerKinds are the layer kinds the static stack takes as its background (protocol §16).
var StaticLayerKinds = map[string]bool{"solid": true, "gradient": true, LayerGenerator: true, "procedural": true}

// stackLight checks a static or live light (protocol §15).
func (c *checker) stackLight(w string, l *StackLight, refs Refs) {
	c.rng(w+".intensity", l.Intensity, 0, 1)
	c.rng(w+".focus", l.Focus, 0, 1)
	c.rng(w+".backgroundFocus", l.BackgroundFocus, 0, 1)
	c.lightColor(w, l.Color, l.FX)
	c.rng(w+".fringe", l.Fringe, 0, 1)
	c.rng(w+".vignette", l.Vignette, 0, 1)
	c.rng(w+".slide.x", l.Slide.X, -1, 1)
	c.rng(w+".slide.y", l.Slide.Y, -1, 1)
	if cl := l.ColorLayer; cl != nil {
		cw := w + ".colorLayer"
		if !colorLayerKinds[cl.Kind] {
			c.fail("%s: kind %q is not one of gradient, generator", cw, cl.Kind)
		} else if schema, ok := refs.LayerSchema(cl.Kind, cl.Ref); !ok {
			c.fail("%s: %s %q is not in the catalog", cw, cl.Kind, cl.Ref)
		} else if err := catalog.CheckParams(schema, cl.Params, cw+".params"); err != nil {
			c.fail("%v", err)
		}
		if cl.Kind == ColorLayerGradient {
			c.stops(cw, cl.Params)
		}
	}
	if l.Motion != nil {
		c.motion(w+".motion", l.Motion)
	}
}

// lightColor checks a colour and an fx.
func (c *checker) lightColor(w string, col Color, fx LightFX) {
	if !colorModes[col.Mode] {
		c.fail("%s: color.mode must be cct or hsi", w)
	}
	c.rng(w+".color.kelvin", col.Kelvin, 1000, 12000)
	c.rng(w+".color.tint", col.Tint, -1, 1)
	c.rng(w+".color.hue", col.Hue, 0, 360)
	c.rng(w+".color.sat", col.Sat, 0, 1)
	if !fxKinds[fx.Kind] {
		c.fail("%s: fx.kind %q is unknown", w, fx.Kind)
	}
	c.rng(w+".fx.speed", fx.Speed, 0, 1)
}

// attachment checks one attachment: a catalog gobo, ranges, params against the gobo's merged schema, its motion.
func (c *checker) attachment(w string, a *Attachment, refs Refs) {
	schema, ok := refs.LayerSchema("gobo", a.Gobo)
	if !ok {
		c.fail("%s: gobo %q is not in the catalog", w, a.Gobo)
	} else if err := catalog.CheckParams(schema, a.Params, w+" params"); err != nil {
		c.fail("%v", err)
	}
	c.rng(w+" opacity", a.Opacity, 0, 1)
	c.rng(w+" rotation", a.Rotation, -360, 360)
	c.rng(w+" offsetX", a.OffsetX, -2, 2)
	c.rng(w+" offsetY", a.OffsetY, -2, 2)
	c.rng(w+" scale", a.Scale, 0.05, 10)
	if a.Motion != nil {
		c.motion(w+" motion", a.Motion)
	}
}

// motion checks a Motion's ranges and enums.
func (c *checker) motion(w string, m *Motion) {
	for _, p := range []struct {
		name string
		pt   *Pt
	}{{"from", &m.From}, {"via", m.Via}, {"to", &m.To}} {
		if p.pt != nil {
			c.rng(w+"."+p.name+".x", p.pt.X, -2, 2)
			c.rng(w+"."+p.name+".y", p.pt.Y, -2, 2)
		}
	}
	c.rng(w+".duration", m.Duration, 1, 86400)
	if !easings[m.Easing] {
		c.fail("%s: easing %q is not one of %s", w, m.Easing, strings.Join(MotionEasings, ", "))
	}
	if !loops[m.Loop] {
		c.fail("%s: loop %q is not one of %s", w, m.Loop, strings.Join(MotionLoops, ", "))
	}
	c.rng(w+".rotate", m.Rotate, -360, 360)
	c.rng(w+".scaleFrom", m.ScaleFrom, 0.1, 10)
	c.rng(w+".scaleTo", m.ScaleTo, 0.1, 10)
	for name, k := range map[string]float64{"kelvinFrom": m.KelvinFrom, "kelvinTo": m.KelvinTo} {
		if k != 0 {
			c.rng(w+"."+name+" (0 or 1000..12000)", k, 1000, 12000)
		}
	}
	c.rng(w+".phase", m.Phase, 0, 2)
	if m.StartedAt < 0 || math.IsNaN(m.StartedAt) {
		c.fail("%s: startedAt must be server Unix ms (>= 0)", w)
	}
	if len(m.Preset) > 64 {
		c.fail("%s: preset is longer than 64 characters", w)
	}
}

// stops checks a gradient's params.stops when present: 1..8 {color: #rrggbb, pos: 0..1}.
func (c *checker) stops(w string, params map[string]any) {
	v, has := params["stops"]
	if !has {
		return
	}
	list, ok := v.([]any)
	if !ok || len(list) < 1 || len(list) > 8 {
		c.fail("%s: params.stops must be 1..8 stops", w)
		return
	}
	for i, raw := range list {
		st, ok := raw.(map[string]any)
		if !ok {
			c.fail("%s: stop %d must be {color, pos}", w, i)
			continue
		}
		if col, _ := st["color"].(string); !catalog.IsColor(col) {
			c.fail("%s: stop %d color must be #rrggbb", w, i)
		}
		if pos, ok := st["pos"].(float64); !ok || pos < 0 || pos > 1 {
			c.fail("%s: stop %d pos must be 0..1", w, i)
		}
	}
}

// motionClip checks a clip on a track that targets an attachment, a backdrop layer or a light: effect motion,
// params only numeric from and to (progress, 0..1).
func (c *checker) motionClip(w string, cl Clip) {
	if cl.Effect != "motion" {
		c.fail("%s: a clip on an attachment, backdrop layer or light track needs effect motion, not %q", w, cl.Effect)
	}
	for k, v := range cl.Params {
		if k != "from" && k != "to" {
			c.fail("%s: param %q is unknown (a motion clip takes from, to)", w, k)
			continue
		}
		f, ok := v.(float64)
		if !ok {
			c.fail("%s: param %s must be a number", w, k)
			continue
		}
		c.rng(w+" "+k, f, 0, 1)
	}
}

var (
	youtubeIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	shaRe       = regexp.MustCompile(`^[0-9a-f]{6,64}$`)
)

// IsVideoRef tells whether ref is asset:<sha> or youtube:<videoId>.
func IsVideoRef(ref string) bool {
	if id, ok := strings.CutPrefix(ref, "youtube:"); ok {
		return youtubeIDRe.MatchString(id)
	}
	if sha, ok := strings.CutPrefix(ref, "asset:"); ok {
		return shaRe.MatchString(sha)
	}
	return false
}
