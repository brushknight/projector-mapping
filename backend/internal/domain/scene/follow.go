package scene

import (
	"fmt"
	"math"

	"projmap/internal/domain/docpatch"
)

// Detail surfaces follow their face (protocol §1 "Object and Surface"): when a parent's corners move, every point
// owned only by its detail surfaces moves with the parent's transform (a homography for quads, an affine fit
// otherwise), so drive bays, a fan or a CPU stay where they are on the face.

// xform maps a scene point.
type xform func(x, y float64) (float64, float64)

// FollowDetails compares two versions of a scene and returns where the detail points go: for every surface whose
// corners differ between old and next, its detail surfaces' points (only the ones no non-detail surface uses, and
// none that already moved between old and next) are mapped by the parent's transform from old to next corners.
// The result maps point id → new position, with positions rounded to 1/100 px.
func FollowDetails(old, next *Scene) map[string]Point {
	if old == nil || next == nil {
		return nil
	}
	oldPts := make(map[string]Point, len(old.Points))
	for _, p := range old.Points {
		oldPts[p.ID] = p
	}
	nextPts := make(map[string]Point, len(next.Points))
	for _, p := range next.Points {
		nextPts[p.ID] = p
	}
	moved := func(id string) bool {
		a, ok1 := oldPts[id]
		b, ok2 := nextPts[id]
		return ok1 && ok2 && (a.X != b.X || a.Y != b.Y)
	}
	// which surfaces use each point, and whether a non-detail one does
	shared := map[string]bool{}
	children := map[string][]*Surface{}
	for oi := range next.Objects {
		for si := range next.Objects[oi].Surfaces {
			sf := &next.Objects[oi].Surfaces[si]
			isDetail := sf.Role == "detail" && sf.ParentID != nil && *sf.ParentID != ""
			if isDetail {
				children[*sf.ParentID] = append(children[*sf.ParentID], sf)
				continue
			}
			for _, id := range sf.PointIDs {
				shared[id] = true
			}
		}
	}
	if len(children) == 0 {
		return nil
	}
	out := map[string]Point{}
	for oi := range next.Objects {
		for si := range next.Objects[oi].Surfaces {
			parent := &next.Objects[oi].Surfaces[si]
			kids := children[parent.ID]
			if len(kids) == 0 {
				continue
			}
			from := make([]Point, 0, len(parent.PointIDs))
			to := make([]Point, 0, len(parent.PointIDs))
			changed := false
			for _, id := range parent.PointIDs {
				a, ok1 := oldPts[id]
				b, ok2 := nextPts[id]
				if !ok1 || !ok2 {
					from = nil
					break
				}
				from, to = append(from, a), append(to, b)
				changed = changed || moved(id)
			}
			if !changed || len(from) == 0 {
				continue
			}
			f := parentTransform(parent.Kind, from, to)
			if f == nil {
				continue
			}
			for _, k := range kids {
				for _, id := range k.PointIDs {
					if shared[id] || moved(id) {
						continue
					}
					if _, done := out[id]; done {
						continue
					}
					p, ok := oldPts[id]
					if !ok {
						continue
					}
					x, y := f(p.X, p.Y)
					if math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
						continue
					}
					out[id] = Point{ID: id, X: round2(x), Y: round2(y)}
				}
			}
		}
	}
	return out
}

// FollowOps turns FollowDetails into replace ops on next (only points whose position really changes).
func FollowOps(next *Scene, moves map[string]Point) []docpatch.Op {
	if len(moves) == 0 {
		return nil
	}
	var ops []docpatch.Op
	for i, p := range next.Points {
		m, ok := moves[p.ID]
		if !ok || (m.X == p.X && m.Y == p.Y) {
			continue
		}
		ops = append(ops,
			docpatch.Op{Op: "test", Path: fmt.Sprintf("/points/%d/id", i), Value: mustRaw(p.ID)},
			docpatch.Replace(fmt.Sprintf("/points/%d/x", i), m.X),
			docpatch.Replace(fmt.Sprintf("/points/%d/y", i), m.Y))
	}
	return ops
}

func mustRaw(v any) []byte {
	op := docpatch.Replace("", v)
	return op.Value
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// parentTransform is the map from the parent's old corners to its new ones: a homography for a quad, an affine
// least-squares fit for 3 or more points (tri, poly, mask, line), a similarity for a circle (centre, rim) and a
// translation otherwise.
func parentTransform(kind string, from, to []Point) xform {
	n := len(from)
	if kind == "circle" && n == 2 {
		r0 := math.Hypot(from[1].X-from[0].X, from[1].Y-from[0].Y)
		r1 := math.Hypot(to[1].X-to[0].X, to[1].Y-to[0].Y)
		k := 1.0
		if r0 > 1e-9 {
			k = r1 / r0
		}
		return func(x, y float64) (float64, float64) {
			return to[0].X + (x-from[0].X)*k, to[0].Y + (y-from[0].Y)*k
		}
	}
	if n == 4 && kind != "line" {
		if h, ok := quadHomography(from, to); ok {
			return h
		}
	}
	if n >= 3 {
		if a, ok := affineFit(from, to); ok {
			return a
		}
	}
	if n == 0 {
		return nil
	}
	var dx, dy float64
	for i := range from {
		dx += to[i].X - from[i].X
		dy += to[i].Y - from[i].Y
	}
	dx, dy = dx/float64(n), dy/float64(n)
	return func(x, y float64) (float64, float64) { return x + dx, y + dy }
}

type mat3 [9]float64

func (m mat3) mul(o mat3) mat3 {
	var r mat3
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			r[i*3+j] = m[i*3]*o[j] + m[i*3+1]*o[3+j] + m[i*3+2]*o[6+j]
		}
	}
	return r
}

func (m mat3) inverse() (mat3, bool) {
	a, b, c, d, e, f, g, h, i := m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]
	A, B, C := e*i-f*h, -(d*i - f*g), d*h-e*g
	det := a*A + b*B + c*C
	if math.Abs(det) < 1e-12 {
		return mat3{}, false
	}
	inv := mat3{A, -(b*i - c*h), b*f - c*e, B, a*i - c*g, -(a*f - c*d), C, -(a*h - b*g), a*e - b*d}
	for k := range inv {
		inv[k] /= det
	}
	return inv, true
}

// squareToQuad maps the unit square (0,0),(1,0),(1,1),(0,1) onto q (Heckbert).
func squareToQuad(q []Point) (mat3, bool) {
	x0, y0, x1, y1, x2, y2, x3, y3 := q[0].X, q[0].Y, q[1].X, q[1].Y, q[2].X, q[2].Y, q[3].X, q[3].Y
	sx, sy := x0-x1+x2-x3, y0-y1+y2-y3
	if math.Abs(sx) < 1e-12 && math.Abs(sy) < 1e-12 {
		return mat3{x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1}, true
	}
	dx1, dx2, dy1, dy2 := x1-x2, x3-x2, y1-y2, y3-y2
	den := dx1*dy2 - dx2*dy1
	if math.Abs(den) < 1e-12 {
		return mat3{}, false
	}
	g := (sx*dy2 - dx2*sy) / den
	h := (dx1*sy - sx*dy1) / den
	return mat3{x1 - x0 + g*x1, x3 - x0 + h*x3, x0, y1 - y0 + g*y1, y3 - y0 + h*y3, y0, g, h, 1}, true
}

func quadHomography(from, to []Point) (xform, bool) {
	a, ok := squareToQuad(from)
	if !ok {
		return nil, false
	}
	ai, ok := a.inverse()
	if !ok {
		return nil, false
	}
	b, ok := squareToQuad(to)
	if !ok {
		return nil, false
	}
	m := b.mul(ai)
	return func(x, y float64) (float64, float64) {
		w := m[6]*x + m[7]*y + m[8]
		return (m[0]*x + m[1]*y + m[2]) / w, (m[3]*x + m[4]*y + m[5]) / w
	}, true
}

// affineFit is the least-squares affine map taking from onto to.
func affineFit(from, to []Point) (xform, bool) {
	// normal equations for [a b c] with rows (x, y, 1)
	var m mat3
	var rx, ry [3]float64
	for i := range from {
		v := [3]float64{from[i].X, from[i].Y, 1}
		for r := 0; r < 3; r++ {
			for c := 0; c < 3; c++ {
				m[r*3+c] += v[r] * v[c]
			}
			rx[r] += v[r] * to[i].X
			ry[r] += v[r] * to[i].Y
		}
	}
	inv, ok := m.inverse()
	if !ok {
		return nil, false
	}
	solve := func(b [3]float64) [3]float64 {
		return [3]float64{inv[0]*b[0] + inv[1]*b[1] + inv[2]*b[2], inv[3]*b[0] + inv[4]*b[1] + inv[5]*b[2], inv[6]*b[0] + inv[7]*b[1] + inv[8]*b[2]}
	}
	ax, ay := solve(rx), solve(ry)
	return func(x, y float64) (float64, float64) {
		return ax[0]*x + ax[1]*y + ax[2], ay[0]*x + ay[1]*y + ay[2]
	}, true
}
