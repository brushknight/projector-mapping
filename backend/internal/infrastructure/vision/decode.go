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
	// MaxWidth is the decode width; wider stills are area-averaged down to it (default 1600).
	MaxWidth int
	// MinContrast, when > 0, is a fixed least white−black difference (0..1) for a pixel to count as lit. By default
	// the threshold adapts to the frame: 4× the noise of the difference image (its MAD below the Otsu split between
	// lit and unlit), at least 3/255, so a projector that is only a little brighter than a lit room still decodes.
	MinContrast float64
	// MaxLostBits is how many of the finest bits may be unreadable (blurred: pattern and inverse too close) before a
	// pixel gets no correspondence; a pixel that lost k bits is placed at the centre of its 2^k px interval
	// (default 4, so at worst ±8 px). Negative = 0.
	MaxLostBits int
	// CamROI, when not empty, limits decoding to this rectangle of the original still (camera pixels).
	CamROI image.Rectangle
	// ProjROI, when not empty, drops correspondences outside this rectangle of physical projector pixels.
	ProjROI image.Rectangle
}

// Quality summarises a decoded map.
type Quality struct {
	// Coverage is the fraction of 16x16 projector blocks hit by at least one valid camera pixel.
	Coverage float64 `json:"coverage"`
	// ErrorPx is the decode noise in projector px: the RMS residual of a local affine fit per 16x16 camera block,
	// median over blocks.
	ErrorPx     float64 `json:"errorPx"`
	ValidPixels int     `json:"validPixels"`
	// Contrast is how strongly the projector shows in the camera (white − black).
	Contrast Contrast `json:"contrast"`
	// Sharp is the share of valid pixels that read every bit but at most the last (SharpLost): in focus.
	Sharp float64 `json:"sharp"`
	// ROI is the quality inside the region of interest (the whole frame when none was given).
	ROI ROIQuality `json:"roi"`
}

// Contrast describes the white − black difference image (0–255 levels).
type Contrast struct {
	// Lit is the share of the frame the projector visibly lights.
	Lit float64 `json:"lit"`
	// Median and Peak (99th percentile) of the difference over lit pixels; Room is the median black level there.
	Median float64 `json:"median"`
	Peak   float64 `json:"peak"`
	Room   float64 `json:"room"`
	// Noise is the noise of the difference image and Threshold the level a pixel needs to count as lit.
	Noise     float64 `json:"noise"`
	Threshold float64 `json:"threshold"`
}

// BrighterPct is how much brighter the projected light makes the room, in percent (peak over the room level).
func (c Contrast) BrighterPct() float64 { return 100 * c.Peak / math.Max(c.Room, 4) }

// MeasureContrast finds the lit pixels in a white − black pair (0..1 luma buffers, w × h): a 3×3 box blur of the
// difference, an Otsu split between lit and unlit, and a noise floor of 4× the unlit side's MAD (σ-scaled).
func MeasureContrast(white, black []float32, w, h int, fixed float64) (Contrast, []float32, float32) {
	n := w * h
	d := make([]float32, n)
	for i := range d {
		d[i] = white[i] - black[i]
	}
	bl := make([]float32, n)
	parallelRows(h, func(y int) {
		for x := 0; x < w; x++ {
			var s float32
			c := 0
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					xx, yy := x+dx, y+dy
					if xx < 0 || yy < 0 || xx >= w || yy >= h {
						continue
					}
					s += d[yy*w+xx]
					c++
				}
			}
			bl[y*w+x] = s / float32(c)
		}
	})
	// Otsu over [0, max]
	const bins = 256
	var hist [bins]int
	maxD := float32(1e-6)
	for _, v := range bl {
		if v > maxD {
			maxD = v
		}
	}
	for _, v := range bl {
		if v <= 0 {
			hist[0]++
			continue
		}
		hist[min(bins-1, int(v/maxD*(bins-1)))]++
	}
	var sumAll float64
	for i, c := range hist {
		sumAll += float64(i * c)
	}
	var wB, sumB, best float64
	split := 0
	for i, c := range hist {
		wB += float64(c)
		if wB == 0 || wB == float64(n) {
			continue
		}
		sumB += float64(i * c)
		mB, mF := sumB/wB, (sumAll-sumB)/(float64(n)-wB)
		if v := wB * (float64(n) - wB) * (mB - mF) * (mB - mF); v > best {
			best, split = v, i
		}
	}
	otsu := float32(split) / (bins - 1) * maxD
	var low []float64
	for _, v := range bl {
		if v < otsu {
			low = append(low, float64(v))
		}
	}
	noise := 1.0 / 255
	if len(low) > 16 {
		med := median(low)
		dev := make([]float64, len(low))
		for i, v := range low {
			dev[i] = math.Abs(v - med)
		}
		noise = math.Max(0.5/255, 1.4826*median(dev))
	}
	th := float32(math.Max(4*noise, 3.0/255))
	if fixed > 0 {
		th = float32(fixed)
	}
	var lit, room []float64
	for i, v := range bl {
		if v >= th {
			lit = append(lit, float64(v))
			room = append(room, float64(black[i]))
		}
	}
	c := Contrast{Lit: float64(len(lit)) / float64(n), Noise: noise * 255, Threshold: float64(th) * 255}
	if len(lit) > 0 {
		c.Median, c.Room = median(lit)*255, median(room)*255
		sort.Float64s(lit)
		c.Peak = lit[int(float64(len(lit)-1)*0.99)] * 255
	}
	return c, bl, float32(noise)
}

// ROIQuality is the quality inside the region of interest, over the camera pixels the projector lights there.
type ROIQuality struct {
	// Mapped is the share of lit pixels with a correspondence; Sharp the share at full precision.
	Mapped float64 `json:"mapped"`
	Sharp  float64 `json:"sharp"`
	// ErrorPx is the median block residual (projector px) over full-precision pixels inside it.
	ErrorPx float64 `json:"errorPx"`
	// Lit is the number of decode pixels the projector lights inside it.
	Lit int `json:"lit"`
}

// Map is the dense camera→projector correspondence at decode resolution.
type Map struct {
	W, H         int // decode resolution
	CamW, CamH   int // the original still size
	ProjW, ProjH int // the physical projector framebuffer
	// X and Y are the projector coordinates (pixel centres) per decode pixel, row-major; < 0 = invalid.
	X, Y []float32
	// Lost is, per decode pixel, how many of the finest bits were unreadable (0 = full precision); nil = all 0.
	Lost []uint8
	// Bits is the number of bits per axis (the most precision a pixel can have).
	Bits int
}

// SharpLost is the most lost bits a pixel may have and still count as sharp: the 1 px stripes of the last bit are
// usually finer than a camera pixel, in focus or not.
const SharpLost = 1

// LostAt is decode pixel i's lost bits.
func (m *Map) LostAt(i int) uint8 {
	if m.Lost == nil {
		return 0
	}
	return m.Lost[i]
}

// Valid reports whether decode pixel i has a correspondence.
func (m *Map) Valid(i int) bool { return m.X[i] >= 0 && m.Y[i] >= 0 }

// Decode turns a calibration pass into a Map: per pixel, white−black must reach MinContrast, every bit compares the
// pattern with its inverse (more than two ambiguous bits per axis invalidate the pixel), Gray decodes to binary, and
// a 3x3 median check drops pixels more than 3 px from their neighbourhood.
func Decode(f Frames, projW, projH int, opt DecodeOptions) (*Map, Quality, error) {
	if opt.MaxWidth <= 0 {
		opt.MaxWidth = 1600
	}
	if opt.MaxLostBits == 0 {
		// A phone across the room sees about one camera pixel per two projector pixels, so the 1–4 px stripes blur
		// (a real run: 0 % decoded at 2, 68 % at 4). Keep pixels that read all but the 4 finest bits (±8 px); the
		// alignment check and nudges refine from there.
		opt.MaxLostBits = 4
	} else if opt.MaxLostBits < 0 {
		opt.MaxLostBits = 0
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

	nb := nx
	if ny > nb {
		nb = ny
	}
	raw := &Map{W: w, H: h, CamW: camW, CamH: camH, ProjW: projW, ProjH: projH,
		X: make([]float32, w*h), Y: make([]float32, w*h), Lost: make([]uint8, w*h), Bits: nb}
	// axis reads one coordinate. Bits whose pattern and inverse differ by less than amb are unreadable. A run of
	// unreadable bits from the LSB up is blur (the stripes are finer than the focus): those bits are dropped and the
	// pixel sits at the centre of the interval the readable bits leave. One more unreadable bit above that run is a
	// stripe edge (Gray code changes one bit there) and keeps its sign, as before.
	axis := func(fr [][]float32, n, i int, amb float32) (float32, int, bool) {
		g, lost, other := 0, 0, 0
		run := true
		for k := 0; k < n; k++ {
			d := fr[2*k][i] - fr[2*k+1][i]
			if d > 0 {
				g |= 1 << k
			}
			weak := d < amb && d > -amb
			if weak && run {
				lost++
				continue
			}
			run = false
			if weak {
				other++
			}
		}
		if lost > opt.MaxLostBits || other > 1 || lost >= n {
			return 0, lost, false
		}
		b := grayToBinary(g>>lost) << lost
		return float32(b) + float32(int(1)<<lost)/2, lost, true
	}
	contrast, diff, noise := MeasureContrast(white, black, w, h, opt.MinContrast)
	// The adaptive threshold and noise come from the difference image, whose "unlit" side also holds the soft falloff
	// at the projection's edges; in a dark room that overstates the noise several times over (a real run measured
	// 31/255 and asked for 124/255 of light and a 43 % swing per bit, rejecting every readable pixel). Cap both: a pixel
	// counts when the projector adds 24/255, and a bit is readable when pattern − inverse clears 15 % of the local
	// white − black and at least 8/255.
	minC := min(float32(contrast.Threshold/255), 24.0/255)
	if opt.MinContrast > 0 {
		minC = float32(opt.MinContrast)
	}
	ambFloor := min(float32(2.5*math.Sqrt2*float64(noise)), 8.0/255)
	sx, sy := float64(w)/float64(camW), float64(h)/float64(camH)
	var roi image.Rectangle
	if !opt.CamROI.Empty() {
		roi = image.Rect(int(math.Floor(float64(opt.CamROI.Min.X)*sx)), int(math.Floor(float64(opt.CamROI.Min.Y)*sy)),
			int(math.Ceil(float64(opt.CamROI.Max.X)*sx)), int(math.Ceil(float64(opt.CamROI.Max.Y)*sy))).Intersect(image.Rect(0, 0, w, h))
	}
	parallelRows(h, func(y int) {
		for x := 0; x < w; x++ {
			i := y*w + x
			raw.X[i], raw.Y[i] = -1, -1
			if !roi.Empty() && !(image.Point{x, y}).In(roi) {
				continue
			}
			c := diff[i]
			if c < minC {
				continue
			}
			amb := max(0.15*(white[i]-black[i]), ambFloor)
			cx, lx, okx := axis(xs, nx, i, amb)
			cy, ly, oky := axis(ys, ny, i, amb)
			if !okx || !oky || int(cx) >= projW || int(cy) >= projH {
				continue
			}
			if !opt.ProjROI.Empty() && !(image.Point{int(cx), int(cy)}).In(opt.ProjROI) {
				continue
			}
			raw.X[i], raw.Y[i] = cx, cy
			raw.Lost[i] = uint8(max(lx, ly))
		}
	})
	m := medianFilter(raw)
	q := m.quality()
	q.Contrast = contrast
	if roi.Empty() {
		roi = image.Rect(0, 0, w, h)
	}
	q.ROI = m.roiQuality(roi, diff, minC)
	if q.ValidPixels == 0 {
		return m, q, errors.New("vision: no pixel decoded (is the projection in frame and the room dim?)")
	}
	return m, q, nil
}

// roiQuality measures the region of interest (decode pixels).
func (m *Map) roiQuality(roi image.Rectangle, diff []float32, minC float32) ROIQuality {
	var r ROIQuality
	mapped, sharp := 0, 0
	for y := roi.Min.Y; y < roi.Max.Y; y++ {
		for x := roi.Min.X; x < roi.Max.X; x++ {
			i := y*m.W + x
			if diff[i] < minC {
				continue
			}
			r.Lit++
			if m.Valid(i) {
				mapped++
				if m.LostAt(i) <= SharpLost {
					sharp++
				}
			}
		}
	}
	if r.Lit > 0 {
		r.Mapped, r.Sharp = float64(mapped)/float64(r.Lit), float64(sharp)/float64(r.Lit)
	}
	r.ErrorPx = m.blockError(roi)
	return r
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
		X: make([]float32, len(m.X)), Y: make([]float32, len(m.Y)), Lost: m.Lost, Bits: m.Bits}
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
			tol := 3 + float32(int(1)<<m.LostAt(i)) // a coarse pixel sits on a staircase
			if abs32(m.X[i]-mx) > tol || abs32(m.Y[i]-my) > tol {
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
	sharp := 0
	for i := range m.X {
		if m.Valid(i) {
			q.ValidPixels++
			if m.LostAt(i) <= SharpLost {
				sharp++
			}
			if j := int(m.Y[i])/16*bw + int(m.X[i])/16; j >= 0 && j < len(hit) {
				hit[j] = true
			}
		}
	}
	if q.ValidPixels > 0 {
		q.Sharp = float64(sharp) / float64(q.ValidPixels)
	}
	n := 0
	for _, v := range hit {
		if v {
			n++
		}
	}
	q.Coverage = float64(n) / float64(len(hit))
	q.ErrorPx = m.blockError(image.Rect(0, 0, m.W, m.H))
	return q
}

// blockError is the decode noise inside r: the RMS residual of a local affine fit per 16x16 camera block over its
// full-precision pixels, median over blocks.
func (m *Map) blockError(r image.Rectangle) float64 {
	var res []float64
	const bs = 16
	for by := r.Min.Y; by+bs <= r.Max.Y; by += bs {
		for bx := r.Min.X; bx+bs <= r.Max.X; bx += bs {
			var src, dst []Pt
			for y := by; y < by+bs; y++ {
				for x := bx; x < bx+bs; x++ {
					if i := y*m.W + x; m.Valid(i) && m.LostAt(i) <= SharpLost {
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
	return median(res)
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
