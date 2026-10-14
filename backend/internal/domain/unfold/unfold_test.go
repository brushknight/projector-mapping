package unfold_test

import (
	"math"
	"testing"

	"projmap/internal/catalog"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/unfold"
)

func fixture(t *testing.T) *scene.Scene {
	t.Helper()
	b, err := catalog.Fixture("scene")
	if err != nil {
		t.Fatal(err)
	}
	sc, err := scene.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return sc
}

func near(a, b unfold.Vec) bool { return math.Abs(a[0]-b[0]) < 1e-6 && math.Abs(a[1]-b[1]) < 1e-6 }

func TestAutoAtlasMatchesTheRenderer(t *testing.T) {
	sc := fixture(t)
	cube := &sc.Objects[sc.FindObject("obj_cube")]
	stored := *cube.Atlas
	cube.Atlas = nil
	a := unfold.AutoAtlas(sc, cube)
	if a.Width != stored.Width || a.Height != stored.Height || len(a.Faces) != 3 {
		t.Fatalf("atlas %+v, want %+v", a, stored)
	}
	for id, r := range stored.Faces {
		if a.Faces[id] != r {
			t.Errorf("%s: %+v, want %+v", id, a.Faces[id], r)
		}
	}
	top, left, right := unfold.RectAffine(a.Faces["srf_top"]), unfold.RectAffine(a.Faces["srf_left"]), unfold.RectAffine(a.Faces["srf_right"])
	if !near(top.Apply(0, 0), left.Apply(0, 0)) || !near(top.Apply(0, 1), left.Apply(1, 0)) || !near(left.Apply(1, 1), right.Apply(0, 1)) {
		t.Fatal("shared edges land on the same atlas pixels")
	}
	lamp := &sc.Objects[sc.FindObject("obj_lamp")]
	la := unfold.AutoAtlas(sc, lamp)
	if la.Width != 170 || la.Height != 300 || la.Faces["srf_lamp"].X != 0 {
		t.Fatalf("lamp %+v", la)
	}
}

func TestDetailsAndEdges(t *testing.T) {
	sc := fixture(t)
	cube := &sc.Objects[sc.FindObject("obj_cube")]
	atlas, stored := unfold.Resolve(sc, cube)
	if !stored {
		t.Fatal("the fixture stores its atlas")
	}
	affs := unfold.Affines(sc, cube, atlas)
	r := atlas.Faces["srf_right"]
	c := affs["srf_bay0"].Apply(0.5, 0.5)
	if c[0] <= r.X || c[0] >= r.X+r.W || c[1] <= r.Y || c[1] >= r.Y+r.H {
		t.Fatalf("bay0 centre %v outside the right face %+v", c, r)
	}
	if _, ok := affs["srf_edges"]; ok {
		t.Fatal("lines have no place")
	}
	_, ri := 0, 2
	right := &cube.Surfaces[ri]
	edges := unfold.Edges(sc, cube, right, atlas, affs)
	if len(edges) != 4 {
		t.Fatalf("edges %v", edges)
	}
	// right = p_c, p_r, p_br, p_b: its top touches the top face, its left the left face
	if edges[0].Neighbour == nil || edges[0].Neighbour.SurfaceID != "srf_top" || edges[0].Neighbour.Side != "bottom" {
		t.Fatalf("top edge %+v", edges[0])
	}
	if edges[3].Neighbour == nil || edges[3].Neighbour.SurfaceID != "srf_left" || edges[3].Neighbour.Side != "right" || !edges[3].Neighbour.Joined {
		t.Fatalf("left edge %+v", edges[3].Neighbour)
	}
	if edges[0].Neighbour.Joined {
		t.Fatal("right and top are cut apart in this unfold")
	}
	if edges[1].Neighbour != nil || edges[2].Neighbour != nil {
		t.Fatal("the right and bottom edges are free")
	}
	if edges[3].AtlasSide != "left" || edges[0].AtlasSide != "top" {
		t.Fatalf("atlas sides %s %s", edges[3].AtlasSide, edges[0].AtlasSide)
	}
	// the top face is turned 270°: its left edge (p_c → p_l, u = 0) lies on the rect's bottom, against the left face
	topEdges := unfold.Edges(sc, cube, &cube.Surfaces[0], atlas, affs)
	if topEdges[3].Neighbour == nil || topEdges[3].Neighbour.SurfaceID != "srf_left" || !topEdges[3].Neighbour.Joined || topEdges[3].AtlasSide != "bottom" {
		t.Fatalf("top's left edge %+v %+v", topEdges[3], topEdges[3].Neighbour)
	}
}

func TestHomographyRoundTrip(t *testing.T) {
	sc := fixture(t)
	_, si, _ := sc.FindSurface("srf_right")
	g := unfold.SurfaceGeometry(sc, &sc.Objects[0].Surfaces[si])
	for _, uv := range []unfold.Vec{{0, 0}, {1, 0}, {1, 1}, {0, 1}, {0.3, 0.7}} {
		p := g.UVToScene(uv[0], uv[1])
		back := g.SceneToUV(p[0], p[1])
		if math.Abs(back[0]-uv[0]) > 1e-6 || math.Abs(back[1]-uv[1]) > 1e-6 {
			t.Fatalf("%v → %v → %v", uv, p, back)
		}
	}
}
