package vision

import (
	"errors"
	"math"
	"math/rand"
)

// Pt is a 2D point (camera or projector pixels).
type Pt struct{ X, Y float64 }

func (p Pt) add(q Pt) Pt         { return Pt{p.X + q.X, p.Y + q.Y} }
func (p Pt) sub(q Pt) Pt         { return Pt{p.X - q.X, p.Y - q.Y} }
func (p Pt) mul(s float64) Pt    { return Pt{p.X * s, p.Y * s} }
func (p Pt) dist(q Pt) float64   { return math.Hypot(p.X-q.X, p.Y-q.Y) }
func lerp(a, b Pt, t float64) Pt { return Pt{a.X + (b.X-a.X)*t, a.Y + (b.Y-a.Y)*t} }
func (p Pt) finite() bool {
	return !math.IsNaN(p.X) && !math.IsNaN(p.Y) && !math.IsInf(p.X, 0) && !math.IsInf(p.Y, 0)
}

// Homography is a row-major 3x3 projective transform.
type Homography [9]float64

// ErrDegenerate means the points do not determine a transform (too few, collinear or coincident).
var ErrDegenerate = errors.New("vision: degenerate point set")

// Apply maps p through h.
func (h Homography) Apply(p Pt) Pt {
	w := h[6]*p.X + h[7]*p.Y + h[8]
	if w == 0 {
		return Pt{math.NaN(), math.NaN()}
	}
	return Pt{(h[0]*p.X + h[1]*p.Y + h[2]) / w, (h[3]*p.X + h[4]*p.Y + h[5]) / w}
}

// Inverse is h⁻¹ (adjugate over determinant), scaled so its last entry is 1 when possible.
func (h Homography) Inverse() (Homography, error) {
	a, b, c, d, e, f, g, hh, i := h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]
	A := e*i - f*hh
	B := -(d*i - f*g)
	C := d*hh - e*g
	det := a*A + b*B + c*C
	if math.Abs(det) < 1e-15 {
		return Homography{}, ErrDegenerate
	}
	inv := Homography{A, -(b*i - c*hh), b*f - c*e, B, a*i - c*g, -(a*f - c*d), C, -(a*hh - b*g), a*e - b*d}
	for k := range inv {
		inv[k] /= det
	}
	return inv.normalized(), nil
}

func (h Homography) normalized() Homography {
	if math.Abs(h[8]) > 1e-12 {
		s := h[8]
		for k := range h {
			h[k] /= s
		}
	}
	return h
}

func mul3(a, b Homography) Homography {
	var r Homography
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			r[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j]
		}
	}
	return r
}

// normalizing is Hartley's conditioning: centroid to the origin, mean distance √2.
func normalizing(pts []Pt) Homography {
	var cx, cy float64
	for _, p := range pts {
		cx += p.X
		cy += p.Y
	}
	n := float64(len(pts))
	cx, cy = cx/n, cy/n
	var d float64
	for _, p := range pts {
		d += math.Hypot(p.X-cx, p.Y-cy)
	}
	d /= n
	if d < 1e-12 {
		d = 1
	}
	s := math.Sqrt2 / d
	return Homography{s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1}
}

// FitHomography is the least-squares homography mapping src onto dst (normalised DLT with h₃₃ = 1); at least 4 pairs.
func FitHomography(src, dst []Pt) (Homography, error) {
	n := len(src)
	if n < 4 || len(dst) != n {
		return Homography{}, ErrDegenerate
	}
	ts, td := normalizing(src), normalizing(dst)
	var ata [8][8]float64
	var atb [8]float64
	for k := 0; k < n; k++ {
		s, d := ts.Apply(src[k]), td.Apply(dst[k])
		r1 := [8]float64{s.X, s.Y, 1, 0, 0, 0, -d.X * s.X, -d.X * s.Y}
		r2 := [8]float64{0, 0, 0, s.X, s.Y, 1, -d.Y * s.X, -d.Y * s.Y}
		for i := 0; i < 8; i++ {
			for j := 0; j < 8; j++ {
				ata[i][j] += r1[i]*r1[j] + r2[i]*r2[j]
			}
			atb[i] += r1[i]*d.X + r2[i]*d.Y
		}
	}
	a := make([][]float64, 8)
	for i := range a {
		a[i] = ata[i][:]
	}
	x, ok := solve(a, atb[:])
	if !ok {
		return Homography{}, ErrDegenerate
	}
	hn := Homography{x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], 1}
	tdi, err := td.Inverse()
	if err != nil {
		return Homography{}, err
	}
	return mul3(tdi, mul3(hn, ts)).normalized(), nil
}

// solve solves a·x = b by Gaussian elimination with partial pivoting (a and b are copied).
func solve(a [][]float64, b []float64) ([]float64, bool) {
	n := len(b)
	m := make([][]float64, n)
	var scale float64
	for i := range a {
		m[i] = append(append([]float64(nil), a[i]...), b[i])
		for _, v := range a[i] {
			scale = math.Max(scale, math.Abs(v))
		}
	}
	if scale == 0 {
		return nil, false
	}
	for c := 0; c < n; c++ {
		p := c
		for r := c + 1; r < n; r++ {
			if math.Abs(m[r][c]) > math.Abs(m[p][c]) {
				p = r
			}
		}
		if math.Abs(m[p][c]) < 1e-12*scale {
			return nil, false
		}
		m[c], m[p] = m[p], m[c]
		for r := c + 1; r < n; r++ {
			f := m[r][c] / m[c][c]
			if f == 0 {
				continue
			}
			for k := c; k <= n; k++ {
				m[r][k] -= f * m[c][k]
			}
		}
	}
	x := make([]float64, n)
	for r := n - 1; r >= 0; r-- {
		s := m[r][n]
		for k := r + 1; k < n; k++ {
			s -= m[r][k] * x[k]
		}
		x[r] = s / m[r][r]
	}
	return x, true
}

// RANSACHomography fits a homography robustly: minimal 4-point samples, the model with the most pairs within thresh
// (transfer error in dst units), refit on its inliers. rng nil uses a fixed seed.
func RANSACHomography(src, dst []Pt, iters int, thresh float64, rng *rand.Rand) (Homography, []bool, error) {
	n := len(src)
	if n < 4 || len(dst) != n {
		return Homography{}, nil, ErrDegenerate
	}
	if rng == nil {
		rng = rand.New(rand.NewSource(1))
	}
	if iters <= 0 {
		iters = 200
	}
	t2 := thresh * thresh
	count := func(h Homography, mask []bool) int {
		c := 0
		for k := 0; k < n; k++ {
			p := h.Apply(src[k])
			dx, dy := p.X-dst[k].X, p.Y-dst[k].Y
			in := dx*dx+dy*dy < t2
			if mask != nil {
				mask[k] = in
			}
			if in {
				c++
			}
		}
		return c
	}
	best, bestH := -1, Homography{}
	var s4, d4 [4]Pt
	for it := 0; it < iters; it++ {
		idx := pick4(rng, n)
		for k, i := range idx {
			s4[k], d4[k] = src[i], dst[i]
		}
		h, err := FitHomography(s4[:], d4[:])
		if err != nil {
			continue
		}
		if c := count(h, nil); c > best {
			best, bestH = c, h
		}
	}
	if best < 4 {
		return Homography{}, nil, ErrDegenerate
	}
	mask := make([]bool, n)
	h := bestH
	for round := 0; round < 2; round++ {
		count(h, mask)
		var si, di []Pt
		for k := 0; k < n; k++ {
			if mask[k] {
				si, di = append(si, src[k]), append(di, dst[k])
			}
		}
		hr, err := FitHomography(si, di)
		if err != nil {
			break
		}
		h = hr
	}
	count(h, mask)
	return h, mask, nil
}

func pick4(rng *rand.Rand, n int) [4]int {
	var idx [4]int
	for k := 0; k < 4; k++ {
	again:
		v := rng.Intn(n)
		for j := 0; j < k; j++ {
			if idx[j] == v {
				goto again
			}
		}
		idx[k] = v
	}
	return idx
}

// affine is x' = a0·x + a1·y + a2, y' = a3·x + a4·y + a5.
type affine [6]float64

func (a affine) apply(p Pt) Pt { return Pt{a[0]*p.X + a[1]*p.Y + a[2], a[3]*p.X + a[4]*p.Y + a[5]} }

// fitAffine is the least-squares affine map src→dst, conditioned around the src centroid.
func fitAffine(src, dst []Pt) (affine, bool) {
	n := len(src)
	if n < 3 {
		return affine{}, false
	}
	var cx, cy float64
	for _, p := range src {
		cx += p.X
		cy += p.Y
	}
	cx, cy = cx/float64(n), cy/float64(n)
	var sxx, sxy, syy, sx, sy float64
	var bx, by [3]float64
	for k, p := range src {
		x, y := p.X-cx, p.Y-cy
		sxx += x * x
		sxy += x * y
		syy += y * y
		sx += x
		sy += y
		bx[0] += x * dst[k].X
		bx[1] += y * dst[k].X
		bx[2] += dst[k].X
		by[0] += x * dst[k].Y
		by[1] += y * dst[k].Y
		by[2] += dst[k].Y
	}
	a := [][]float64{{sxx, sxy, sx}, {sxy, syy, sy}, {sx, sy, float64(n)}}
	px, ok1 := solve(a, bx[:])
	py, ok2 := solve(a, by[:])
	if !ok1 || !ok2 {
		return affine{}, false
	}
	// undo the centring: x' = px0 (x-cx) + px1 (y-cy) + px2
	return affine{px[0], px[1], px[2] - px[0]*cx - px[1]*cy, py[0], py[1], py[2] - py[0]*cx - py[1]*cy}, true
}
