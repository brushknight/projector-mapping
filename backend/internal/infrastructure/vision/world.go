package vision

import (
	"image"
	"image/color"
	"math"
	"math/rand"
	"runtime"
	"sync"
)

// Plane is one flat surface of a synthetic world: its convex outline in camera pixels and the homography that maps a
// camera pixel on it to the projector pixel that lights it.
type Plane struct {
	Name   string
	Camera []Pt
	H      Homography
	Albedo float64
}

// World is a synthetic camera view of a projected scene. Later planes occlude earlier ones (and cast projector
// shadows on them). Render caches the geometry on first use, so do not change the planes after rendering.
type World struct {
	CamW, CamH, ProjW, ProjH int
	Planes                   []Plane
	Ambient                  float64

	mu    sync.Mutex
	cache *worldCache
}

// worldCache holds, per 2x2 supersample of every camera pixel, the plane hit and the projector point lighting it.
type worldCache struct {
	plane  []int16   // -1 = nothing
	px, py []float32 // NaN = in a projector shadow
}

// DeskWorld is a wall covering the projection area seen in perspective, plus a dark cube (top, left and right faces,
// each its own plane, sharing edges) standing in front of it, closer to the camera, so it shows parallax.
func DeskWorld(camW, camH, projW, projH int) *World {
	cw, ch, pw, ph := float64(camW), float64(camH), float64(projW), float64(projH)
	projRect := []Pt{{0, 0}, {pw, 0}, {pw, ph}, {0, ph}}
	camQuad := []Pt{{0.12 * cw, 0.10 * ch}, {0.90 * cw, 0.14 * ch}, {0.86 * cw, 0.88 * ch}, {0.10 * cw, 0.84 * ch}}
	wall, _ := FitHomography(camQuad, projRect)
	wallInv, _ := wall.Inverse()
	type vert struct {
		p     Pt // projector, as a fraction of the frame
		depth float64
	}
	verts := map[string]vert{
		"t": {Pt{0.50, 0.28}, 0.10}, "r": {Pt{0.64, 0.42}, 0.55}, "br": {Pt{0.64, 0.70}, 0.55},
		"b": {Pt{0.50, 0.84}, 1.00}, "bl": {Pt{0.36, 0.70}, 0.55}, "l": {Pt{0.36, 0.42}, 0.55},
		"c": {Pt{0.50, 0.56}, 1.00},
	}
	shift := Pt{0.09 * cw, -0.02 * ch}
	face := func(name string, albedo float64, names ...string) Plane {
		var cam, proj []Pt
		for _, n := range names {
			v := verts[n]
			p := Pt{v.p.X * pw, v.p.Y * ph}
			cam = append(cam, wallInv.Apply(p).add(shift.mul(v.depth)))
			proj = append(proj, p)
		}
		h, _ := FitHomography(cam, proj)
		return Plane{Name: name, Camera: cam, H: h, Albedo: albedo}
	}
	return &World{
		CamW: camW, CamH: camH, ProjW: projW, ProjH: projH, Ambient: 0.05,
		Planes: []Plane{
			{Name: "wall", Camera: []Pt{{0, 0}, {cw, 0}, {cw, ch}, {0, ch}}, H: wall, Albedo: 0.85},
			face("top", 0.6, "l", "t", "r", "c"),
			face("left", 0.5, "l", "c", "b", "bl"),
			face("right", 0.35, "c", "r", "br", "b"),
		},
	}
}

// PlaneAt is the index of the topmost plane containing camera point (u, v), or -1.
func (w *World) PlaneAt(u, v float64) int {
	p := Pt{u, v}
	for i := len(w.Planes) - 1; i >= 0; i-- {
		if inPolygon(p, w.Planes[i].Camera) {
			return i
		}
	}
	return -1
}

// projPolys are the planes' outlines in projector pixels.
func (w *World) projPolys() [][]Pt {
	out := make([][]Pt, len(w.Planes))
	for i, pl := range w.Planes {
		for _, c := range pl.Camera {
			out[i] = append(out[i], pl.H.Apply(c))
		}
	}
	return out
}

// hit is what camera point (u, v) sees: the plane and the projector point lighting it (shadow = a closer plane
// blocks that projector ray).
func (w *World) hit(u, v float64, polys [][]Pt) (plane int, p Pt, shadow bool) {
	plane = w.PlaneAt(u, v)
	if plane < 0 {
		return -1, Pt{}, false
	}
	p = w.Planes[plane].H.Apply(Pt{u, v})
	for j := plane + 1; j < len(w.Planes); j++ {
		if inPolygon(p, polys[j]) {
			return plane, p, true
		}
	}
	return plane, p, false
}

// Truth is the ground-truth projector point lighting camera point (u, v): false on no plane, in a projector shadow
// or outside the framebuffer.
func (w *World) Truth(u, v float64) (Pt, bool) {
	pl, p, shadow := w.hit(u, v, w.projPolys())
	if pl < 0 || shadow || p.X < 0 || p.Y < 0 || p.X >= float64(w.ProjW) || p.Y >= float64(w.ProjH) {
		return Pt{}, false
	}
	return p, true
}

var superOffsets = [4]Pt{{0.25, 0.25}, {0.75, 0.25}, {0.25, 0.75}, {0.75, 0.75}}

func (w *World) geometry() *worldCache {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.cache != nil {
		return w.cache
	}
	n := w.CamW * w.CamH * 4
	c := &worldCache{plane: make([]int16, n), px: make([]float32, n), py: make([]float32, n)}
	polys := w.projPolys()
	parallelRows(w.CamH, func(y int) {
		for x := 0; x < w.CamW; x++ {
			for s, o := range superOffsets {
				k := (y*w.CamW+x)*4 + s
				pl, p, shadow := w.hit(float64(x)+o.X, float64(y)+o.Y, polys)
				c.plane[k] = int16(pl)
				if shadow {
					c.px[k], c.py[k] = float32(math.NaN()), float32(math.NaN())
				} else {
					c.px[k], c.py[k] = float32(p.X), float32(p.Y)
				}
			}
		}
	})
	w.cache = c
	return c
}

// radiance is the camera brightness (0..1, before noise) of every camera pixel for projector image proj.
func (w *World) radiance(proj func(px, py float64) float64) []float64 {
	g := w.geometry()
	out := make([]float64, w.CamW*w.CamH)
	parallelRows(w.CamH, func(y int) {
		for x := 0; x < w.CamW; x++ {
			var sum float64
			for s := 0; s < 4; s++ {
				k := (y*w.CamW+x)*4 + s
				pl := g.plane[k]
				if pl < 0 {
					sum += w.Ambient * 0.3
					continue
				}
				light := w.Ambient
				if px := g.px[k]; !math.IsNaN(float64(px)) {
					light += proj(float64(px), float64(g.py[k]))
				}
				sum += w.Planes[pl].Albedo * light
			}
			out[y*w.CamW+x] = sum / 4
		}
	})
	return out
}

// Render is what the camera sees when the projector shows proj (0..1 at physical projector px): 2x2 supersampled,
// plus gaussian noise of sigma noise when rng is set.
func (w *World) Render(proj func(px, py float64) float64, noise float64, rng *rand.Rand) *image.Gray {
	r := w.radiance(proj)
	img := image.NewGray(image.Rect(0, 0, w.CamW, w.CamH))
	for i, v := range r {
		if rng != nil && noise > 0 {
			v += rng.NormFloat64() * noise
		}
		img.Pix[i] = uint8(math.Round(clamp01(v) * 255))
	}
	return img
}

// RenderRGBA is Render tinted warm, for a nicer preview stream.
func (w *World) RenderRGBA(proj func(px, py float64) float64, noise float64, rng *rand.Rand) *image.RGBA {
	r := w.radiance(proj)
	img := image.NewRGBA(image.Rect(0, 0, w.CamW, w.CamH))
	for i, v := range r {
		if rng != nil && noise > 0 {
			v += rng.NormFloat64() * noise
		}
		v = clamp01(v)
		img.SetRGBA(i%w.CamW, i/w.CamW, color.RGBA{uint8(v * 255), uint8(v * 240), uint8(v * 222), 255})
	}
	return img
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// inPolygon is the even-odd ray test.
func inPolygon(p Pt, poly []Pt) bool {
	in := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a.Y > p.Y) != (b.Y > p.Y) && p.X < (b.X-a.X)*(p.Y-a.Y)/(b.Y-a.Y)+a.X {
			in = !in
		}
	}
	return in
}

// parallelRows runs fn for every row in [0, h) on all CPUs.
func parallelRows(h int, fn func(y int)) {
	workers := runtime.GOMAXPROCS(0)
	var wg sync.WaitGroup
	rows := make(chan int, h)
	for y := 0; y < h; y++ {
		rows <- y
	}
	close(rows)
	for k := 0; k < workers; k++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for y := range rows {
				fn(y)
			}
		}()
	}
	wg.Wait()
}
