package unfold

import (
	"math"
	"sort"

	"projmap/internal/domain/scene"
)

// Affine maps a surface's uv to atlas px: O + u·U + v·V.
type Affine struct {
	O, U, V Vec
}

// Apply maps uv to atlas px.
func (a Affine) Apply(u, v float64) Vec {
	return Vec{a.O[0] + u*a.U[0] + v*a.V[0], a.O[1] + u*a.U[1] + v*a.V[1]}
}

// Invert maps atlas px back to uv; ok is false when the affine is degenerate.
func (a Affine) Invert(x, y float64) (Vec, bool) {
	det := a.U[0]*a.V[1] - a.U[1]*a.V[0]
	if math.Abs(det) < 1e-9 {
		return Vec{}, false
	}
	dx, dy := x-a.O[0], y-a.O[1]
	return Vec{(dx*a.V[1] - dy*a.V[0]) / det, (a.U[0]*dy - a.U[1]*dx) / det}, true
}

// Width and Height are the lengths of the U and V axes in atlas px.
func (a Affine) Width() float64  { return math.Hypot(a.U[0], a.U[1]) }
func (a Affine) Height() float64 { return math.Hypot(a.V[0], a.V[1]) }

// RectAffine is the face uv → atlas px mapping of an atlas rect (the rotation table in protocol §12).
func RectAffine(r scene.AtlasRect) Affine {
	switch r.Rotation {
	case 90:
		return Affine{O: Vec{r.X + r.W, r.Y}, U: Vec{0, r.H}, V: Vec{-r.W, 0}}
	case 180:
		return Affine{O: Vec{r.X + r.W, r.Y + r.H}, U: Vec{-r.W, 0}, V: Vec{0, -r.H}}
	case 270:
		return Affine{O: Vec{r.X, r.Y + r.H}, U: Vec{0, -r.H}, V: Vec{r.W, 0}}
	}
	return Affine{O: Vec{r.X, r.Y}, U: Vec{r.W, 0}, V: Vec{0, r.H}}
}

var dirs = map[int][2]Vec{0: {{1, 0}, {0, 1}}, 90: {{0, 1}, {-1, 0}}, 180: {{-1, 0}, {0, -1}}, 270: {{0, -1}, {1, 0}}}

// AtlasFaces are the surfaces of an object that take part in the atlas: faces that are not lines or masks.
func AtlasFaces(o *scene.Object) []*scene.Surface {
	var out []*scene.Surface
	for i := range o.Surfaces {
		s := &o.Surfaces[i]
		if s.Role == "face" && s.Kind != "line" && s.Kind != "mask" {
			out = append(out, s)
		}
	}
	return out
}

func overlaps(a, b scene.AtlasRect) bool {
	return math.Min(a.X+a.W, b.X+b.W)-math.Max(a.X, b.X) > 0.5 && math.Min(a.Y+a.H, b.Y+b.H)-math.Max(a.Y, b.Y) > 0.5
}

// AutoAtlas is the deterministic auto layout (protocol §12 Atlas), identical to the renderer's.
func AutoAtlas(sc *scene.Scene, o *scene.Object) scene.Atlas {
	faces := AtlasFaces(o)
	geo := map[string]*Geometry{}
	for _, f := range faces {
		if g := SurfaceGeometry(sc, f); g != nil {
			geo[f.ID] = g
		}
	}
	var quads []*scene.Surface
	for _, f := range faces {
		if f.Kind == "quad" && len(f.PointIDs) == 4 && geo[f.ID] != nil {
			quads = append(quads, f)
		}
	}
	placed := map[string]scene.AtlasRect{}
	var order []string
	down := func(f *scene.Surface) float64 {
		a, b := sc.Point(f.PointIDs[0]), sc.Point(f.PointIDs[3])
		if a == nil || b == nil {
			return 0
		}
		l := math.Hypot(b.X-a.X, b.Y-a.Y)
		if l == 0 {
			l = 1
		}
		return jsRound((b.Y-a.Y)/l*1000) / 1000
	}
	area := func(f *scene.Surface) float64 { return geo[f.ID].Size[0] * geo[f.ID].Size[1] }
	if len(quads) > 0 {
		root := quads[0]
		for _, f := range quads {
			d := down(f) - down(root)
			if d > 0 || (d == 0 && area(f) > area(root)+1e-6) {
				root = f
			}
		}
		s := geo[root.ID].Size
		placed[root.ID] = scene.AtlasRect{W: s[0], H: s[1]}
		order = append(order, root.ID)
		queue := []string{root.ID}
		byID := map[string]*scene.Surface{}
		for _, q := range quads {
			byID[q.ID] = q
		}
		for len(queue) > 0 {
			aid := queue[0]
			queue = queue[1:]
			a := byID[aid]
			aAff := RectAffine(placed[aid])
			for _, b := range quads {
				if _, ok := placed[b.ID]; ok {
					continue
				}
				r, ok := attach(a, aAff, b, geo[b.ID])
				if !ok {
					continue
				}
				clash := false
				for _, p := range placed {
					if overlaps(p, r) {
						clash = true
						break
					}
				}
				if clash {
					continue
				}
				placed[b.ID] = r
				order = append(order, b.ID)
				queue = append(queue, b.ID)
			}
		}
	}
	minX, minY, maxY := math.Inf(1), math.Inf(1), math.Inf(-1)
	for _, r := range placed {
		minX, minY, maxY = math.Min(minX, r.X), math.Min(minY, r.Y), math.Max(maxY, r.Y+r.H)
	}
	if len(placed) == 0 {
		minX, minY, maxY = 0, 0, 0
	}
	rowX := minX
	rowY := 0.0
	if len(placed) > 0 {
		rowY = maxY + 16
	}
	for _, f := range faces {
		if _, ok := placed[f.ID]; ok || geo[f.ID] == nil {
			continue
		}
		s := geo[f.ID].Size
		placed[f.ID] = scene.AtlasRect{X: rowX, Y: rowY, W: s[0], H: s[1]}
		rowX += s[0] + 16
	}
	out := scene.Atlas{Width: 1, Height: 1, Faces: map[string]scene.AtlasRect{}}
	for _, f := range faces {
		r, ok := placed[f.ID]
		if !ok {
			continue
		}
		x0, y0 := jsRound(r.X-minX), jsRound(r.Y-minY)
		x1, y1 := jsRound(r.X+r.W-minX), jsRound(r.Y+r.H-minY)
		out.Faces[f.ID] = scene.AtlasRect{X: x0, Y: y0, W: math.Max(1, x1-x0), H: math.Max(1, y1-y0), Rotation: r.Rotation}
		out.Width, out.Height = math.Max(out.Width, x1), math.Max(out.Height, y1)
	}
	return out
}

// attach places quad b against the edge it shares with the placed quad a.
func attach(a *scene.Surface, aAff Affine, b *scene.Surface, bGeo *Geometry) (scene.AtlasRect, bool) {
	idx := func(ids []string, id string) int {
		for i, x := range ids {
			if x == id {
				return i
			}
		}
		return -1
	}
	for i := 0; i < 4; i++ {
		pa, pb := a.PointIDs[i], a.PointIDs[(i+1)%4]
		ja, jb := idx(b.PointIDs, pa), idx(b.PointIDs, pb)
		if ja < 0 || jb < 0 {
			continue
		}
		uvA, uvB := unitSquare[ja], unitSquare[jb]
		du, dv := uvB[0]-uvA[0], uvB[1]-uvA[1]
		if math.Abs(du)+math.Abs(dv) != 1 {
			continue
		}
		P := aAff.Apply(unitSquare[i][0], unitSquare[i][1])
		Q := aAff.Apply(unitSquare[(i+1)%4][0], unitSquare[(i+1)%4][1])
		L := dist(P, Q)
		if L < 1e-6 {
			continue
		}
		dir := Vec{jsRound((Q[0] - P[0]) / L), jsRound((Q[1] - P[1]) / L)}
		for _, rot := range []int{0, 90, 180, 270} {
			d := dirs[rot]
			m := Vec{du*d[0][0] + dv*d[1][0], du*d[0][1] + dv*d[1][1]}
			if m != dir {
				continue
			}
			side := bGeo.Size[1]
			if du != 0 {
				side = bGeo.Size[0]
			}
			s := L / side
			wu, hv := bGeo.Size[0]*s, bGeo.Size[1]*s
			U := Vec{d[0][0] * wu, d[0][1] * wu}
			V := Vec{d[1][0] * hv, d[1][1] * hv}
			o := Vec{P[0] - uvA[0]*U[0] - uvA[1]*V[0], P[1] - uvA[0]*U[1] - uvA[1]*V[1]}
			xs := []float64{o[0], o[0] + U[0], o[0] + V[0], o[0] + U[0] + V[0]}
			ys := []float64{o[1], o[1] + U[1], o[1] + V[1], o[1] + U[1] + V[1]}
			x, y := minOf(xs), minOf(ys)
			return scene.AtlasRect{X: x, Y: y, W: maxOf(xs) - x, H: maxOf(ys) - y, Rotation: rot}, true
		}
	}
	return scene.AtlasRect{}, false
}

func minOf(v []float64) float64 {
	m := v[0]
	for _, x := range v[1:] {
		m = math.Min(m, x)
	}
	return m
}

func maxOf(v []float64) float64 {
	m := v[0]
	for _, x := range v[1:] {
		m = math.Max(m, x)
	}
	return m
}

// Resolve is the object's stored atlas, or the auto layout when there is none; stored tells which.
func Resolve(sc *scene.Scene, o *scene.Object) (atlas scene.Atlas, stored bool) {
	if a := o.Atlas; a != nil && a.Width > 0 && a.Height > 0 && a.Faces != nil {
		return *a, true
	}
	return AutoAtlas(sc, o), false
}

// Affines places every surface of the object that has a place in the atlas: faces by their rect, details inside
// their parent face (their uv corners mapped through the parent's uv).
func Affines(sc *scene.Scene, o *scene.Object, atlas scene.Atlas) map[string]Affine {
	out := map[string]Affine{}
	byID := map[string]*scene.Surface{}
	for i := range o.Surfaces {
		byID[o.Surfaces[i].ID] = &o.Surfaces[i]
	}
	ids := make([]string, 0, len(atlas.Faces))
	for id := range atlas.Faces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if byID[id] != nil {
			out[id] = RectAffine(atlas.Faces[id])
		}
	}
	for i := range o.Surfaces {
		s := &o.Surfaces[i]
		if _, ok := out[s.ID]; ok || s.ParentID == nil || s.Kind == "line" || s.Kind == "mask" {
			continue
		}
		parent := byID[*s.ParentID]
		if parent == nil {
			continue
		}
		pa, ok := out[parent.ID]
		if !ok {
			continue
		}
		g, pg := SurfaceGeometry(sc, s), SurfaceGeometry(sc, parent)
		if g == nil || pg == nil {
			continue
		}
		corner := func(u, v float64) Vec {
			p := g.UVToScene(u, v)
			puv := pg.SceneToUV(p[0], p[1])
			return pa.Apply(puv[0], puv[1])
		}
		c0, cu, cv := corner(0, 0), corner(1, 0), corner(0, 1)
		out[s.ID] = Affine{O: c0, U: Vec{cu[0] - c0[0], cu[1] - c0[1]}, V: Vec{cv[0] - c0[0], cv[1] - c0[1]}}
	}
	return out
}

// InParent maps a detail's uv to its parent's uv (through the scene, like Affines), or false.
func InParent(sc *scene.Scene, detail, parent *scene.Surface) func(u, v float64) Vec {
	g, pg := SurfaceGeometry(sc, detail), SurfaceGeometry(sc, parent)
	if g == nil || pg == nil {
		return nil
	}
	return func(u, v float64) Vec {
		p := g.UVToScene(u, v)
		return pg.SceneToUV(p[0], p[1])
	}
}
