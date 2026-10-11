package setup

import (
	"math"
	"testing"
)

func TestTransforms(t *testing.T) {
	cases := []struct {
		o            Output
		x, y         float64
		wantX, wantY float64
	}{
		{Output{1920, 1080, Landscape, false, false}, 100, 50, 100, 50},
		{Output{1920, 1080, Landscape, true, false}, 100, 50, 1820, 50},
		{Output{1920, 1080, PortraitCW, false, false}, 0, 0, 1920, 0},
		{Output{1920, 1080, PortraitCW, false, false}, 1080, 0, 1920, 1080},
		{Output{1920, 1080, PortraitCCW, false, false}, 0, 0, 0, 1080},
		{Output{1920, 1080, PortraitCW, true, true}, 100, 200, 200, 980},
	}
	for i, c := range cases {
		px, py := c.o.SceneToPhysical(c.x, c.y)
		if math.Abs(px-c.wantX) > 1e-9 || math.Abs(py-c.wantY) > 1e-9 {
			t.Fatalf("case %d: got %v,%v want %v,%v", i, px, py, c.wantX, c.wantY)
		}
		sx, sy := c.o.PhysicalToScene(px, py)
		if math.Abs(sx-c.x) > 1e-9 || math.Abs(sy-c.y) > 1e-9 {
			t.Fatalf("case %d: inverse %v,%v", i, sx, sy)
		}
	}
	if w, h := (Output{1920, 1080, PortraitCW, false, false}).SceneSize(); w != 1080 || h != 1920 {
		t.Fatal("portrait scenes are authored at height x width")
	}
}

func TestValidate(t *testing.T) {
	s := Default("set_1", "x")
	if err := s.Validate(); err != nil {
		t.Fatal(err)
	}
	s.TestPattern = "plaid"
	if s.Validate() == nil {
		t.Fatal("unknown pattern")
	}
}
