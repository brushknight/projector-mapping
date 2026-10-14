// Package unfold is the flat side of the mapping, ported from the web renderer (frontend/src/render/atlas.ts and
// math/geometry.ts) so the server answers exactly what the renderer draws: each surface's flat size and UV frame,
// the object's atlas (protocol §12, the deterministic auto layout when none is stored), where details sit in their
// parent's UV, and which face edges touch which. Pure functions over a scene.
package unfold

import (
	"math"

	"projmap/internal/domain/scene"
)

// Vec is a 2D point or vector.
type Vec = [2]float64

// Mat3 is a row-major 3×3 homography mapping (x, y, 1) → (x', y', w').
type Mat3 [9]float64

// jsRound rounds like JavaScript's Math.round (half up), so layouts match the renderer to the pixel.
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

func dist(a, b Vec) float64 { return math.Hypot(a[0]-b[0], a[1]-b[1]) }

// Homography solves the homography mapping src[i] → dst[i] (4 points each); ok is false for a degenerate quad.
func Homography(src, dst [4]Vec) (Mat3, bool) {
	var A [8][9]float64
	for i := 0; i < 4; i++ {
		x, y := src[i][0], src[i][1]
		u, v := dst[i][0], dst[i][1]
		A[2*i] = [9]float64{x, y, 1, 0, 0, 0, -u * x, -u * y, u}
		A[2*i+1] = [9]float64{0, 0, 0, x, y, 1, -v * x, -v * y, v}
	}
	for c := 0; c < 8; c++ {
		piv := c
		for r := c + 1; r < 8; r++ {
			if math.Abs(A[r][c]) > math.Abs(A[piv][c]) {
				piv = r
			}
		}
		if math.Abs(A[piv][c]) < 1e-12 {
			return Mat3{}, false
		}
		A[c], A[piv] = A[piv], A[c]
		for r := 0; r < 8; r++ {
			if r == c {
				continue
			}
			f := A[r][c] / A[c][c]
			if f == 0 {
				continue
			}
			for k := c; k < 9; k++ {
				A[r][k] -= f * A[c][k]
			}
		}
	}
	var h Mat3
	for i := 0; i < 8; i++ {
		h[i] = A[i][8] / A[i][i]
	}
	h[8] = 1
	return h, true
}

// Apply maps a point through a homography.
func (h Mat3) Apply(x, y float64) Vec {
	w := h[6]*x + h[7]*y + h[8]
	return Vec{(h[0]*x + h[1]*y + h[2]) / w, (h[3]*x + h[4]*y + h[5]) / w}
}

// Invert inverts a homography; ok is false when it is singular.
func (m Mat3) Invert() (Mat3, bool) {
	a, b, c, d, e, f, g, h, i := m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]
	A := e*i - f*h
	B := -(d*i - f*g)
	C := d*h - e*g
	det := a*A + b*B + c*C
	if math.Abs(det) < 1e-18 {
		return Mat3{}, false
	}
	s := 1 / det
	return Mat3{
		A * s, -(b*i - c*h) * s, (b*f - c*e) * s,
		B * s, (a*i - c*g) * s, -(a*f - c*d) * s,
		C * s, -(a*h - b*g) * s, (a*e - b*d) * s,
	}, true
}

var unitSquare = [4]Vec{{0, 0}, {1, 0}, {1, 1}, {0, 1}}

const circleSegments = 48

// Geometry is a surface's flat frame: its size in scene px, its outline in scene px and in its own UV, and the
// mapping between scene px and UV.
type Geometry struct {
	Kind string
	// Size is the flat size in scene px: quads use the mean length of opposite edges (their real aspect, roughly),
	// tri, poly and mask their bounding box, circles their diameter.
	Size Vec
	// Outline in scene px and in UV (closed for everything but lines).
	Outline   []Vec
	OutlineUV []Vec
	// Corners are the surface's points in scene px, in order.
	Corners []Vec
	// h maps uv → scene px for a plain quad; hInv is its inverse (nil for meshes and non-quads).
	h, hInv *Mat3
	min     Vec
	box     Vec
}

// Aspect is width / height.
func (g *Geometry) Aspect() float64 { return g.Size[0] / math.Max(g.Size[1], 1e-6) }

// SceneToUV maps scene px to the surface's UV (quads: the exact homography; everything else: the bounding box).
func (g *Geometry) SceneToUV(x, y float64) Vec {
	if g.hInv != nil {
		return g.hInv.Apply(x, y)
	}
	return Vec{(x - g.min[0]) / math.Max(1e-6, g.box[0]), (y - g.min[1]) / math.Max(1e-6, g.box[1])}
}

// UVToScene maps UV to scene px: quads by the bilinear of their corners (as the atlas code does), the rest through
// the bounding box.
func (g *Geometry) UVToScene(u, v float64) Vec {
	if g.Kind == "quad" && len(g.Corners) >= 4 {
		a, b, c, d := g.Corners[0], g.Corners[1], g.Corners[2], g.Corners[3]
		return Vec{
			(1-u)*(1-v)*a[0] + u*(1-v)*b[0] + u*v*c[0] + (1-u)*v*d[0],
			(1-u)*(1-v)*a[1] + u*(1-v)*b[1] + u*v*c[1] + (1-u)*v*d[1],
		}
	}
	return Vec{g.min[0] + u*g.box[0], g.min[1] + v*g.box[1]}
}

func bbox(pts []Vec) (Vec, Vec) {
	x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range pts {
		x0, y0 = math.Min(x0, p[0]), math.Min(y0, p[1])
		x1, y1 = math.Max(x1, p[0]), math.Max(y1, p[1])
	}
	return Vec{x0, y0}, Vec{math.Max(1e-3, x1-x0), math.Max(1e-3, y1-y0)}
}

// SurfaceGeometry builds a surface's flat frame from its points, or nil when it has too few points.
func SurfaceGeometry(sc *scene.Scene, sf *scene.Surface) *Geometry {
	var pts []Vec
	for _, p := range sc.SurfacePoints(sf) {
		pts = append(pts, Vec{p.X, p.Y})
	}
	g := &Geometry{Kind: sf.Kind, Corners: pts}
	switch sf.Kind {
	case "quad":
		if len(pts) >= 4 {
			q := [4]Vec{pts[0], pts[1], pts[2], pts[3]}
			g.Size = Vec{math.Max(1, (dist(q[0], q[1])+dist(q[3], q[2]))/2), math.Max(1, (dist(q[0], q[3])+dist(q[1], q[2]))/2)}
			g.Outline = q[:]
			g.OutlineUV = unitSquare[:]
			g.min, g.box = bbox(q[:])
			if sf.Mesh == nil || sf.Mesh.Cols < 1 || sf.Mesh.Rows < 1 {
				if h, ok := Homography(unitSquare, q); ok {
					if inv, ok := h.Invert(); ok {
						g.h, g.hInv = &h, &inv
					}
				}
			}
			return g
		}
		if len(pts) == 3 {
			return poly(g, pts)
		}
	case "tri", "poly", "mask":
		if len(pts) >= 3 {
			return poly(g, pts)
		}
	case "circle":
		if len(pts) >= 2 {
			c, rim := pts[0], pts[1]
			r := math.Max(0.5, dist(c, rim))
			a0 := math.Atan2(rim[1]-c[1], rim[0]-c[0])
			for i := 0; i < circleSegments; i++ {
				a := a0 + float64(i)/circleSegments*math.Pi*2
				p := Vec{c[0] + math.Cos(a)*r, c[1] + math.Sin(a)*r}
				g.Outline = append(g.Outline, p)
				g.OutlineUV = append(g.OutlineUV, Vec{(p[0] - (c[0] - r)) / (2 * r), (p[1] - (c[1] - r)) / (2 * r)})
			}
			g.Size = Vec{2 * r, 2 * r}
			g.min, g.box = Vec{c[0] - r, c[1] - r}, Vec{2 * r, 2 * r}
			return g
		}
	case "line":
		if len(pts) >= 2 {
			total := 0.0
			for i := 1; i < len(pts); i++ {
				total += dist(pts[i-1], pts[i])
			}
			g.Size = Vec{math.Max(1e-3, total), 16}
			g.Outline = pts
			g.min, g.box = bbox(pts)
			return g
		}
	}
	return nil
}

func poly(g *Geometry, pts []Vec) *Geometry {
	g.min, g.box = bbox(pts)
	g.Size = g.box
	g.Outline = pts
	for _, p := range pts {
		g.OutlineUV = append(g.OutlineUV, Vec{(p[0] - g.min[0]) / g.box[0], (p[1] - g.min[1]) / g.box[1]})
	}
	return g
}
