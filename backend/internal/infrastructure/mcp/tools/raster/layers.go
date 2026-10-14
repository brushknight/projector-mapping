package raster

import (
	"image"
	"image/color"
	"math"
	"sort"

	"golang.org/x/image/draw"
	"golang.org/x/image/math/f64"
	"golang.org/x/image/vector"

	"projmap/internal/domain/scene"
)

// RGBA converts any image to premultiplied RGBA.
func RGBA(img image.Image) *image.RGBA {
	if r, ok := img.(*image.RGBA); ok && r.Bounds().Min == (image.Point{}) {
		return r
	}
	b := img.Bounds()
	out := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), img, b.Min, draw.Src)
	return out
}

// sample reads src at (x, y) in px, bilinear, premultiplied 0..1.
func sample(src *image.RGBA, x, y float64) [4]float64 {
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	x -= 0.5
	y -= 0.5
	x0, y0 := math.Floor(x), math.Floor(y)
	fx, fy := x-x0, y-y0
	var out [4]float64
	for j := 0; j < 2; j++ {
		for i := 0; i < 2; i++ {
			px := min(max(int(x0)+i, 0), w-1)
			py := min(max(int(y0)+j, 0), h-1)
			wt := (1 - math.Abs(float64(i)-fx)) * (1 - math.Abs(float64(j)-fy))
			o := src.PixOffset(px, py)
			for c := 0; c < 4; c++ {
				out[c] += wt * float64(src.Pix[o+c]) / 255
			}
		}
	}
	return out
}

// blend composites a premultiplied source pixel onto dst at offset o with a blend mode, like the renderer's GL
// blending (normal: over; multiply: s·d + d·(1 − sa); screen: s + d·(1 − s); add: s + d).
func blend(dst *image.RGBA, o int, s [4]float64, mode string) {
	var d [4]float64
	for c := 0; c < 4; c++ {
		d[c] = float64(dst.Pix[o+c]) / 255
	}
	var r [4]float64
	for c := 0; c < 3; c++ {
		switch mode {
		case "multiply":
			r[c] = s[c]*d[c] + d[c]*(1-s[3])
		case "screen":
			r[c] = s[c] + d[c]*(1-s[c])
		case "add":
			r[c] = s[c] + d[c]
		default:
			r[c] = s[c] + d[c]*(1-s[3])
		}
	}
	if mode == "normal" || mode == "" {
		r[3] = s[3] + d[3]*(1-s[3])
	} else {
		r[3] = d[3] // GL keeps the destination alpha for these modes
	}
	for c := 0; c < 4; c++ {
		dst.Pix[o+c] = uint8(math.Round(math.Max(0, math.Min(1, r[c])) * 255))
	}
}

func stopsAt(stops []scene.GradientStop, t float64) [3]float64 {
	col := func(s scene.GradientStop) [3]float64 {
		c := Hex(s.Color)
		return [3]float64{float64(c.R) / 255, float64(c.G) / 255, float64(c.B) / 255}
	}
	c := col(stops[0])
	for i := 1; i < len(stops); i++ {
		a, b := stops[i-1].Pos, stops[i].Pos
		f := math.Max(0, math.Min(1, (t-a)/math.Max(b-a, 1e-5)))
		n := col(stops[i])
		for k := 0; k < 3; k++ {
			c[k] += (n[k] - c[k]) * f
		}
	}
	return c
}

// Layer draws one content layer (media or gradient, protocol §12) onto dst, the layer's canvas. media is the
// decoded source of a media layer (nil skips it).
func Layer(dst *image.RGBA, l scene.ContentLayer, media image.Image) {
	if !l.Visible || l.Opacity <= 0 || l.Reveal <= 0 {
		return
	}
	W, H := float64(dst.Bounds().Dx()), float64(dst.Bounds().Dy())
	rot := l.Rotation * math.Pi / 180
	cs, sn := math.Cos(rot), math.Sin(rot)
	scale := math.Max(l.Scale, 1e-4)
	ra := l.RevealAngle * math.Pi / 180
	rd := [2]float64{math.Cos(ra), math.Sin(ra)}
	edge := 1.5 / math.Max(W, H)
	var src *image.RGBA
	var box [2]float64
	crop := scene.Crop{X: 0, Y: 0, W: 1, H: 1}
	if l.Kind == scene.ContentMedia {
		if media == nil {
			return
		}
		src = RGBA(media)
		if l.Crop != nil {
			crop = *l.Crop
		}
		crop.W, crop.H = math.Max(crop.W, 1e-4), math.Max(crop.H, 1e-4)
		tw, th := float64(src.Bounds().Dx()), float64(src.Bounds().Dy())
		aS := (tw * crop.W) / math.Max(th*crop.H, 1e-5)
		aC := W / H
		box = [2]float64{W, H}
		switch l.Fit {
		case "fit":
			if aS > aC {
				box = [2]float64{W, W / aS}
			} else {
				box = [2]float64{H * aS, H}
			}
		case "stretch":
		default:
			if aS > aC {
				box = [2]float64{H * aS, H}
			} else {
				box = [2]float64{W, W / aS}
			}
		}
	}
	var stops []scene.GradientStop
	angle, offset, repeat := 0.0, 0.0, false
	if l.Kind == scene.ContentGradient {
		stops = append(stops, l.Stops...)
		sort.SliceStable(stops, func(i, j int) bool { return stops[i].Pos < stops[j].Pos })
		if len(stops) == 0 {
			stops = []scene.GradientStop{{Color: "#ffffff"}}
		}
		if l.Angle != nil {
			angle = *l.Angle * math.Pi / 180
		}
		if l.Offset != nil {
			offset = *l.Offset
		}
		repeat = l.Repeat != nil && *l.Repeat
	}
	gd := [2]float64{math.Cos(angle), math.Sin(angle)}
	for py := 0; py < int(H); py++ {
		for px := 0; px < int(W); px++ {
			c := [2]float64{(float64(px) + 0.5) / W, (float64(py) + 0.5) / H}
			m := l.Opacity
			if l.Reveal < 0.9999 {
				s := ((c[0]-0.5)*rd[0]+(c[1]-0.5)*rd[1])/math.Max(0.5*(math.Abs(rd[0])+math.Abs(rd[1])), 1e-5)*0.5 + 0.5
				m *= 1 - smoothstep(l.Reveal-edge, l.Reveal+edge, s)
			}
			if m <= 0 {
				continue
			}
			qx := c[0]*W - (W*0.5 + l.X*W)
			qy := c[1]*H - (H*0.5 + l.Y*H)
			qx, qy = (cs*qx+sn*qy)/scale, (-sn*qx+cs*qy)/scale
			o := dst.PixOffset(px, py)
			if l.Kind == scene.ContentGradient {
				lx, ly := qx/W, qy/H
				t := (lx*gd[0]+ly*gd[1])/math.Max(0.5*(math.Abs(gd[0])+math.Abs(gd[1])), 1e-5)*0.5 + 0.5 - offset
				if repeat {
					t -= math.Floor(t)
				} else {
					t = math.Max(0, math.Min(1, t))
				}
				col := stopsAt(stops, t)
				blend(dst, o, [4]float64{col[0] * m, col[1] * m, col[2] * m, m}, l.Blend)
				continue
			}
			lx, ly := qx/box[0]+0.5, qy/box[1]+0.5
			if lx < 0 || ly < 0 || lx > 1 || ly > 1 {
				continue
			}
			sx := (crop.X + lx*crop.W) * float64(src.Bounds().Dx())
			sy := (crop.Y + ly*crop.H) * float64(src.Bounds().Dy())
			p := sample(src, sx, sy)
			blend(dst, o, [4]float64{p[0] * m, p[1] * m, p[2] * m, p[3] * m}, l.Blend)
		}
	}
}

func smoothstep(a, b, x float64) float64 {
	t := math.Max(0, math.Min(1, (x-a)/(b-a)))
	return t * t * (3 - 2*t)
}

// Aff maps src px to dst px: dst = O + x·X + y·Y.
type Aff struct{ O, X, Y Vec }

// Place draws src onto dst through an affine (src px → dst px), clipped to a polygon in dst px when clip is set.
func Place(dst *image.RGBA, src image.Image, a Aff, clip []Vec) {
	s2d := f64.Aff3{a.X[0], a.Y[0], a.O[0], a.X[1], a.Y[1], a.O[1]}
	var opts *draw.Options
	if len(clip) >= 3 {
		mask := image.NewAlpha(dst.Bounds())
		z := vector.NewRasterizer(dst.Bounds().Dx(), dst.Bounds().Dy())
		z.MoveTo(float32(clip[0][0]), float32(clip[0][1]))
		for _, p := range clip[1:] {
			z.LineTo(float32(p[0]), float32(p[1]))
		}
		z.ClosePath()
		z.DrawOp = draw.Src
		z.Draw(mask, mask.Bounds(), image.Opaque, image.Point{})
		opts = &draw.Options{DstMask: mask}
	}
	draw.BiLinear.Transform(dst, s2d, src, src.Bounds(), draw.Over, opts)
}

// Black is the projector's black.
var Black = color.RGBA{0, 0, 0, 255}
