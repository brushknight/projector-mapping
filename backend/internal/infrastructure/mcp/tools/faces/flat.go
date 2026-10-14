package faces

import (
	"bytes"
	"context"
	"image"
	"io/fs"
	"math"
	"sort"
	"strings"

	"projmap/internal/catalog"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/unfold"
	"projmap/internal/infrastructure/mcp/tools"
	"projmap/internal/infrastructure/mcp/tools/raster"
)

// flat is the built-in fallback renderer: a face's content (object layers through the atlas, its own layers, its
// drawing layers) and its details, without a browser. It records what it could not draw.
type flat struct {
	ctx     context.Context
	e       *tools.Env
	sc      *scene.Scene
	media   map[string]image.Image
	atlases map[string]*image.RGBA
	skipped map[string]bool
}

func newFlat(ctx context.Context, e *tools.Env, sc *scene.Scene) *flat {
	return &flat{ctx: ctx, e: e, sc: sc, media: map[string]image.Image{}, atlases: map[string]*image.RGBA{}, skipped: map[string]bool{}}
}

func (f *flat) skippedList() []string {
	out := make([]string, 0, len(f.skipped))
	for k := range f.skipped {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// load decodes a media layer's source (asset:<sha> or a scenery id); nil when it cannot (video, SVG, missing).
func (f *flat) load(l scene.ContentLayer) image.Image {
	if img, ok := f.media[l.Src]; ok {
		return img
	}
	var img image.Image
	var b []byte
	var err error
	if l.Media == "video" {
		f.skipped["video layer "+l.Name] = true
	} else if sha, ok := strings.CutPrefix(l.Src, "asset:"); ok {
		b, err = f.e.D.Assets.Read(f.ctx, sha)
	} else {
		b, err = fs.ReadFile(catalog.Assets(), "scenery/"+l.Src+".jpg")
	}
	if err == nil && len(b) > 0 {
		if dec, _, derr := image.Decode(bytes.NewReader(b)); derr == nil {
			img = dec
		} else {
			f.skipped["picture "+l.Name+" (not PNG or JPEG)"] = true
		}
	}
	f.media[l.Src] = img
	return img
}

func (f *flat) layer(dst *image.RGBA, l scene.ContentLayer) {
	if l.Kind == scene.ContentMedia {
		raster.Layer(dst, l, f.load(l))
		return
	}
	raster.Layer(dst, l, nil)
}

// objectAtlas draws an object's layers on its atlas canvas (at most 1024 px), or nil when it has none.
func (f *flat) objectAtlas(o *scene.Object, atlas scene.Atlas) (*image.RGBA, float64) {
	k := math.Min(1, 1024/math.Max(atlas.Width, atlas.Height))
	if img, ok := f.atlases[o.ID]; ok {
		return img, k
	}
	var img *image.RGBA
	for _, l := range o.Layers {
		if !l.Visible || l.Opacity <= 0 {
			continue
		}
		if img == nil {
			img = raster.New(int(math.Round(atlas.Width*k)), int(math.Round(atlas.Height*k)), nil)
		}
		f.layer(img, l)
	}
	f.atlases[o.ID] = img
	return img, k
}

// content is a surface's own content on a transparent W×H canvas of its UV square.
func (f *flat) content(o *scene.Object, sf *scene.Surface, W, H int) *image.RGBA {
	img := raster.New(W, H, nil)
	if sf.Kind == "line" || sf.Kind == "mask" {
		return img
	}
	atlas, _ := unfold.Resolve(f.sc, o)
	if a, k := f.objectAtlas(o, atlas); a != nil {
		if aff, ok := unfold.Affines(f.sc, o, atlas)[sf.ID]; ok {
			// atlas canvas px → content px: invert uv → atlas px (scaled by k)
			m := invert(raster.Aff{O: raster.Vec{aff.O[0] * k, aff.O[1] * k}, X: raster.Vec{aff.U[0] * k / float64(W), aff.U[1] * k / float64(W)},
				Y: raster.Vec{aff.V[0] * k / float64(H), aff.V[1] * k / float64(H)}})
			raster.Place(img, a, m, nil)
		}
	}
	for _, l := range sf.Layers {
		f.layer(img, l)
	}
	size := 1.0
	if g := unfold.SurfaceGeometry(f.sc, sf); g != nil {
		size = g.Size[0]
	}
	for _, ef := range sf.Effects {
		if !ef.Enabled {
			continue
		}
		if ef.Effect != "drawing" {
			f.skipped["effect "+ef.Effect] = true
			continue
		}
		rv := 1.0
		if v, ok := ef.Params["reveal"].(float64); ok {
			rv = v
		}
		raster.Strokes(img, raster.ParseStrokes(ef.Params["strokes"]), float64(W)/math.Max(1, size), rv)
	}
	return img
}

// detailsOn composites the details of sf onto its W×H content image.
func (f *flat) detailsOn(img *image.RGBA, o *scene.Object, sf *scene.Surface, W, H int) {
	for i := range o.Surfaces {
		d := &o.Surfaces[i]
		if d.ParentID == nil || *d.ParentID != sf.ID || !d.Visible || d.Kind == "line" || d.Kind == "mask" {
			continue
		}
		to := unfold.InParent(f.sc, d, sf)
		if to == nil {
			continue
		}
		px := func(u, v float64) raster.Vec {
			p := to(u, v)
			return raster.Vec{p[0] * float64(W), p[1] * float64(H)}
		}
		o0, ou, ov := px(0, 0), px(1, 0), px(0, 1)
		U := raster.Vec{ou[0] - o0[0], ou[1] - o0[1]}
		V := raster.Vec{ov[0] - o0[0], ov[1] - o0[1]}
		dw, dh := max(8, int(math.Round(math.Hypot(U[0], U[1])))), max(8, int(math.Round(math.Hypot(V[0], V[1]))))
		c := f.content(o, d, dw, dh)
		var clip []raster.Vec
		for _, p := range detailShape(f.sc, d, sf) {
			clip = append(clip, raster.Vec{p[0] * float64(W), p[1] * float64(H)})
		}
		raster.Place(img, c, raster.Aff{O: o0, X: raster.Vec{U[0] / float64(dw), U[1] / float64(dw)}, Y: raster.Vec{V[0] / float64(dh), V[1] / float64(dh)}}, clip)
	}
}

// face is a face flat over black, with its details.
func (f *flat) face(o *scene.Object, sf *scene.Surface, W, H int) *image.RGBA {
	img := raster.New(W, H, raster.Black)
	c := f.content(o, sf, W, H)
	raster.Place(img, c, raster.Aff{X: raster.Vec{1, 0}, Y: raster.Vec{0, 1}}, nil)
	f.detailsOn(img, o, sf, W, H)
	return img
}

// unfold is the object's atlas over black, each face (with its details) through its rect.
func (f *flat) unfold(o *scene.Object, atlas scene.Atlas, W, H int) *image.RGBA {
	img := raster.New(W, H, raster.Black)
	k := float64(W) / atlas.Width
	affs := unfold.Affines(f.sc, o, atlas)
	for i := range o.Surfaces {
		sf := &o.Surfaces[i]
		a, ok := affs[sf.ID]
		if !ok || sf.ParentID != nil {
			continue
		}
		fw, fh := max(8, int(math.Round(a.Width()*k))), max(8, int(math.Round(a.Height()*k)))
		c := f.content(o, sf, fw, fh)
		f.detailsOn(c, o, sf, fw, fh)
		var clip []raster.Vec
		for _, p := range faceShape(f.sc, sf) {
			q := a.Apply(p[0], p[1])
			clip = append(clip, raster.Vec{q[0] * k, q[1] * k})
		}
		raster.Place(img, c, raster.Aff{O: raster.Vec{a.O[0] * k, a.O[1] * k}, X: raster.Vec{a.U[0] * k / float64(fw), a.U[1] * k / float64(fw)},
			Y: raster.Vec{a.V[0] * k / float64(fh), a.V[1] * k / float64(fh)}}, clip)
	}
	return img
}

// invert inverts an affine map.
func invert(a raster.Aff) raster.Aff {
	det := a.X[0]*a.Y[1] - a.X[1]*a.Y[0]
	if math.Abs(det) < 1e-12 {
		return raster.Aff{X: raster.Vec{1, 0}, Y: raster.Vec{0, 1}}
	}
	ix := raster.Vec{a.Y[1] / det, -a.X[1] / det}
	iy := raster.Vec{-a.Y[0] / det, a.X[0] / det}
	o := raster.Vec{-(ix[0]*a.O[0] + iy[0]*a.O[1]), -(ix[1]*a.O[0] + iy[1]*a.O[1])}
	return raster.Aff{O: o, X: ix, Y: iy}
}
