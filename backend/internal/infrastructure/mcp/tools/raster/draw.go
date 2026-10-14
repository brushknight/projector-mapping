// Package raster is a small pure-Go rasterizer for the flat side of the mapping, so agents can see templates and a
// basic face render without a browser: drawing strokes (the `drawing` effect, protocol §1), media and gradient
// content layers (protocol §12), outlines, grids and labels. The browser engine stays the reference renderer; this
// one approximates it (no GLSL or JS effects, no SVG pictures, a bitmap font for text).
package raster

import (
	"encoding/json"
	"image"
	"image/color"
	"math"
	"strconv"
	"strings"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

// Vec is a point in canvas px.
type Vec = [2]float64

// Stroke is one stroke of a drawing (protocol §1, effect drawing): points in surface UV, width and size in surface px.
type Stroke struct {
	Tool   string       `json:"tool"`
	Points [][2]float64 `json:"points"`
	Color  string       `json:"color"`
	Width  float64      `json:"width"`
	Fill   bool         `json:"fill,omitempty"`
	Text   string       `json:"text,omitempty"`
	Size   float64      `json:"size,omitempty"`
}

// ParseStrokes reads strokes from a drawing's params value (bad entries are dropped, like the renderer does).
func ParseStrokes(v any) []Stroke {
	b, _ := json.Marshal(v)
	var raw []json.RawMessage
	if json.Unmarshal(b, &raw) != nil {
		return nil
	}
	var out []Stroke
	for _, r := range raw {
		var s Stroke
		if json.Unmarshal(r, &s) == nil && s.Tool != "" && len(s.Points) > 0 {
			out = append(out, s)
		}
	}
	return out
}

// Hex parses #rrggbb (white when invalid).
func Hex(s string) color.RGBA {
	s = strings.TrimPrefix(s, "#")
	if len(s) != 6 {
		return color.RGBA{255, 255, 255, 255}
	}
	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return color.RGBA{255, 255, 255, 255}
	}
	return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 255}
}

// New is a canvas filled with c.
func New(w, h int, c color.Color) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, max(1, w), max(1, h)))
	if c != nil {
		draw.Draw(img, img.Bounds(), image.NewUniform(c), image.Point{}, draw.Src)
	}
	return img
}

func signedArea(p []Vec) float64 {
	a := 0.0
	for i := range p {
		j := (i + 1) % len(p)
		a += p[i][0]*p[j][1] - p[j][0]*p[i][1]
	}
	return a / 2
}

// Fill paints the union of polygons (each closed) with c, anti-aliased. Every polygon is turned to the same winding
// so overlaps add up instead of cancelling.
func Fill(dst draw.Image, polys [][]Vec, c color.Color) {
	b := dst.Bounds()
	x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range polys {
		for _, q := range p {
			x0, y0, x1, y1 = math.Min(x0, q[0]), math.Min(y0, q[1]), math.Max(x1, q[0]), math.Max(y1, q[1])
		}
	}
	r := image.Rect(int(math.Floor(x0))-1, int(math.Floor(y0))-1, int(math.Ceil(x1))+1, int(math.Ceil(y1))+1).Intersect(b)
	if r.Empty() {
		return
	}
	z := vector.NewRasterizer(r.Dx(), r.Dy())
	ox, oy := float64(r.Min.X), float64(r.Min.Y)
	for _, p := range polys {
		if len(p) < 3 {
			continue
		}
		pts := p
		if signedArea(p) < 0 {
			pts = make([]Vec, len(p))
			for i := range p {
				pts[i] = p[len(p)-1-i]
			}
		}
		z.MoveTo(float32(pts[0][0]-ox), float32(pts[0][1]-oy))
		for _, q := range pts[1:] {
			z.LineTo(float32(q[0]-ox), float32(q[1]-oy))
		}
		z.ClosePath()
	}
	z.Draw(dst, r, image.NewUniform(c), image.Point{})
}

// FillPolygon paints one polygon as given (its own winding, so a self-crossing outline fills like the browser's
// non-zero rule only approximately).
func FillPolygon(dst draw.Image, p []Vec, c color.Color) { Fill(dst, [][]Vec{p}, c) }

func disc(c Vec, r float64) []Vec {
	n := int(math.Max(12, math.Min(64, r*1.5)))
	out := make([]Vec, n)
	for i := range out {
		a := float64(i) / float64(n) * 2 * math.Pi
		out[i] = Vec{c[0] + r*math.Cos(a), c[1] + r*math.Sin(a)}
	}
	return out
}

// Disc paints a filled circle.
func Disc(dst draw.Image, c Vec, r float64, col color.Color) { Fill(dst, [][]Vec{disc(c, r)}, col) }

// Polyline strokes a path with round joins and caps, width lw px.
func Polyline(dst draw.Image, path []Vec, lw float64, closed bool, c color.Color) {
	if len(path) == 0 || lw <= 0 {
		return
	}
	hw := lw / 2
	var polys [][]Vec
	pts := path
	if closed && len(path) > 2 {
		pts = append(append([]Vec{}, path...), path[0])
	}
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		d := math.Hypot(b[0]-a[0], b[1]-a[1])
		if d < 1e-9 {
			continue
		}
		nx, ny := -(b[1]-a[1])/d*hw, (b[0]-a[0])/d*hw
		polys = append(polys, []Vec{{a[0] + nx, a[1] + ny}, {b[0] + nx, b[1] + ny}, {b[0] - nx, b[1] - ny}, {a[0] - nx, a[1] - ny}})
	}
	if hw >= 0.75 {
		for _, p := range pts {
			polys = append(polys, disc(p, hw))
		}
	} else if len(polys) == 0 {
		polys = append(polys, disc(pts[0], math.Max(hw, 0.5)))
	}
	Fill(dst, polys, c)
}

// Dashed strokes a path with dashes of on/off px.
func Dashed(dst draw.Image, path []Vec, lw float64, closed bool, on, off float64, c color.Color) {
	pts := path
	if closed && len(path) > 2 {
		pts = append(append([]Vec{}, path...), path[0])
	}
	pos, drawOn := 0.0, true
	left := on
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		d := math.Hypot(b[0]-a[0], b[1]-a[1])
		for pos < d {
			step := math.Min(left, d-pos)
			if drawOn {
				f0, f1 := pos/d, (pos+step)/d
				Polyline(dst, []Vec{{a[0] + (b[0]-a[0])*f0, a[1] + (b[1]-a[1])*f0}, {a[0] + (b[0]-a[0])*f1, a[1] + (b[1]-a[1])*f1}}, lw, false, c)
			}
			pos += step
			left -= step
			if left <= 1e-9 {
				drawOn = !drawOn
				left = map[bool]float64{true: on, false: off}[drawOn]
			}
		}
		pos -= d
	}
}

const ellipseSteps = 72

// StrokePath is a stroke's path in canvas px for a w×h canvas (rect closed, ellipse and circle as polygons); text
// has none. Circles take their radius in canvas px, so they stay round on any aspect.
func StrokePath(s Stroke, w, h float64) []Vec {
	p := make([]Vec, len(s.Points))
	for i, q := range s.Points {
		p[i] = Vec{q[0] * w, q[1] * h}
	}
	switch s.Tool {
	case "pen":
		return p
	case "line":
		if len(p) < 2 {
			return p
		}
		return p[:2]
	case "rect":
		if len(p) < 2 {
			return nil
		}
		a, b := p[0], p[1]
		return []Vec{a, {b[0], a[1]}, b, {a[0], b[1]}, a}
	case "ellipse":
		if len(p) < 2 {
			return nil
		}
		a, b := p[0], p[1]
		return ring((a[0]+b[0])/2, (a[1]+b[1])/2, math.Abs(b[0]-a[0])/2, math.Abs(b[1]-a[1])/2)
	case "circle":
		if len(p) < 2 {
			return nil
		}
		r := math.Hypot(p[1][0]-p[0][0], p[1][1]-p[0][1])
		return ring(p[0][0], p[0][1], r, r)
	case "polygon":
		if len(p) < 3 {
			return nil
		}
		return append(p, p[0])
	}
	return nil
}

func ring(cx, cy, rx, ry float64) []Vec {
	out := make([]Vec, 0, ellipseSteps+1)
	for i := 0; i <= ellipseSteps; i++ {
		t := float64(i)/ellipseSteps*math.Pi*2 - math.Pi/2
		out = append(out, Vec{cx + rx*math.Cos(t), cy + ry*math.Sin(t)})
	}
	return out
}

func pathLength(p []Vec) float64 {
	n := 0.0
	for i := 1; i < len(p); i++ {
		n += math.Hypot(p[i][0]-p[i-1][0], p[i][1]-p[i-1][1])
	}
	return n
}

func cutPath(p []Vec, upTo float64) []Vec {
	if len(p) == 0 {
		return p
	}
	out := []Vec{p[0]}
	left := upTo
	for i := 1; i < len(p); i++ {
		a, b := p[i-1], p[i]
		d := math.Hypot(b[0]-a[0], b[1]-a[1])
		if d <= left {
			out = append(out, b)
			left -= d
			continue
		}
		f := 0.0
		if d > 0 {
			f = left / d
		}
		out = append(out, Vec{a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f})
		break
	}
	return out
}

var fillable = map[string]bool{"rect": true, "ellipse": true, "polygon": true, "circle": true}

// Strokes draws strokes onto dst (a w×h canvas of a surface's content). k converts surface px (width, text size)
// to canvas px; reveal 0..1 draws the first fraction of the total length, like the renderer.
func Strokes(dst draw.Image, strokes []Stroke, k, reveal float64) {
	b := dst.Bounds()
	w, h := float64(b.Dx()), float64(b.Dy())
	lens := make([]float64, len(strokes))
	total := 0.0
	for i, s := range strokes {
		if s.Tool == "text" {
			lens[i] = TextWidth(s.Text, textSize(s)*k)
		} else {
			lens[i] = math.Max(pathLength(StrokePath(s, w, h)), math.Max(1, s.Width*k))
		}
		total += lens[i]
	}
	budget := math.Max(0, math.Min(1, reveal)) * total
	for i, s := range strokes {
		if budget <= 0 {
			break
		}
		frac := math.Min(1, budget/math.Max(lens[i], 1e-6))
		budget -= lens[i]
		c := Hex(s.Color)
		if s.Tool == "text" {
			if s.Text == "" || len(s.Points) == 0 {
				continue
			}
			text := s.Text
			if frac < 1 {
				n := int(float64(len([]rune(text))) * frac)
				text = string([]rune(text)[:n])
			}
			Text(dst, text, Vec{s.Points[0][0] * w, s.Points[0][1] * h}, textSize(s)*k, c, false)
			continue
		}
		path := StrokePath(s, w, h)
		if len(path) == 0 {
			continue
		}
		if s.Fill && frac >= 1 && fillable[s.Tool] {
			FillPolygon(dst, path, c)
		}
		lw := s.Width * k
		if lw <= 0 {
			continue
		}
		cut := path
		if frac < 1 {
			cut = cutPath(path, lens[i]*frac)
		}
		if len(cut) == 1 || pathLength(cut) < 0.01 {
			Disc(dst, cut[0], lw/2, c)
			continue
		}
		Polyline(dst, cut, lw, false, c)
	}
}

func textSize(s Stroke) float64 {
	if s.Size > 0 {
		return s.Size
	}
	return 48
}

// The bitmap font: 7×13 px cells, scaled to the asked height.
const (
	glyphW = 7
	glyphH = 13
)

// TextWidth is the width in px of text drawn size px tall.
func TextWidth(text string, size float64) float64 {
	return float64(len([]rune(text))) * glyphW * math.Max(size, 2) / glyphH
}

// Text draws text with its top left (or its centre when centred) at p, size px tall.
func Text(dst draw.Image, text string, p Vec, size float64, c color.Color, centred bool) {
	if text == "" {
		return
	}
	n := len([]rune(text))
	mask := image.NewAlpha(image.Rect(0, 0, n*glyphW, glyphH))
	d := &font.Drawer{Dst: mask, Src: image.Opaque, Face: basicfont.Face7x13, Dot: fixed.P(0, 11)}
	d.DrawString(text)
	s := math.Max(size, 2) / glyphH
	tw, th := int(math.Round(float64(n*glyphW)*s)), int(math.Round(glyphH*s))
	if tw <= 0 || th <= 0 {
		return
	}
	big := image.NewAlpha(image.Rect(0, 0, tw, th))
	scaler := draw.Interpolator(draw.ApproxBiLinear)
	if s >= 2 {
		scaler = draw.NearestNeighbor
	}
	scaler.Scale(big, big.Bounds(), mask, mask.Bounds(), draw.Src, nil)
	x, y := int(math.Round(p[0])), int(math.Round(p[1]))
	if centred {
		x, y = x-tw/2, y-th/2
	}
	draw.DrawMask(dst, image.Rect(x, y, x+tw, y+th), image.NewUniform(c), image.Point{}, big, image.Point{}, draw.Over)
}

// Label draws text centred at p on a dark plate, for templates.
func Label(dst draw.Image, text string, p Vec, size float64, fg, bg color.Color) {
	w := TextWidth(text, size)
	pad := size * 0.25
	FillPolygon(dst, []Vec{{p[0] - w/2 - pad, p[1] - size/2 - pad}, {p[0] + w/2 + pad, p[1] - size/2 - pad}, {p[0] + w/2 + pad, p[1] + size/2 + pad}, {p[0] - w/2 - pad, p[1] + size/2 + pad}}, bg)
	Text(dst, text, p, size, fg, true)
}
