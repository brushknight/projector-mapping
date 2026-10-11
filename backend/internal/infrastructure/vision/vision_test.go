package vision

import (
	"image"
	"math"
	"math/rand"
	"sync"
	"testing"
)

// renderFrames captures a full calibration pass of w.
func renderFrames(w *World, noise float64, seed int64) Frames {
	rng := rand.New(rand.NewSource(seed))
	shot := func(kind, axis string, bit int, inv bool) image.Image {
		return w.Render(PatternFunc(kind, axis, bit, inv, w.ProjW, w.ProjH), noise, rng)
	}
	f := Frames{White: shot("white", "", 0, false), Black: shot("black", "", 0, false)}
	for b := 0; b < Bits(w.ProjW); b++ {
		f.X = append(f.X, [2]image.Image{shot("gray", "x", b, false), shot("gray", "x", b, true)})
	}
	for b := 0; b < Bits(w.ProjH); b++ {
		f.Y = append(f.Y, [2]image.Image{shot("gray", "y", b, false), shot("gray", "y", b, true)})
	}
	return f
}

// meanError is the mean distance between decoded and true projector points over valid pixels.
func meanError(t *testing.T, m *Map, w *World) float64 {
	t.Helper()
	var sum float64
	n := 0
	sx, sy := float64(m.CamW)/float64(m.W), float64(m.CamH)/float64(m.H)
	for y := 0; y < m.H; y++ {
		for x := 0; x < m.W; x++ {
			i := y*m.W + x
			if !m.Valid(i) {
				continue
			}
			tp, ok := w.Truth((float64(x)+0.5)*sx, (float64(y)+0.5)*sy)
			if !ok {
				continue
			}
			sum += tp.dist(Pt{float64(m.X[i]), float64(m.Y[i])})
			n++
		}
	}
	if n == 0 {
		t.Fatal("no valid pixels")
	}
	return sum / float64(n)
}

var desk struct {
	once sync.Once
	w    *World
	m    *Map
	q    Quality
	err  error
}

// deskMap decodes DeskWorld (projector 640x360, camera 800x600) once for every test that needs it.
func deskMap(t *testing.T) (*World, *Map, Quality) {
	t.Helper()
	desk.once.Do(func() {
		desk.w = DeskWorld(800, 600, 640, 360)
		desk.m, desk.q, desk.err = Decode(renderFrames(desk.w, 0.01, 3), 640, 360, DecodeOptions{})
	})
	if desk.err != nil {
		t.Fatal(desk.err)
	}
	return desk.w, desk.m, desk.q
}

func TestPatterns(t *testing.T) {
	if Bits(1920) != 11 || Bits(1080) != 11 || Bits(1) != 1 || Bits(1024) != 10 {
		t.Fatalf("bits: %d %d", Bits(1920), Bits(1080))
	}
	for _, axis := range []string{"x", "y"} {
		for bit := 0; bit < 6; bit++ {
			for _, inv := range []bool{false, true} {
				img := GrayPattern(64, 48, axis, bit, inv)
				for y := 0; y < 48; y++ {
					for x := 0; x < 64; x++ {
						c := x
						if axis == "y" {
							c = y
						}
						want := PatternOn(c, bit, inv)
						if (img.GrayAt(x, y).Y == 255) != want {
							t.Fatalf("%s bit %d inv %v at %d,%d", axis, bit, inv, x, y)
						}
						if got := PatternFunc("gray", axis, bit, inv, 64, 48)(float64(x)+0.5, float64(y)+0.5); (got == 1) != want {
							t.Fatalf("PatternFunc disagrees at %d,%d", x, y)
						}
					}
				}
			}
		}
	}
	// adjacent columns differ in exactly one bit
	for c := 0; c < 2047; c++ {
		g1, g2 := c^(c>>1), (c+1)^((c+1)>>1)
		if d := g1 ^ g2; d&(d-1) != 0 {
			t.Fatalf("gray code broken at %d", c)
		}
		if grayToBinary(g1) != c {
			t.Fatalf("grayToBinary(%d) = %d", g1, grayToBinary(g1))
		}
	}
}

func TestDecodeSinglePlane(t *testing.T) {
	camQuad := []Pt{{60, 50}, {590, 80}, {570, 440}, {80, 420}}
	h, err := FitHomography(camQuad, []Pt{{0, 0}, {320, 0}, {320, 200}, {0, 200}})
	if err != nil {
		t.Fatal(err)
	}
	w := &World{CamW: 640, CamH: 480, ProjW: 320, ProjH: 200, Ambient: 0.05,
		Planes: []Plane{{Name: "wall", Camera: []Pt{{0, 0}, {640, 0}, {640, 480}, {0, 480}}, H: h, Albedo: 0.8}}}
	m, q, err := Decode(renderFrames(w, 0.01, 1), 320, 200, DecodeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if e := meanError(t, m, w); e >= 1 {
		t.Fatalf("mean error %.3f px", e)
	}
	if q.Coverage < 0.9 || q.ErrorPx >= 1 {
		t.Fatalf("quality %+v", q)
	}
}

func TestDecodeDesk(t *testing.T) {
	w, m, q := deskMap(t)
	if e := meanError(t, m, w); e >= 1 {
		t.Fatalf("mean error %.3f px", e)
	}
	if q.ErrorPx >= 1 || q.Coverage < 0.7 {
		t.Fatalf("quality %+v", q)
	}
	pts := []Pt{{200, 150}, {600, 400}, {150.3, 420.7}}
	for _, pl := range w.Planes[1:] { // cube face centroids
		var c Pt
		for _, p := range pl.Camera {
			c = c.add(p)
		}
		pts = append(pts, c.mul(1/float64(len(pl.Camera))))
	}
	for _, p := range pts {
		tp, ok := w.Truth(p.X, p.Y)
		if !ok {
			t.Fatalf("no truth at %v", p)
		}
		got, ok := m.Lookup(p.X, p.Y)
		if !ok {
			t.Fatalf("no lookup at %v", p)
		}
		if d := got.dist(tp); d >= 0.75 {
			t.Fatalf("lookup at %v: %v, want %v (%.2f px)", p, got, tp, d)
		}
	}
}

func TestDecodeDownscales(t *testing.T) {
	w := DeskWorld(1600, 1200, 640, 360)
	m, _, err := Decode(renderFrames(w, 0.01, 5), 640, 360, DecodeOptions{MaxWidth: 800})
	if err != nil {
		t.Fatal(err)
	}
	if m.W != 800 || m.H != 600 || m.CamW != 1600 {
		t.Fatalf("size %dx%d cam %dx%d", m.W, m.H, m.CamW, m.CamH)
	}
	if e := meanError(t, m, w); e >= 1.5 {
		t.Fatalf("mean error %.3f px", e)
	}
	tp, _ := w.Truth(400, 300)
	if got, ok := m.Lookup(400, 300); !ok || got.dist(tp) > 1 {
		t.Fatalf("lookup %v want %v", got, tp)
	}
}

func TestMapPNGRoundTrip(t *testing.T) {
	_, m, _ := deskMap(t)
	b, err := EncodePNG(m)
	if err != nil {
		t.Fatal(err)
	}
	m2, err := DecodePNG(b)
	if err != nil {
		t.Fatal(err)
	}
	if m2.W != m.W || m2.H != m.H || m2.CamW != m.CamW || m2.CamH != m.CamH || m2.ProjW != m.ProjW || m2.ProjH != m.ProjH {
		t.Fatalf("header %+v", m2)
	}
	for i := range m.X {
		if m.Valid(i) != m2.Valid(i) {
			t.Fatalf("validity differs at %d", i)
		}
		if m.Valid(i) && (math.Abs(float64(m.X[i]-m2.X[i])) > 1.0/16 || math.Abs(float64(m.Y[i]-m2.Y[i])) > 1.0/16) {
			t.Fatalf("value differs at %d", i)
		}
	}
	if _, err := DecodePNG(b[:20]); err == nil {
		t.Fatal("truncated png decoded")
	}
}

func TestHomography(t *testing.T) {
	h := Homography{1.2, 0.1, 30, -0.05, 0.9, 12, 0.0004, -0.0002, 1}
	rng := rand.New(rand.NewSource(9))
	var src, dst []Pt
	for k := 0; k < 100; k++ {
		p := Pt{rng.Float64() * 640, rng.Float64() * 480}
		q := h.Apply(p)
		if k%10 < 3 { // 30% outliers
			q = Pt{rng.Float64() * 800, rng.Float64() * 600}
		}
		src, dst = append(src, p), append(dst, q)
	}
	fit, err := FitHomography(src[3:4+3], dst[3:4+3])
	if err != nil {
		t.Fatal(err)
	}
	if d := fit.Apply(Pt{100, 100}).dist(h.Apply(Pt{100, 100})); d > 1e-6 {
		t.Fatalf("exact fit off by %g", d)
	}
	inv, err := h.Inverse()
	if err != nil {
		t.Fatal(err)
	}
	if d := inv.Apply(h.Apply(Pt{321, 123})).dist(Pt{321, 123}); d > 1e-9 {
		t.Fatalf("inverse off by %g", d)
	}
	r, in, err := RANSACHomography(src, dst, 300, 1, rand.New(rand.NewSource(1)))
	if err != nil {
		t.Fatal(err)
	}
	if f := fraction(in); f < 0.69 || f > 0.71 {
		t.Fatalf("inliers %.2f", f)
	}
	for _, p := range []Pt{{0, 0}, {640, 480}, {300, 200}} {
		if d := r.Apply(p).dist(h.Apply(p)); d > 1e-6 {
			t.Fatalf("ransac off by %g at %v", d, p)
		}
	}
	if _, err := FitHomography([]Pt{{0, 0}, {1, 1}, {2, 2}, {3, 3}}, []Pt{{0, 0}, {1, 1}, {2, 2}, {3, 3}}); err == nil {
		t.Fatal("collinear points fitted")
	}
}

func TestDetectSurfaces(t *testing.T) {
	w, m, _ := deskMap(t)
	cands := DetectSurfaces(m, DetectOptions{})
	if len(cands) < 3 {
		t.Fatalf("%d candidates", len(cands))
	}
	if cands[0].Kind != "quad" || len(cands[0].Camera) != 4 {
		t.Fatalf("wall: %+v", cands[0])
	}
	found := 0
	for _, face := range w.Planes[1:] {
		best, worstBest := -1, math.MaxFloat64
		for ci, c := range cands[1:] {
			if len(c.Camera) != 4 {
				continue
			}
			worst := 0.0
			for _, tc := range face.Camera {
				near := math.MaxFloat64
				for _, p := range c.Camera {
					near = math.Min(near, p.dist(tc))
				}
				worst = math.Max(worst, near)
			}
			if worst < worstBest {
				best, worstBest = ci+1, worst
			}
		}
		if best < 0 {
			continue
		}
		c := cands[best]
		t.Logf("%s: worst corner %.2f px, confidence %.2f", face.Name, worstBest, c.Confidence)
		if worstBest > 8 {
			continue
		}
		found++
		// the projector vertices follow the face's own homography
		for k, p := range c.Camera {
			if d := face.H.Apply(p).dist(c.Projector[k]); d > 2 {
				t.Errorf("%s projector vertex %d off by %.2f", face.Name, k, d)
			}
		}
	}
	if found < 2 {
		t.Fatalf("found %d cube faces within 8 px", found)
	}
	for _, c := range cands {
		if a := signedArea(c.Camera); a <= 0 {
			t.Fatalf("not clockwise on screen: %v", c.Camera)
		}
	}
}

func TestInverseRoundTrip(t *testing.T) {
	w, m, _ := deskMap(t)
	inv := m.Inverse(8)
	top := w.Planes[1]
	var c Pt
	for _, p := range top.Camera {
		c = c.add(p)
	}
	topCentre := top.H.Apply(c.mul(0.25))
	for _, p := range []Pt{{0.15 * 640, 0.2 * 360}, {0.8 * 640, 0.3 * 360}, {0.25 * 640, 0.8 * 360}, topCentre} {
		q, ok := inv.Lookup(p.X, p.Y)
		if !ok {
			t.Fatalf("no inverse at %v", p)
		}
		p2, ok := m.Lookup(q.X, q.Y)
		if !ok {
			t.Fatalf("no lookup at %v", q)
		}
		if d := p2.dist(p); d > 1.5 {
			t.Fatalf("round trip %v → %v → %v (%.2f px)", p, q, p2, d)
		}
	}
}

func TestMeasureAlignment(t *testing.T) {
	w, m, _ := deskMap(t)
	inv := m.Inverse(8)
	proj := func(pl Plane) []Pt {
		var out []Pt
		for _, p := range pl.Camera {
			out = append(out, pl.H.Apply(p))
		}
		return out
	}
	left := proj(w.Planes[2]) // l, c, b, bl
	c, b := left[1], left[2]
	var cen Pt
	for _, p := range left {
		cen = cen.add(p)
	}
	cen = cen.mul(0.25)
	// the inward normal of edge c→b, toward the left face's centre
	d := b.sub(c).mul(1 / b.dist(c))
	nrm := Pt{-d.Y, d.X}
	if cen.sub(c).X*nrm.X+cen.sub(c).Y*nrm.Y < 0 {
		nrm = nrm.mul(-1)
	}
	moved := [2]Pt{c.add(nrm.mul(4)), b.add(nrm.mul(4))}
	exact := [2]Pt{c, b}
	segDist := func(p, a, b Pt) float64 {
		ab := b.sub(a)
		t := math.Max(0, math.Min(1, ((p.X-a.X)*ab.X+(p.Y-a.Y)*ab.Y)/(ab.X*ab.X+ab.Y*ab.Y)))
		return p.dist(lerp(a, b, t))
	}
	outline := func(e [2]Pt) func(px, py float64) float64 {
		return func(px, py float64) float64 {
			if segDist(Pt{px, py}, e[0], e[1]) < 1.5 {
				return 1
			}
			return 0
		}
	}
	rng := rand.New(rand.NewSource(11))
	lit := w.Render(PatternFunc("white", "", 0, false, 640, 360), 0.01, rng)
	got := MeasureAlignment(w.Render(outline(moved), 0.01, rng), lit, m, inv, [][2]Pt{moved})
	if got[0].Samples < 3 || math.Abs(got[0].ErrorPx-4) > 1.5 {
		t.Fatalf("moved edge: %+v", got[0])
	}
	got = MeasureAlignment(w.Render(outline(exact), 0.01, rng), lit, m, inv, [][2]Pt{exact})
	if got[0].Samples < 3 || got[0].ErrorPx > 1.5 {
		t.Fatalf("exact edge: %+v", got[0])
	}
	t.Logf("moved %.2f px, exact %.2f px", MeasureAlignment(w.Render(outline(moved), 0, nil), lit, m, inv, [][2]Pt{moved})[0].ErrorPx, got[0].ErrorPx)
}
