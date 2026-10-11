package vision

import (
	"math"
	"math/rand"
	"sort"
)

// Candidate is a planar region found in a calibration map, offered as a surface.
type Candidate struct {
	// Camera is the outline in original still pixels, clockwise from the top-left-most vertex.
	Camera []Pt `json:"camera"`
	// Projector holds the same vertices in physical projector pixels (through the region's homography).
	Projector  []Pt    `json:"projector"`
	Confidence float64 `json:"confidence"`
	AreaCamPx  float64 `json:"areaCamPx"`
	// Kind is "quad" when the outline simplifies to 4 points, else "poly".
	Kind string `json:"kind"`
}

// DetectOptions tune DetectSurfaces; zero values take the defaults.
type DetectOptions struct {
	Block     int     // block size in decode px (default 16)
	MinBlocks int     // smallest region kept, in blocks (default 6)
	Thresh    float64 // transfer error in projector px (default 1.5)
}

type region struct {
	blocks  []int
	model   func(Pt) Pt // decode-pixel centre → projector
	h       Homography  // final homography, decode px → projector
	inliers float64
}

// DetectSurfaces segments the map into planes: a RANSAC affine fit per block marks the planar blocks, regions grow
// from the best blocks while a neighbour's pixels agree with the region's model (median transfer error < Thresh),
// each region gets a RANSAC homography, pixels near a region join the one region that explains them, and each
// region's outline is its convex hull simplified to a quad (when a 4-gon covers 92% of the hull) or to at most 8
// points. Largest first.
func DetectSurfaces(m *Map, opt DetectOptions) []Candidate {
	if opt.Block <= 0 {
		opt.Block = 16
	}
	if opt.MinBlocks <= 0 {
		opt.MinBlocks = 6
	}
	if opt.Thresh <= 0 {
		opt.Thresh = 1.5
	}
	bs := opt.Block
	bw, bh := (m.W+bs-1)/bs, (m.H+bs-1)/bs
	nb := bw * bh
	pix := make([][]int, nb)
	for y := 0; y < m.H; y++ {
		for x := 0; x < m.W; x++ {
			if i := y*m.W + x; m.Valid(i) {
				b := (y/bs)*bw + x/bs
				pix[b] = append(pix[b], i)
			}
		}
	}
	cam := func(i int) Pt { return Pt{float64(i%m.W) + 0.5, float64(i/m.W) + 0.5} }
	proj := func(i int) Pt { return Pt{float64(m.X[i]), float64(m.Y[i])} }

	// 1. planar blocks
	good := make([]bool, nb)
	score := make([]float64, nb)
	parallelRows(bh, func(by int) {
		rng := rand.New(rand.NewSource(int64(by) + 7))
		for bx := 0; bx < bw; bx++ {
			b := by*bw + bx
			if len(pix[b]) < bs*bs/2 {
				continue
			}
			r := blockInliers(pix[b], cam, proj, opt.Thresh, rng)
			score[b] = r
			good[b] = r >= 0.85
		}
	})

	// 2. region growing
	order := make([]int, 0, nb)
	for b := 0; b < nb; b++ {
		if good[b] {
			order = append(order, b)
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return score[order[i]] > score[order[j]] })
	label := make([]int, nb)
	for b := range label {
		label[b] = -1
	}
	var regions []*region
	for _, seed := range order {
		if label[seed] != -1 {
			continue
		}
		id := len(regions)
		r := &region{}
		add := func(b int) { r.blocks = append(r.blocks, b); label[b] = id }
		add(seed)
		r.model = fitRegion(r.blocks, pix, cam, proj)
		sinceFit := 0
		queue := neighbours(seed, bw, bh)
		for len(queue) > 0 {
			b := queue[0]
			queue = queue[1:]
			if !good[b] || label[b] != -1 || r.model == nil {
				continue
			}
			var errs []float64
			for _, i := range pix[b] {
				errs = append(errs, r.model(cam(i)).dist(proj(i)))
			}
			if median(errs) >= opt.Thresh {
				continue
			}
			add(b)
			sinceFit++
			if len(r.blocks) < 16 || sinceFit >= 8 {
				if mdl := fitRegion(r.blocks, pix, cam, proj); mdl != nil {
					r.model = mdl
				}
				sinceFit = 0
			}
			queue = append(queue, neighbours(b, bw, bh)...)
		}
		if len(r.blocks) < opt.MinBlocks {
			for _, b := range r.blocks {
				label[b] = -2 // tried: never a seed or member again
			}
			continue
		}
		regions = append(regions, r)
	}
	if len(regions) == 0 {
		return nil
	}

	// 3. a homography per region
	rng := rand.New(rand.NewSource(42))
	kept := regions[:0]
	for _, r := range regions {
		var src, dst []Pt
		for _, b := range r.blocks {
			for _, i := range pix[b] {
				src, dst = append(src, cam(i)), append(dst, proj(i))
			}
		}
		src, dst = subsample(src, dst, 1500, rng)
		h, in, err := RANSACHomography(src, dst, 150, opt.Thresh, rng)
		if err != nil {
			continue
		}
		r.h = h
		r.inliers = fraction(in)
		kept = append(kept, r)
	}
	regions = kept

	// 4. pixel membership near each region: exactly the one region explaining the pixel, or the best of several
	member := make([]int, m.W*m.H)
	for i := range member {
		member[i] = -1
	}
	owner := make([]int, nb)
	for b := range owner {
		owner[b] = -1
	}
	for ri, r := range regions {
		for _, b := range r.blocks {
			owner[b] = ri
		}
	}
	for b := 0; b < nb; b++ {
		near := map[int]bool{}
		bx, by := b%bw, b/bw
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				x, y := bx+dx, by+dy
				if x >= 0 && y >= 0 && x < bw && y < bh && owner[y*bw+x] >= 0 {
					near[owner[y*bw+x]] = true
				}
			}
		}
		if len(near) == 0 {
			continue
		}
		for _, i := range pix[b] {
			best, bestE, within := -1, math.MaxFloat64, 0
			for ri, r := range regions {
				e := r.h.Apply(cam(i)).dist(proj(i))
				if e < opt.Thresh {
					within++
				}
				if e < bestE {
					best, bestE = ri, e
				}
			}
			if best >= 0 && bestE < opt.Thresh && near[best] && (within == 1 || owner[b] == best) {
				member[i] = best
			}
		}
	}

	// 5. outlines
	sx, sy := float64(m.CamW)/float64(m.W), float64(m.CamH)/float64(m.H)
	var out []Candidate
	for ri, r := range regions {
		var pts []Pt
		for y := 1; y < m.H-1; y++ {
			for x := 1; x < m.W-1; x++ {
				i := y*m.W + x
				if member[i] != ri {
					continue
				}
				n := 0
				for dy := -1; dy <= 1; dy++ {
					for dx := -1; dx <= 1; dx++ {
						if (dx != 0 || dy != 0) && member[(y+dy)*m.W+x+dx] == ri {
							n++
						}
					}
				}
				if n >= 5 {
					pts = append(pts, cam(i))
				}
			}
		}
		if len(pts) < 3 {
			continue
		}
		hull := convexHull(pts)
		hullArea := polyArea(hull)
		if hullArea <= 0 {
			continue
		}
		simple := visvalingam(hull, 40)
		poly, kind := maxQuad(simple), "quad"
		if polyArea(poly) < 0.92*hullArea {
			poly, kind = visvalingam(simple, 8), "poly"
			if len(poly) == 4 {
				kind = "quad"
			}
		}
		poly = clockwiseFromTopLeft(poly)
		c := Candidate{Kind: kind, AreaCamPx: hullArea * sx * sy}
		for _, p := range poly {
			c.Projector = append(c.Projector, r.h.Apply(p))
			c.Camera = append(c.Camera, Pt{p.X * sx, p.Y * sy})
		}
		size := math.Min(1, float64(len(r.blocks))/float64(4*opt.MinBlocks))
		c.Confidence = math.Round((0.6*r.inliers+0.4*size)*1000) / 1000
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].AreaCamPx > out[j].AreaCamPx })
	return out
}

// blockInliers is the inlier fraction of the best affine model over a block (RANSAC on 3-point samples).
func blockInliers(idx []int, cam, proj func(int) Pt, thresh float64, rng *rand.Rand) float64 {
	n := len(idx)
	best := 0
	src, dst := make([]Pt, n), make([]Pt, n)
	for k, i := range idx {
		src[k], dst[k] = cam(i), proj(i)
	}
	for it := 0; it < 40; it++ {
		a, b, c := rng.Intn(n), rng.Intn(n), rng.Intn(n)
		if a == b || b == c || a == c {
			continue
		}
		af, ok := fitAffine([]Pt{src[a], src[b], src[c]}, []Pt{dst[a], dst[b], dst[c]})
		if !ok {
			continue
		}
		cnt := 0
		for k := range src {
			if af.apply(src[k]).dist(dst[k]) < thresh {
				cnt++
			}
		}
		if cnt > best {
			best = cnt
		}
	}
	// a least-squares refit often beats every minimal sample on quantised data
	if af, ok := fitAffine(src, dst); ok {
		cnt := 0
		for k := range src {
			if af.apply(src[k]).dist(dst[k]) < thresh {
				cnt++
			}
		}
		if cnt > best {
			best = cnt
		}
	}
	return float64(best) / float64(n)
}

// fitRegion is the region's current model: affine below 4 blocks, a least-squares homography from then on.
func fitRegion(blocks []int, pix [][]int, cam, proj func(int) Pt) func(Pt) Pt {
	var src, dst []Pt
	for _, b := range blocks {
		for _, i := range pix[b] {
			src, dst = append(src, cam(i)), append(dst, proj(i))
		}
	}
	src, dst = subsample(src, dst, 800, nil)
	if len(blocks) < 4 {
		a, ok := fitAffine(src, dst)
		if !ok {
			return nil
		}
		return a.apply
	}
	h, err := FitHomography(src, dst)
	if err != nil {
		return nil
	}
	return h.Apply
}

// subsample keeps at most n pairs, evenly strided (or randomly when rng is set).
func subsample(src, dst []Pt, n int, rng *rand.Rand) ([]Pt, []Pt) {
	if len(src) <= n {
		return src, dst
	}
	s2, d2 := make([]Pt, 0, n), make([]Pt, 0, n)
	if rng != nil {
		for _, k := range rng.Perm(len(src))[:n] {
			s2, d2 = append(s2, src[k]), append(d2, dst[k])
		}
		return s2, d2
	}
	step := float64(len(src)) / float64(n)
	for k := 0; k < n; k++ {
		j := int(float64(k) * step)
		s2, d2 = append(s2, src[j]), append(d2, dst[j])
	}
	return s2, d2
}

func fraction(mask []bool) float64 {
	n := 0
	for _, v := range mask {
		if v {
			n++
		}
	}
	return float64(n) / float64(len(mask))
}

func neighbours(b, bw, bh int) []int {
	x, y := b%bw, b/bw
	var out []int
	if x > 0 {
		out = append(out, b-1)
	}
	if x < bw-1 {
		out = append(out, b+1)
	}
	if y > 0 {
		out = append(out, b-bw)
	}
	if y < bh-1 {
		out = append(out, b+bw)
	}
	return out
}

func cross(o, a, b Pt) float64 { return (a.X-o.X)*(b.Y-o.Y) - (a.Y-o.Y)*(b.X-o.X) }

// convexHull is Andrew's monotone chain.
func convexHull(pts []Pt) []Pt {
	p := append([]Pt(nil), pts...)
	sort.Slice(p, func(i, j int) bool { return p[i].X < p[j].X || (p[i].X == p[j].X && p[i].Y < p[j].Y) })
	if len(p) < 3 {
		return p
	}
	h := make([]Pt, 0, 2*len(p))
	for _, q := range p {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], q) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	lower := len(h) + 1
	for i := len(p) - 2; i >= 0; i-- {
		q := p[i]
		for len(h) >= lower && cross(h[len(h)-2], h[len(h)-1], q) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	return h[:len(h)-1]
}

// polyArea is the absolute shoelace area.
func polyArea(p []Pt) float64 { return math.Abs(signedArea(p)) }

func signedArea(p []Pt) float64 {
	var s float64
	for i := range p {
		j := (i + 1) % len(p)
		s += p[i].X*p[j].Y - p[j].X*p[i].Y
	}
	return s / 2
}

// visvalingam drops the vertex spanning the smallest triangle until at most n remain.
func visvalingam(p []Pt, n int) []Pt {
	q := append([]Pt(nil), p...)
	for len(q) > n && len(q) > 3 {
		best, bestA := 0, math.MaxFloat64
		for i := range q {
			a := math.Abs(cross(q[(i+len(q)-1)%len(q)], q[i], q[(i+1)%len(q)]))
			if a < bestA {
				best, bestA = i, a
			}
		}
		q = append(q[:best], q[best+1:]...)
	}
	return q
}

// maxQuad is the largest-area quadrilateral on the polygon's vertices (convex, in order).
func maxQuad(p []Pt) []Pt {
	n := len(p)
	if n <= 4 {
		return append([]Pt(nil), p...)
	}
	best, bestA := [4]int{0, 1, 2, 3}, -1.0
	for a := 0; a < n; a++ {
		for b := a + 1; b < n; b++ {
			for c := b + 1; c < n; c++ {
				for d := c + 1; d < n; d++ {
					if ar := polyArea([]Pt{p[a], p[b], p[c], p[d]}); ar > bestA {
						best, bestA = [4]int{a, b, c, d}, ar
					}
				}
			}
		}
	}
	return []Pt{p[best[0]], p[best[1]], p[best[2]], p[best[3]]}
}

// clockwiseFromTopLeft orders the polygon clockwise on screen (y down) starting at the vertex with the least x+y.
func clockwiseFromTopLeft(p []Pt) []Pt {
	q := append([]Pt(nil), p...)
	if signedArea(q) < 0 {
		for i, j := 0, len(q)-1; i < j; i, j = i+1, j-1 {
			q[i], q[j] = q[j], q[i]
		}
	}
	start := 0
	for i, v := range q {
		if v.X+v.Y < q[start].X+q[start].Y {
			start = i
		}
	}
	return append(q[start:], q[:start]...)
}
