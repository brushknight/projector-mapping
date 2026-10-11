package vision

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"math"
)

// The map PNG is 16-bit RGBA, one row taller than the map. Row 0 is a header: pixel 0 holds CamW, CamH, ProjW, ProjH
// in R, G, B, A; pixel 1 holds the magic 'PM', 'AP' and the format version. Every other pixel is one decode pixel:
// R = x·16 and G = y·16 (1/16 px fixed point), B = 65535 when valid (R = G = 65535, B = 0 when not), A = 65535.
const (
	mapMagicR, mapMagicG = 0x504D, 0x4150
	mapVersion           = 1
)

// EncodePNG stores m as a 16-bit PNG (see the format above).
func EncodePNG(m *Map) ([]byte, error) {
	if m.W < 2 {
		return nil, errors.New("vision: map too small to encode")
	}
	img := image.NewNRGBA64(image.Rect(0, 0, m.W, m.H+1))
	img.SetNRGBA64(0, 0, color.NRGBA64{uint16(m.CamW), uint16(m.CamH), uint16(m.ProjW), uint16(m.ProjH)})
	img.SetNRGBA64(1, 0, color.NRGBA64{mapMagicR, mapMagicG, mapVersion, 65535})
	for y := 0; y < m.H; y++ {
		for x := 0; x < m.W; x++ {
			i := y*m.W + x
			c := color.NRGBA64{65535, 65535, 0, 65535}
			if m.Valid(i) {
				c = color.NRGBA64{fixed16(m.X[i]), fixed16(m.Y[i]), 65535, 65535}
			}
			img.SetNRGBA64(x, y+1, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func fixed16(v float32) uint16 { return uint16(math.Min(65534, math.Round(float64(v)*16))) }

// DecodePNG reads a map written by EncodePNG.
func DecodePNG(b []byte) (*Map, error) {
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	bd := img.Bounds()
	at := func(x, y int) color.NRGBA64 {
		return color.NRGBA64Model.Convert(img.At(bd.Min.X+x, bd.Min.Y+y)).(color.NRGBA64)
	}
	if bd.Dx() < 2 || bd.Dy() < 2 {
		return nil, errors.New("vision: not a projmap map")
	}
	if mg := at(1, 0); mg.R != mapMagicR || mg.G != mapMagicG || mg.B != mapVersion {
		return nil, errors.New("vision: not a projmap map")
	}
	h := at(0, 0)
	m := &Map{W: bd.Dx(), H: bd.Dy() - 1, CamW: int(h.R), CamH: int(h.G), ProjW: int(h.B), ProjH: int(h.A)}
	m.X, m.Y = make([]float32, m.W*m.H), make([]float32, m.W*m.H)
	for y := 0; y < m.H; y++ {
		for x := 0; x < m.W; x++ {
			c := at(x, y+1)
			i := y*m.W + x
			if c.B == 0 {
				m.X[i], m.Y[i] = -1, -1
				continue
			}
			m.X[i], m.Y[i] = float32(c.R)/16, float32(c.G)/16
		}
	}
	return m, nil
}
