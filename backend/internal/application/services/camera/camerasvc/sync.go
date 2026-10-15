package camerasvc

import (
	"image"
	"time"
)

// MaxSettle is the longest wait the calibration learns between a pattern and its capture.
var MaxSettle = 1500 * time.Millisecond

// syncCheck tells a fresh still from a stale one: over the pixels the projector lights (white − black above the
// threshold), a new pattern should change the picture by a good part of the local white − black.
type syncCheck struct {
	idx []int     // sampled pixel offsets in the lit area
	amp []float32 // white − black there
}

const syncStride = 3

func newSyncCheck(white, black *image.Gray, threshold float64) *syncCheck {
	r := white.Bounds()
	sc := &syncCheck{}
	th := float32(threshold)
	for y := 0; y < r.Dy(); y += syncStride {
		for x := 0; x < r.Dx(); x += syncStride {
			w := float32(white.Pix[y*white.Stride+x]) / 255
			b := float32(black.Pix[y*black.Stride+x]) / 255
			if d := w - b; d >= th && d > 0 {
				sc.idx = append(sc.idx, y*white.Stride+x)
				sc.amp = append(sc.amp, d)
			}
		}
	}
	return sc
}

// changed is the share of the lit area where cur differs from prev by more than 35 % of white − black.
func (sc *syncCheck) changed(prev, cur *image.Gray) float64 {
	if len(sc.idx) == 0 || prev.Bounds() != cur.Bounds() || len(prev.Pix) != len(cur.Pix) {
		return 1
	}
	n := 0
	for k, i := range sc.idx {
		d := float32(int(cur.Pix[i])-int(prev.Pix[i])) / 255
		if d < 0 {
			d = -d
		}
		if d > 0.35*sc.amp[k] {
			n++
		}
	}
	return float64(n) / float64(len(sc.idx))
}

// grayF is a gray image as 0..1 floats, row-major.
func grayF(g *image.Gray) []float32 {
	r := g.Bounds()
	out := make([]float32, r.Dx()*r.Dy())
	for y := 0; y < r.Dy(); y++ {
		row := g.Pix[y*g.Stride:]
		for x := 0; x < r.Dx(); x++ {
			out[y*r.Dx()+x] = float32(row[x]) / 255
		}
	}
	return out
}
