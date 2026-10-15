package scene

import (
	"fmt"
	"strings"
)

// The morph and shape clip effects (protocol §21): a shape that turns into another over the clip (the converge is
// the case "the light → the object, filled with the light"), and a held shape. Their params are flat: from/to (or
// shape) name a shape, and the placement params (fromCx, fromCy, fromR, fromW, fromH, fromSize; toCx...; cx, cy, r,
// w, h, size for shape) are scene px, absent or 0 (−1 for a centre) meaning "from the object".
const (
	EffectMorph = "morph"
	EffectShape = "shape"
)

// MorphShapeKinds are the shapes a morph end can be; a plate is "plate:<id>".
var MorphShapeKinds = []string{"object", "circle", "frame", "rect"}

// MorphFills are where a morph's fill comes from.
var MorphFills = []string{"color", "light"}

// ValidMorphShape tells whether v names a morph shape: object, circle, frame, rect or plate:<id>.
func ValidMorphShape(v string) bool {
	if strings.HasPrefix(v, "plate:") {
		return len(v) > len("plate:")
	}
	for _, k := range MorphShapeKinds {
		if v == k {
			return true
		}
	}
	return false
}

// checkMorph checks a morph or shape clip: the track targets a surface, an object or everything, and the shape
// names are known (the catalog schema checks the numbers, colours and enums).
func checkMorph(cl Clip, trackKind string) error {
	if trackKind != "surface" && trackKind != "object" && trackKind != "all" {
		return fmt.Errorf("clip %s: a %s clip goes on a surface, object or all track", cl.ID, cl.Effect)
	}
	keys := []string{"from", "to"}
	if cl.Effect == EffectShape {
		keys = []string{"shape"}
	}
	for _, k := range keys {
		v, ok := cl.Params[k]
		if !ok || v == nil {
			continue
		}
		s, isStr := v.(string)
		if !isStr || !ValidMorphShape(s) {
			return fmt.Errorf("clip %s: params.%s must be object, circle, frame, rect or plate:<id>, not %v", cl.ID, k, v)
		}
	}
	return nil
}
