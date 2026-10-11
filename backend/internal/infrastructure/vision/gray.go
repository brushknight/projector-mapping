// Package vision is projmap's camera math: the Gray-code patterns of a calibration pass (protocol §7), the decoder
// that turns the captured stills into a dense camera→projector map, the sparse inverse, homographies and RANSAC, plane
// segmentation into candidate surfaces, the alignment check, and a synthetic world (a desk with a cube) that tests and
// `projmap sim` use as a fake camera. Pure Go, standard library only.
package vision

import "image"

// Bits is the number of Gray-code bits for n columns (or rows): ceil(log2(n)), at least 1.
func Bits(n int) int {
	b := 1
	for (1 << b) < n {
		b++
	}
	return b
}

// PatternOn reports whether column (or row) c is white for the given bit: Gray code g = c ^ (c >> 1), white when
// ((g >> bit) & 1) == 1, XORed with inverse.
func PatternOn(c, bit int, inverse bool) bool {
	g := c ^ (c >> 1)
	return ((g>>bit)&1 == 1) != inverse
}

// GrayPattern draws one pattern in physical framebuffer pixels: axis "x" varies by column, "y" by row.
func GrayPattern(w, h int, axis string, bit int, inverse bool) *image.Gray {
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		row := img.Pix[y*img.Stride : y*img.Stride+w]
		for x := 0; x < w; x++ {
			c := x
			if axis == "y" {
				c = y
			}
			if PatternOn(c, bit, inverse) {
				row[x] = 255
			}
		}
	}
	return img
}

// PatternFunc returns the projector intensity function (0..1 at physical projector px, 0 outside the framebuffer)
// for an output.pattern request on a w x h framebuffer: kind "gray" (with axis, bit, inverse), "white", "black", or
// "off", which stands in for normal rendering with a dim 0.15 fill.
func PatternFunc(kind, axis string, bit int, inverse bool, w, h int) func(px, py float64) float64 {
	fw, fh := float64(w), float64(h)
	inside := func(px, py float64) bool { return px >= 0 && py >= 0 && px < fw && py < fh }
	switch kind {
	case "gray":
		return func(px, py float64) float64 {
			if !inside(px, py) {
				return 0
			}
			c := int(px)
			if axis == "y" {
				c = int(py)
			}
			if PatternOn(c, bit, inverse) {
				return 1
			}
			return 0
		}
	case "white":
		return func(px, py float64) float64 {
			if inside(px, py) {
				return 1
			}
			return 0
		}
	case "black":
		return func(float64, float64) float64 { return 0 }
	default:
		return func(px, py float64) float64 {
			if inside(px, py) {
				return 0.15
			}
			return 0
		}
	}
}
