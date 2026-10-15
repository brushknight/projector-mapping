package vision

import (
	"image"
	"math"
	"testing"
)

// blurOutside returns img with everything outside keep blurred by a Gaussian of sigma px: a projector focused on
// one object, the rest of the desk out of focus.
func blurOutside(img image.Image, keep image.Rectangle, sigma float64) *image.Gray {
	g := img.(*image.Gray)
	b := g.Bounds()
	w, h := b.Dx(), b.Dy()
	r := int(math.Ceil(3 * sigma))
	k := make([]float64, 2*r+1)
	var sum float64
	for i := -r; i <= r; i++ {
		k[i+r] = math.Exp(-float64(i*i) / (2 * sigma * sigma))
		sum += k[i+r]
	}
	for i := range k {
		k[i] /= sum
	}
	tmp := make([]float64, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var s float64
			for i := -r; i <= r; i++ {
				xx := min(max(x+i, 0), w-1)
				s += k[i+r] * float64(g.Pix[y*g.Stride+xx])
			}
			tmp[y*w+x] = s
		}
	}
	out := image.NewGray(b)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if (image.Point{x, y}).In(keep) {
				out.Pix[y*out.Stride+x] = g.Pix[y*g.Stride+x]
				continue
			}
			var s float64
			for i := -r; i <= r; i++ {
				yy := min(max(y+i, 0), h-1)
				s += k[i+r] * tmp[yy*w+x]
			}
			out.Pix[y*out.Stride+x] = uint8(math.Round(s))
		}
	}
	return out
}

// TestDecodeSharpPatchInBlur: only a central patch is in focus. Inside it decodes to under 1.5 px; outside, pixels
// are dropped or flagged as coarse, never placed confidently in the wrong spot.
func TestDecodeSharpPatchInBlur(t *testing.T) {
	camQuad := []Pt{{20, 20}, {620, 30}, {610, 460}, {30, 450}}
	hm, err := FitHomography(camQuad, []Pt{{0, 0}, {640, 0}, {640, 400}, {0, 400}})
	if err != nil {
		t.Fatal(err)
	}
	w := &World{CamW: 640, CamH: 480, ProjW: 640, ProjH: 400, Ambient: 0.04,
		Planes: []Plane{{Name: "desk", Camera: []Pt{{0, 0}, {640, 0}, {640, 480}, {0, 480}}, H: hm, Albedo: 0.8}}}
	keep := image.Rect(220, 160, 420, 320)
	f := renderFrames(w, 0.01, 7)
	bl := func(img image.Image) image.Image { return blurOutside(img, keep, 12) }
	f.White, f.Black = bl(f.White), bl(f.Black)
	for i := range f.X {
		f.X[i] = [2]image.Image{bl(f.X[i][0]), bl(f.X[i][1])}
	}
	for i := range f.Y {
		f.Y[i] = [2]image.Image{bl(f.Y[i][0]), bl(f.Y[i][1])}
	}
	m, q, err := Decode(f, 640, 400, DecodeOptions{CamROI: keep})
	if err != nil {
		t.Fatal(err)
	}
	var inErr, inN, inside float64
	for y := keep.Min.Y; y < keep.Max.Y; y++ {
		for x := keep.Min.X; x < keep.Max.X; x++ {
			inside++
			i := y*m.W + x
			if !m.Valid(i) {
				continue
			}
			tp, ok := w.Truth(float64(x)+0.5, float64(y)+0.5)
			if !ok {
				continue
			}
			inErr += tp.dist(Pt{float64(m.X[i]), float64(m.Y[i])})
			inN++
		}
	}
	if inN/inside < 0.8 || inErr/inN >= 1.5 {
		t.Fatalf("inside: %.0f%% valid, mean error %.2f px", 100*inN/inside, inErr/inN)
	}
	if q.ROI.Sharp < 0.8 || q.ROI.ErrorPx >= 1.5 {
		t.Fatalf("roi quality %+v", q.ROI)
	}

	// the same pass without an ROI: outside the patch, nothing confident and wrong
	m, q, err = Decode(f, 640, 400, DecodeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	bad, outside, confident := 0, 0, 0
	grow := keep.Inset(-40) // the blur reaches into the patch's surroundings
	for y := 0; y < m.H; y++ {
		for x := 0; x < m.W; x++ {
			if (image.Point{x, y}).In(grow) {
				continue
			}
			outside++
			i := y*m.W + x
			if !m.Valid(i) {
				continue
			}
			tp, ok := w.Truth(float64(x)+0.5, float64(y)+0.5)
			if !ok {
				continue
			}
			lost := m.LostAt(i)
			if lost <= SharpLost {
				confident++
			}
			if tp.dist(Pt{float64(m.X[i]), float64(m.Y[i])}) > float64(int(1)<<lost)+2 {
				bad++
			}
		}
	}
	if float64(confident)/float64(outside) > 0.02 || float64(bad)/float64(outside) > 0.01 {
		t.Fatalf("outside: %d confident, %d wrong of %d", confident, bad, outside)
	}
	// over the whole lit frame (no ROI), most of it is blurred: the quality says so
	if q.ROI.Sharp > 0.4 || q.ROI.Lit == 0 {
		t.Fatalf("whole-frame quality %+v, want the blur to show", q.ROI)
	}
}
