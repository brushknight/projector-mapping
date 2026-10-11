package vision

import (
	"image"
	"math"
)

// EdgeError is the measured misalignment of one projected edge against the physical edge next to it.
type EdgeError struct {
	Index int `json:"index"`
	// ErrorPx is the distance in projector pixels (-1 when too few samples were found).
	ErrorPx float64 `json:"errorPx"`
	Samples int     `json:"samples"`
	// OffsetCam is the signed median offset in camera pixels along the edge normal.
	OffsetCam float64 `json:"offsetCamPx"`
}

// gray is a full-resolution 0..1 luminance buffer.
type gray struct {
	w, h int
	v    []float32
}

func newGray(img image.Image) gray {
	b := img.Bounds()
	return gray{b.Dx(), b.Dy(), luminance(img)}
}

// at samples bilinearly at camera point (u, v) in pixel coordinates (pixel centres at i+0.5); 0 outside.
func (g gray) at(p Pt) float64 {
	x, y := p.X-0.5, p.Y-0.5
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	if x0 < 0 || y0 < 0 || x0+1 >= g.w || y0+1 >= g.h {
		return 0
	}
	fx, fy := x-float64(x0), y-float64(y0)
	i := y0*g.w + x0
	a := float64(g.v[i])*(1-fx) + float64(g.v[i+1])*fx
	b := float64(g.v[i+g.w])*(1-fx) + float64(g.v[i+g.w+1])*fx
	return a*(1-fy) + b*fy
}

// MeasureAlignment compares projected outlines with physical edges. lines is a still with only the outline lit on
// black, lit one with the projector full white, edges the outline's edges in physical projector px. For samples along
// each edge it predicts the camera position through inv, finds the bright line within ±12 camera px across the edge,
// checks through m that the line is the one drawn there, then finds the strongest brightness step in lit within
// ±20 px of it. The offset converts to projector px with the local scale along the edge; the median wins.
func MeasureAlignment(lines, lit image.Image, m *Map, inv *InverseMap, edges [][2]Pt) []EdgeError {
	L, W := newGray(lines), newGray(lit)
	out := make([]EdgeError, len(edges))
	for ei, e := range edges {
		out[ei] = EdgeError{Index: ei, ErrorPx: -1}
		length := e[0].dist(e[1])
		if length < 4 {
			continue
		}
		dir := e[1].sub(e[0]).mul(1 / length)
		n := int(math.Max(8, length/4))
		var offs, scales []float64
		for s := 0; s < n; s++ {
			p := lerp(e[0], e[1], 0.15+0.7*(float64(s)+0.5)/float64(n))
			q, ok1 := inv.Lookup(p.X, p.Y)
			q2, ok2 := inv.Lookup(p.X+dir.X*4, p.Y+dir.Y*4)
			if !ok1 || !ok2 {
				continue
			}
			dq := q2.sub(q)
			dl := math.Hypot(dq.X, dq.Y)
			if dl < 1e-6 {
				continue
			}
			t := dq.mul(1 / dl)
			nq := Pt{-t.Y, t.X}
			sL, ok := linePeak(L, q, nq)
			if !ok {
				continue
			}
			lp := q.add(nq.mul(sL))
			if pp, ok := m.Lookup(lp.X, lp.Y); ok && pp.dist(p) > 8 {
				continue
			}
			sE, ok := strongestStep(W, lp, nq)
			if !ok {
				continue
			}
			offs = append(offs, sE)
			scales = append(scales, 4/dl)
		}
		if len(offs) < 3 {
			out[ei].Samples = 0
			continue
		}
		off := median(offs)
		out[ei] = EdgeError{Index: ei, ErrorPx: math.Round(math.Abs(off)*median(scales)*100) / 100, Samples: len(offs),
			OffsetCam: math.Round(off*100) / 100}
	}
	return out
}

// linePeak is the offset (±12 px along n) of the bright line nearest to q: among local maxima reaching 70% of the
// brightest above the floor, the closest one, refined with a parabola.
func linePeak(g gray, q, n Pt) (float64, bool) {
	const steps = 24 // ±12 px in 0.5 px steps
	var v [2*steps + 1]float64
	lo, hi := math.MaxFloat64, -1.0
	for k := -steps; k <= steps; k++ {
		x := g.at(q.add(n.mul(float64(k) * 0.5)))
		v[k+steps] = x
		lo, hi = math.Min(lo, x), math.Max(hi, x)
	}
	if hi-lo < 0.08 {
		return 0, false
	}
	cut := lo + 0.7*(hi-lo)
	best := -1
	for k := 1; k < len(v)-1; k++ {
		if v[k] >= cut && v[k] >= v[k-1] && v[k] >= v[k+1] {
			if best < 0 || math.Abs(float64(k-steps)) < math.Abs(float64(best-steps)) {
				best = k
			}
		}
	}
	if best < 0 {
		return 0, false
	}
	s := float64(best-steps) * 0.5
	if d := v[best-1] - 2*v[best] + v[best+1]; d < 0 {
		s += 0.5 * 0.5 * (v[best-1] - v[best+1]) / d
	}
	return s, true
}

// strongestStep is the offset (±20 px along n) of the largest brightness step in g around p.
func strongestStep(g gray, p, n Pt) (float64, bool) {
	const steps = 40
	var v [2*steps + 1]float64
	for k := -steps; k <= steps; k++ {
		s := float64(k) * 0.5
		v[k+steps] = math.Abs(g.at(p.add(n.mul(s+1))) - g.at(p.add(n.mul(s-1))))
	}
	best := 0
	for k := range v {
		if v[k] > v[best] {
			best = k
		}
	}
	if v[best] < 0.02 {
		return 0, false
	}
	s := float64(best-steps) * 0.5
	if best > 0 && best < len(v)-1 {
		if d := v[best-1] - 2*v[best] + v[best+1]; d < 0 {
			s += 0.5 * 0.5 * (v[best-1] - v[best+1]) / d
		}
	}
	return s, true
}
