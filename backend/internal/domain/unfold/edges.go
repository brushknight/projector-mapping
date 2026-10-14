package unfold

import (
	"math"

	"projmap/internal/domain/scene"
)

// Sides name a quad's edges by where they lie in its UV square: edge i runs from corner i to corner i+1 (1-based
// corners: 1 top left, 2 top right, 3 bottom right, 4 bottom left of the content).
var Sides = [4]string{"top", "right", "bottom", "left"}

// SideUV is each side's start and end in UV.
var SideUV = [4][2]Vec{{{0, 0}, {1, 0}}, {{1, 0}, {1, 1}}, {{1, 1}, {0, 1}}, {{0, 1}, {0, 0}}}

// Edge is one edge of a face.
type Edge struct {
	Side     string  `json:"side"`
	From     string  `json:"fromPoint"`
	To       string  `json:"toPoint"`
	UVFrom   Vec     `json:"uvFrom"`
	UVTo     Vec     `json:"uvTo"`
	LengthPx float64 `json:"lengthPx"`
	// AtlasSide is the side of the face's atlas rect the edge lies on (it differs from Side when the face is turned).
	AtlasSide string `json:"atlasSide,omitempty"`
	// Neighbour is the face that shares both points of this edge, if any.
	Neighbour *Neighbour `json:"neighbour"`
}

// Neighbour is the face across an edge.
type Neighbour struct {
	SurfaceID string `json:"surfaceId"`
	Name      string `json:"name"`
	ObjectID  string `json:"objectId"`
	// Side is the neighbour's own side along the shared edge (empty for non-quads).
	Side string `json:"side,omitempty"`
	// Joined tells whether the two faces touch along this edge in the atlas, so content runs across it there.
	Joined bool `json:"joinedInAtlas"`
}

// QuadSide returns which side of a quad runs between two point ids (either direction), or -1.
func QuadSide(ids []string, a, b string) int {
	if len(ids) != 4 {
		return -1
	}
	for i := 0; i < 4; i++ {
		p, q := ids[i], ids[(i+1)%4]
		if (p == a && q == b) || (p == b && q == a) {
			return i
		}
	}
	return -1
}

// rectSide names the side of an atlas rect that the segment p→q lies on.
func rectSide(r scene.AtlasRect, p, q Vec) string {
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.75 }
	switch {
	case near(p[1], r.Y) && near(q[1], r.Y):
		return "top"
	case near(p[0], r.X+r.W) && near(q[0], r.X+r.W):
		return "right"
	case near(p[1], r.Y+r.H) && near(q[1], r.Y+r.H):
		return "bottom"
	case near(p[0], r.X) && near(q[0], r.X):
		return "left"
	}
	return ""
}

// Edges describes a quad face's four edges: their points, length, side in the atlas and the face across each.
// Non-quads get nil.
func Edges(sc *scene.Scene, o *scene.Object, f *scene.Surface, atlas scene.Atlas, affs map[string]Affine) []Edge {
	if f.Kind != "quad" || len(f.PointIDs) != 4 {
		return nil
	}
	var out []Edge
	aff, placed := affs[f.ID]
	rect, inAtlas := atlas.Faces[f.ID]
	for i := 0; i < 4; i++ {
		a, b := f.PointIDs[i], f.PointIDs[(i+1)%4]
		e := Edge{Side: Sides[i], From: a, To: b, UVFrom: SideUV[i][0], UVTo: SideUV[i][1]}
		if pa, pb := sc.Point(a), sc.Point(b); pa != nil && pb != nil {
			e.LengthPx = math.Round(math.Hypot(pb.X-pa.X, pb.Y-pa.Y)*100) / 100
		}
		var P, Q Vec
		if placed && inAtlas {
			P, Q = aff.Apply(e.UVFrom[0], e.UVFrom[1]), aff.Apply(e.UVTo[0], e.UVTo[1])
			e.AtlasSide = rectSide(rect, P, Q)
		}
	scan:
		for oi := range sc.Objects {
			for si := range sc.Objects[oi].Surfaces {
				other := &sc.Objects[oi].Surfaces[si]
				if other.ID == f.ID || other.Role != "face" || other.Kind == "line" || other.Kind == "mask" {
					continue
				}
				has := func(id string) bool {
					for _, x := range other.PointIDs {
						if x == id {
							return true
						}
					}
					return false
				}
				if !has(a) || !has(b) {
					continue
				}
				n := &Neighbour{SurfaceID: other.ID, Name: other.Name, ObjectID: sc.Objects[oi].ID}
				if s := QuadSide(other.PointIDs, a, b); s >= 0 {
					n.Side = Sides[s]
					if oa, ok := affs[other.ID]; ok && placed && sc.Objects[oi].ID == o.ID {
						// the neighbour's corners for points a and b
						ia, ib := indexOf(other.PointIDs, a), indexOf(other.PointIDs, b)
						A := oa.Apply(unitSquare[ia][0], unitSquare[ia][1])
						B := oa.Apply(unitSquare[ib][0], unitSquare[ib][1])
						n.Joined = dist(A, P) < 1.5 && dist(B, Q) < 1.5
					}
				}
				e.Neighbour = n
				break scan
			}
		}
		out = append(out, e)
	}
	return out
}

func indexOf(ids []string, id string) int {
	for i, x := range ids {
		if x == id {
			return i
		}
	}
	return -1
}
