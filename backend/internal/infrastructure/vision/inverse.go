package vision

import "math"

// InverseMap is the sparse projector→camera map: per step x step projector cell, the camera point (original still
// pixels) that sees the cell's centre.
type InverseMap struct {
	Step, GW, GH int
	// U and V are camera coordinates per cell, row-major; < 0 = invalid.
	U, V         []float32
	ProjW, ProjH int
}

// Inverse builds the sparse inverse: a least-squares affine fit (camera as a function of projector) over the camera
// pixels decoding into each cell, evaluated at the cell centre (the mean when the fit is degenerate), then holes with
// at least three valid neighbours filled from them (two passes).
func (m *Map) Inverse(step int) *InverseMap {
	if step <= 0 {
		step = 8
	}
	gw, gh := (m.ProjW+step-1)/step, (m.ProjH+step-1)/step
	im := &InverseMap{Step: step, GW: gw, GH: gh, ProjW: m.ProjW, ProjH: m.ProjH,
		U: make([]float32, gw*gh), V: make([]float32, gw*gh)}
	src := make([][]Pt, gw*gh) // projector points
	dst := make([][]Pt, gw*gh) // camera points
	sx, sy := float64(m.CamW)/float64(m.W), float64(m.CamH)/float64(m.H)
	for y := 0; y < m.H; y++ {
		for x := 0; x < m.W; x++ {
			i := y*m.W + x
			if !m.Valid(i) {
				continue
			}
			c := int(m.Y[i])/step*gw + int(m.X[i])/step
			src[c] = append(src[c], Pt{float64(m.X[i]), float64(m.Y[i])})
			dst[c] = append(dst[c], Pt{(float64(x) + 0.5) * sx, (float64(y) + 0.5) * sy})
		}
	}
	for c := range im.U {
		im.U[c], im.V[c] = -1, -1
		n := len(src[c])
		if n == 0 {
			continue
		}
		centre := Pt{(float64(c%gw) + 0.5) * float64(step), (float64(c/gw) + 0.5) * float64(step)}
		var p Pt
		if a, ok := fitAffine(src[c], dst[c]); ok && n >= 4 {
			p = a.apply(centre)
		} else {
			for _, d := range dst[c] {
				p = p.add(d)
			}
			p = p.mul(1 / float64(n))
		}
		if p.finite() && p.X >= 0 && p.Y >= 0 {
			im.U[c], im.V[c] = float32(p.X), float32(p.Y)
		}
	}
	for pass := 0; pass < 2; pass++ {
		u2, v2 := append([]float32(nil), im.U...), append([]float32(nil), im.V...)
		for gy := 0; gy < gh; gy++ {
			for gx := 0; gx < gw; gx++ {
				c := gy*gw + gx
				if im.U[c] >= 0 {
					continue
				}
				var su, sv float32
				n := 0
				for dy := -1; dy <= 1; dy++ {
					for dx := -1; dx <= 1; dx++ {
						xx, yy := gx+dx, gy+dy
						if xx < 0 || yy < 0 || xx >= gw || yy >= gh {
							continue
						}
						if j := yy*gw + xx; im.U[j] >= 0 {
							su += im.U[j]
							sv += im.V[j]
							n++
						}
					}
				}
				if n >= 3 {
					u2[c], v2[c] = su/float32(n), sv/float32(n)
				}
			}
		}
		im.U, im.V = u2, v2
	}
	return im
}

// Lookup is the camera point that sees projector point (px, py): bilinear over the valid neighbouring cell centres.
func (im *InverseMap) Lookup(px, py float64) (Pt, bool) {
	gx := px/float64(im.Step) - 0.5
	gy := py/float64(im.Step) - 0.5
	x0, y0 := int(math.Floor(gx)), int(math.Floor(gy))
	fx, fy := gx-float64(x0), gy-float64(y0)
	var su, sv, sw float64
	for dy := 0; dy <= 1; dy++ {
		for dx := 0; dx <= 1; dx++ {
			x, y := x0+dx, y0+dy
			if x < 0 || y < 0 || x >= im.GW || y >= im.GH {
				continue
			}
			c := y*im.GW + x
			if im.U[c] < 0 {
				continue
			}
			w := (1 - math.Abs(float64(dx)-fx)) * (1 - math.Abs(float64(dy)-fy))
			su += w * float64(im.U[c])
			sv += w * float64(im.V[c])
			sw += w
		}
	}
	if sw < 1e-6 {
		return Pt{}, false
	}
	return Pt{su / sw, sv / sw}, true
}
