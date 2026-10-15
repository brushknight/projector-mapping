package scene

import (
	"math"
	"testing"
)

func followScene(face []Point, bay []Point, extra ...Surface) *Scene {
	pts := append(append([]Point{}, face...), bay...)
	parent := "srf_face"
	ids := func(ps []Point) []string {
		out := []string{}
		for _, p := range ps {
			out = append(out, p.ID)
		}
		return out
	}
	surfaces := []Surface{
		{ID: "srf_face", Kind: "quad", Role: "face", PointIDs: ids(face)},
		{ID: "srf_bay", Kind: "quad", Role: "detail", ParentID: &parent, PointIDs: ids(bay)},
	}
	surfaces = append(surfaces, extra...)
	return &Scene{Points: pts, Objects: []Object{{ID: "obj", Surfaces: surfaces}}}
}

func near(a, b float64) bool { return math.Abs(a-b) < 0.011 }

// moving one corner maps the bay by the face's homography: the face centre (the diagonals' crossing) stays the
// diagonals' crossing, which only a projective map keeps
func TestFollowDetailsHomography(t *testing.T) {
	face := []Point{{"a", 0, 0}, {"b", 100, 0}, {"c", 100, 100}, {"d", 0, 100}}
	bay := []Point{{"m", 50, 50}, {"q1", 25, 25}, {"q2", 75, 25}, {"q3", 75, 75}}
	old := followScene(face, bay)
	next := followScene([]Point{{"a", 0, 0}, {"b", 100, 0}, {"c", 160, 140}, {"d", 0, 100}}, bay)
	got := FollowDetails(old, next)
	// diagonals a–c (0,0)-(160,140) and b–d (100,0)-(0,100): x = 160t, y = 140t, x + y = 100 → t = 1/3
	m := got["m"]
	if !near(m.X, 160.0/3) || !near(m.Y, 140.0/3) {
		t.Fatalf("centre went to %+v, want the diagonals' crossing", m)
	}
	// the corners of the face are not touched, every bay point is
	if _, ok := got["c"]; ok || len(got) != 4 {
		t.Fatalf("moves %+v", got)
	}
	// q1 lies on the diagonal a–c (25,25): it stays on the new one
	if q := got["q1"]; !near(q.Y/q.X, 140.0/160) {
		t.Fatalf("q1 %+v left the diagonal", q)
	}
}

func TestFollowDetailsTranslateAndScale(t *testing.T) {
	face := []Point{{"a", 10, 10}, {"b", 110, 10}, {"c", 110, 110}, {"d", 10, 110}}
	bay := []Point{{"e", 20, 20}, {"f", 40, 20}, {"g", 40, 30}, {"h", 20, 30}}
	old := followScene(face, bay)
	moved := []Point{{"a", 15, 13}, {"b", 215, 13}, {"c", 215, 213}, {"d", 15, 213}}
	got := FollowDetails(old, followScene(moved, bay))
	// x' = 15 + 2(x-10), y' = 13 + 2(y-10)
	for _, p := range bay {
		w := Point{X: 15 + 2*(p.X-10), Y: 13 + 2*(p.Y-10)}
		if g := got[p.ID]; !near(g.X, w.X) || !near(g.Y, w.Y) {
			t.Fatalf("%s went to %+v, want %+v", p.ID, g, w)
		}
	}
}

func TestFollowDetailsSkipsSharedAndMovedPoints(t *testing.T) {
	face := []Point{{"a", 0, 0}, {"b", 100, 0}, {"c", 100, 100}, {"d", 0, 100}}
	// e is also a corner of another face, f is the face's own corner b (a bay flush with the edge)
	bay := []Point{{"e", 20, 20}, {"g", 40, 20}, {"h", 40, 40}}
	other := Surface{ID: "srf_other", Kind: "tri", Role: "face", PointIDs: []string{"e", "x1", "x2"}}
	old := followScene(face, bay, other)
	old.Points = append(old.Points, Point{"x1", 300, 300}, Point{"x2", 320, 300})
	old.Objects[0].Surfaces[1].PointIDs = []string{"e", "g", "h", "b"}
	next := followScene([]Point{{"a", 10, 0}, {"b", 110, 0}, {"c", 110, 100}, {"d", 10, 100}}, []Point{{"e", 20, 20}, {"g", 40, 20}, {"h", 45, 40}}, other)
	next.Points = append(next.Points, Point{"x1", 300, 300}, Point{"x2", 320, 300})
	next.Objects[0].Surfaces[1].PointIDs = []string{"e", "g", "h", "b"}
	got := FollowDetails(old, next)
	if _, ok := got["e"]; ok {
		t.Fatal("a point another face uses must not follow")
	}
	if _, ok := got["h"]; ok {
		t.Fatal("a detail point that moved on its own keeps its own move")
	}
	if g := got["g"]; !near(g.X, 50) || !near(g.Y, 20) {
		t.Fatalf("g %+v", g)
	}
	if _, ok := got["b"]; ok {
		t.Fatal("the face's own corner is not a follower")
	}
}

func TestFollowDetailsPolyParentAffine(t *testing.T) {
	parent := "srf_face"
	old := &Scene{Points: []Point{{"a", 0, 0}, {"b", 100, 0}, {"c", 120, 60}, {"d", 50, 100}, {"e", -20, 60}, {"k", 50, 50}},
		Objects: []Object{{ID: "o", Surfaces: []Surface{
			{ID: "srf_face", Kind: "poly", Role: "face", PointIDs: []string{"a", "b", "c", "d", "e"}},
			{ID: "srf_dot", Kind: "circle", Role: "detail", ParentID: &parent, PointIDs: []string{"k"}},
		}}}}
	next := *old
	next.Points = []Point{{"a", 30, 10}, {"b", 130, 10}, {"c", 150, 70}, {"d", 80, 110}, {"e", 10, 70}, {"k", 50, 50}}
	got := FollowDetails(old, &next)
	if k := got["k"]; !near(k.X, 80) || !near(k.Y, 60) {
		t.Fatalf("k %+v, want the translation (80, 60)", k)
	}
}

func TestFollowOpsAreGuarded(t *testing.T) {
	face := []Point{{"a", 0, 0}, {"b", 100, 0}, {"c", 100, 100}, {"d", 0, 100}}
	bay := []Point{{"e", 20, 20}}
	next := followScene(face, bay)
	ops := FollowOps(next, map[string]Point{"e": {ID: "e", X: 30, Y: 20}})
	if len(ops) != 3 || ops[0].Op != "test" || ops[0].Path != "/points/4/id" || ops[1].Path != "/points/4/x" {
		t.Fatalf("ops %+v", ops)
	}
}
