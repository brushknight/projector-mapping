package vision

import (
	"errors"
	"fmt"
	"image"
	"math"
	"sort"
	"sync"
)

// Frames are the camera stills of one calibration pass, all the same size.
type Frames struct {
	White, Black image.Image
	// X and Y hold one pair per bit (index 0 = LSB): [0] the normal pattern, [1] its inverse.
	X, Y [][2]image.Image
}

// DecodeOptions tune Decode; zero values take the defaults.
type DecodeOptions struct {
	// MaxWidth is the decode width; wider stills are area-averaged down to it (default 1280).
	MaxWidth int
	// MinContrast is the least white−black difference (0..1) for a pixel to count as lit (default 0.08).
	MinContrast float64
}

// Quality summarises a decoded map.
type Quality struct {
	// Coverage is the fraction of 16x16 projector blocks hit by at least one valid camera pixel.
	Coverage float64 `json:"coverage"`
	// ErrorPx is the decode noise in projector px: the RMS residual of a local affine fit per 16x16 camera block,
	// median over blocks.
	ErrorPx     float64 `json:"errorPx"`
	ValidPixels int     `json:"validPixels"`
}

// Map is the dense camera→projector correspondence at decode resolution.
type Map struct {
	W, H         int // decode resolution
	CamW, CamH   int // the original still size
	ProjW, ProjH int // the physical projector framebuffer
	// X and Y are the projector coordinates (pixel centres) per decode pixel, row-major; < 0 = invalid.
	X, Y []float32
}

// Valid reports whether decode pixel i has a correspondence.
func (m *Map) Valid(i int) bool { return m.X[i] >= 0 && m.Y[i] >= 0 }

// Decode turns a calibration pass into a Map: per pixel, white−black must reach MinContrast, every bit compares the
// pattern with its inverse (more than two ambiguous bits per axis invalidate the pixel), Gray decodes to binary, and
// a 3x3 median check drops pixels more than 3 px from their neighbourhood.
func Decode(f Frames, projW, projH int, opt DecodeOptions) (*Map, Quality, error) {
	if opt.MaxWidth <= 0 {
		opt.MaxWidth = 1280
	}
	if opt.MinContrast <= 0 {
		opt.MinContrast = 0.08
	}
	if f.White == nil || f.Black == nil {
		return nil, Quality{}, errors.New("vision: white and black frames are required")
	}
	nx, ny := Bits(projW), Bits(projH)
	if len(f.X) < nx || len(f.Y) < ny {
		return nil, Quality{}, fmt.Errorf("vision: need %d x bits and %d y bits, got %d and %d", nx, ny, len(f.X), len(f.Y))
	}
	b := f.White.Bounds()
	camW, camH := b.Dx(), b.Dy()
	w, h := camW, camH
	if w > opt.MaxWidth {
		w = opt.MaxWidth
		h = int(math.Round(float64(camH) * float64(w) / float64(camW)))
	}
	// convert every frame in parallel
	imgs := []image.Image{f.White, f.Black}
	for k := 0; k < nx; k++ {
		imgs = append(imgs, f.X[k][0], f.X[k][1])
	}
	for k := 0; k < ny; k++ {
		imgs = append(imgs, f.Y[k][0], f.Y[k][1])
	}
	bufs := make([][]float32, len(imgs))
	errs := make([]error, len(imgs))
	var wg sync.WaitGroup
	for i, img := range imgs {
		wg.Add(1)
		go func(i int, img image.Image) {
			defer wg.Done()
			if img == nil {
				errs[i] = errors.New("vision: missing frame")
				return
			}
			if ib := img.Bounds(); ib.Dx() != camW || ib.Dy() != camH {
				errs[i] = fmt.Errorf("vision: frame %d is %dx%d, want %dx%d", i, ib.Dx(), ib.Dy(), camW, camH)
				return
			}
			bufs[i] = downscale(luminance(img), camW, camH, w, h)
		}(i, img)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, Quality{}, err
		}
	}
	white, black := bufs[0], bufs[1]
	xs, ys := bufs[2:2+2*nx], bufs[2+2*nx:]

	raw := &Map{W: w, H: h, CamW: camW, CamH: camH, ProjW: projW, ProjH: projH,
		X: make([]float32, w*h), Y: make([]float32, w*h)}
	axis := func(fr [][]float32, n, i int, amb float32) (int, bool) {
		g, ambiguous := 0, 0
		for k := 0; k < n; k++ {
			d := fr[2*k][i] - fr[2*k+1][i]
			if d > 0 {
				g |= 1 << k
			}
			if d < amb && d > -amb {
				ambiguous++
			}
		}
		if ambiguous > 2 {
			return 0, false
		}
		return grayToBinary(g), true
	}
	minC := float32(opt.MinContrast)
	parallelRows(h, func(y int) {
		for x := 0; x < w; x++ {
			i := y*w + x
			raw.X[i], raw.Y[i] = -1, -1
			c := white[i] - black[i]
			if c < minC {
				continue
			}
			amb := 0.15 * c
			cx, okx := axis(xs, nx, i, amb)
			cy, oky := axis(ys, ny, i, amb)
			if !okx || !oky || cx >= projW || cy >= projH {
				continue
			}
			raw.X[i], raw.Y[i] = float32(cx)+0.5, float32(cy)+0.5
		}
	})
	m := medianFilter(raw)
	q := m.quality()
	if q.ValidPixels == 0 {
		return m, q, errors.New("vision: no pixel decoded (is the projection in frame and the room dim?)")
	}
	return m, q, nil
}

func grayToBinary(g int) int {
	b := g
	for s := g >> 1; s != 0; s >>= 1 {
		b ^= s
	}
	return b
}

// medianFilter drops pixels with fewer than two valid neighbours or more than 3 px from their neighbours' median.
func medianFilter(m *Map) *Map {
	out := &Map{W: m.W, H: m.H, CamW: m.CamW, CamH: m.CamH, ProjW: m.ProjW, ProjH: m.ProjH,
		X: make([]float32, len(m.X)), Y: make([]float32, len(m.Y))}
	parallelRows(m.H, func(y int) {
		var nx, ny [8]float32
		for x := 0; x < m.W; x++ {
			i := y*m.W + x
			out.X[i], out.Y[i] = -1, -1
			if !m.Valid(i) {
				continue
			}
			n := 0
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					xx, yy := x+dx, y+dy
					if (dx == 0 && dy == 0) || xx < 0 || yy < 0 || xx >= m.W || yy >= m.H {
						continue
					}
					if j := yy*m.W + xx; m.Valid(j) {
						nx[n], ny[n] = m.X[j], m.Y[j]
						n++
					}
				}
			}
			if n < 2 {
				continue
			}
			mx, my := median32(nx[:n]), median32(ny[:n])
			if abs32(m.X[i]-mx) > 3 || abs32(m.Y[i]-my) > 3 {
				continue
			}
			out.X[i], out.Y[i] = m.X[i], m.Y[i]
		}
	})
	return out
}

func (m *Map) quality() Quality {
	var q Quality
	bw, bh := (m.ProjW+15)/16, (m.ProjH+15)/16
	hit := make([]bool, bw*bh)
	for i := range m.X {
		if m.Valid(i) {
			q.ValidPixels++
			hit[int(m.Y[i])/16*bw+int(m.X[i])/16] = true
		}
	}
	n := 0
	for _, v := range hit {
		if v {
			n++
		}
	}
	q.Coverage = float64(n) / float64(len(hit))
	var res []float64
	const bs = 16
	for by := 0; by+bs <= m.H; by += bs {
		for bx := 0; bx+bs <= m.W; bx += bs {
			var src, dst []Pt
			for y := by; y < by+bs; y++ {
				for x := bx; x < bx+bs; x++ {
					if i := y*m.W + x; m.Valid(i) {
						src = append(src, Pt{float64(x), float64(y)})
						dst = append(dst, Pt{float64(m.X[i]), float64(m.Y[i])})
					}
				}
			}
			if len(src) < 24 {
				continue
			}
			a, ok := fitAffine(src, dst)
			if !ok {
				continue
			}
			var s float64
			for k := range src {
				p := a.apply(src[k])
				s += (p.X-dst[k].X)*(p.X-dst[k].X) + (p.Y-dst[k].Y)*(p.Y-dst[k].Y)
			}
			res = append(res, math.Sqrt(s/float64(len(src))))
		}
	}
	if len(res) > 0 {
		q.ErrorPx = median(res)
	}
	return q
}

// Lookup is the projector point lighting camera point (u, v), given in original still pixels. It fits a local affine
// map over the valid pixels of a 7x7 window (dropping residuals over 1.5 px and refitting), and falls back to the
// nearest valid pixel within 6 decode px.
func (m *Map) Lookup(u, v float64) (Pt, bool) {
	x := u * float64(m.W) / float64(m.CamW)
	y := v * float64(m.H) / float64(m.CamH)
	cx, cy := int(math.Floor(x)), int(math.Floor(y))
	var src, dst []Pt
	for yy := cy - 3; yy <= cy+3; yy++ {
		for xx := cx - 3; xx <= cx+3; xx++ {
			if xx < 0 || yy < 0 || xx >= m.W || yy >= m.H {
				continue
			}
			if i := yy*m.W + xx; m.Valid(i) {
				src = append(src, Pt{float64(xx) + 0.5, float64(yy) + 0.5})
				dst = append(dst, Pt{float64(m.X[i]), float64(m.Y[i])})
			}
		}
	}
	q := Pt{x, y}
	if len(src) >= 6 {
		if a, ok := fitAffine(src, dst); ok {
			var s2, d2 []Pt
			for k := range src {
				if a.apply(src[k]).dist(dst[k]) <= 1.5 {
					s2, d2 = append(s2, src[k]), append(d2, dst[k])
				}
			}
			if len(s2) >= 6 {
				if a2, ok := fitAffine(s2, d2); ok {
					a = a2
				}
			}
			if len(s2) >= 6 || len(s2) == len(src) {
				return a.apply(q), true
			}
		}
	}
	best, bestD := -1, math.MaxFloat64
	for yy := cy - 6; yy <= cy+6; yy++ {
		for xx := cx - 6; xx <= cx+6; xx++ {
			if xx < 0 || yy < 0 || xx >= m.W || yy >= m.H {
				continue
			}
			i := yy*m.W + xx
			if !m.Valid(i) {
				continue
			}
			if d := math.Hypot(float64(xx)+0.5-x, float64(yy)+0.5-y); d < bestD && d <= 6 {
				best, bestD = i, d
			}
		}
	}
	if best < 0 {
		return Pt{}, false
	}
	return Pt{float64(m.X[best]), float64(m.Y[best])}, true
}

// luminance is the image as 0..1 luma, row-major over its bounds.
func luminance(img image.Image) []float32 {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	out := make([]float32, w*h)
	switch t := img.(type) {
	case *image.Gray:
		for y := 0; y < h; y++ {
			row := t.Pix[y*t.Stride:]
			for x := 0; x < w; x++ {
				out[y*w+x] = float32(row[x]) / 255
			}
		}
	case *image.YCbCr:
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				out[y*w+x] = float32(t.Y[t.YOffset(b.Min.X+x, b.Min.Y+y)]) / 255
			}
		}
	case *image.RGBA:
		for y := 0; y < h; y++ {
			row := t.Pix[y*t.Stride:]
			for x := 0; x < w; x++ {
				p := row[x*4:]
				out[y*w+x] = (0.299*float32(p[0]) + 0.587*float32(p[1]) + 0.114*float32(p[2])) / 255
			}
		}
	case *image.NRGBA:
		for y := 0; y < h; y++ {
			row := t.Pix[y*t.Stride:]
			for x := 0; x < w; x++ {
				p := row[x*4:]
				out[y*w+x] = (0.299*float32(p[0]) + 0.587*float32(p[1]) + 0.114*float32(p[2])) / 255
			}
		}
	default:
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				r, g, bb, _ := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
				out[y*w+x] = (0.299*float32(r) + 0.587*float32(g) + 0.114*float32(bb)) / 65535
			}
		}
	}
	return out
}

// downscale area-averages a sw x sh buffer to w x h (a copy when the sizes match).
func downscale(src []float32, sw, sh, w, h int) []float32 {
	if sw == w && sh == h {
		return src
	}
	out := make([]float32, w*h)
	for y := 0; y < h; y++ {
		y0, y1 := y*sh/h, (y+1)*sh/h
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := 0; x < w; x++ {
			x0, x1 := x*sw/w, (x+1)*sw/w
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var s float32
			for yy := y0; yy < y1; yy++ {
				for xx := x0; xx < x1; xx++ {
					s += src[yy*sw+xx]
				}
			}
			out[y*w+x] = s / float32((y1-y0)*(x1-x0))
		}
	}
	return out
}

func median32(v []float32) float32 {
	s := append([]float32(nil), v...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

func median(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

func abs32(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}
