package faces

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"math"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/unfold"
	"projmap/internal/infrastructure/mcp/tools"
	"projmap/internal/infrastructure/mcp/tools/raster"
	"projmap/internal/infrastructure/mcp/tools/render"
)

func registerLook(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "face_render", Title: "See a face flat",
		Description: "A PNG of one face's content flat (unwarped) at its real aspect, as the renderer draws it, from your draft: its " +
			"pictures, gradients, drawing layers, effects and its details inside it. At most 1280 px. Image x/width = u, y/height = v, " +
			"(0,0) top left = corner 1. with_outline adds the face outline, dashed detail outlines and the .25 UV grid. t is the " +
			"timeline time in seconds (default 0). Rendered by the editor or /out open in a browser on this Mac; without one, projmap " +
			"draws an approximation itself (drawings, gradients and PNG/JPEG pictures only) and says so."}, faceRender)
	tools.Add(s, env, &mcp.Tool{Name: "object_unfold_render", Title: "See an object's unfold",
		Description: "A PNG of the whole unfold (the object's atlas, faces edge to edge like a dieline) as the renderer draws it, from " +
			"your draft, with the face names. At most 1280 px. Use it to check that features line up across shared edges. Same " +
			"browser rule and fallback as face_render."}, unfoldRender)
	tools.Add(s, env, &mcp.Tool{Name: "face_template_get", Title: "See where you are drawing",
		Description: "A template image of a face (surface_id) or of a whole unfold (object_id): outlines, the UV grid with ticks at " +
			"0, .25, .5, .75, 1, corner numbers 1 to 4, u and v arrows, details (dashed, named) and the faces across each edge. " +
			"Look at it before drawing so u and v are where you think. " + UV}, templateGet)
}

type renderIn struct {
	SurfaceID   string  `json:"surface_id" jsonschema:"surface id, name, or object/name"`
	T           float64 `json:"t,omitempty" jsonschema:"timeline seconds, default 0"`
	WithOutline bool    `json:"with_outline,omitempty" jsonschema:"draw the face outline, details and the .25 UV grid on top"`
	Size        int     `json:"size,omitempty" jsonschema:"longest side in px, default 1024, at most 1280"`
}

type unfoldRenderIn struct {
	ObjectID string  `json:"object_id" jsonschema:"object id or name"`
	T        float64 `json:"t,omitempty" jsonschema:"timeline seconds, default 0"`
	Size     int     `json:"size,omitempty" jsonschema:"longest side in px, default 1280"`
}

type templateIn struct {
	SurfaceID string `json:"surface_id,omitempty" jsonschema:"a face: its template in its own UV"`
	ObjectID  string `json:"object_id,omitempty" jsonschema:"an object: the template of its whole unfold"`
}

// fitSize is w×h scaled so the longest side is long (at least 16 px each).
func fitSize(w, h float64, long int) (int, int) {
	if w <= 0 || h <= 0 {
		return long, long
	}
	k := float64(long) / math.Max(w, h)
	return max(16, int(math.Round(w*k))), max(16, int(math.Round(h*k)))
}

// faceFrame is a face's flat size in atlas terms (the frame face_render uses): the length of its UV axes in the
// atlas when it has a place, else its flat size.
func faceFrame(sc *scene.Scene, sf *scene.Surface, affs map[string]unfold.Affine) (float64, float64) {
	if a, ok := affs[sf.ID]; ok && a.Width() > 0 && a.Height() > 0 {
		return a.Width(), a.Height()
	}
	if g := unfold.SurfaceGeometry(sc, sf); g != nil {
		return g.Size[0], g.Size[1]
	}
	return 1, 1
}

func fallbackNote(e *tools.Env, why error) string {
	u := e.D.EditorURL()
	s := "No browser rendered this, so it is projmap's built-in approximation (drawing layers, gradients and PNG/JPEG pictures; no shader effects, SVG pictures or exact fonts). "
	if why != nil && render.HasClient(e) {
		s = fmt.Sprintf("The render client failed (%s), so this is projmap's built-in approximation (drawing layers, gradients and PNG/JPEG pictures only). ", app_errors.As(why).Message)
	}
	return s + fmt.Sprintf("For the exact look, ask the user to open %s/editor (or %s/out) in Chrome on this Mac.", u, u)
}

func faceRender(ctx context.Context, e *tools.Env, in renderIn) (*mcp.CallToolResult, error) {
	sc, draft, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	o, sf, err := findSurface(sc, in.SurfaceID)
	if err != nil {
		return nil, err
	}
	if sf.Kind == "mask" {
		return nil, app_errors.BadRequest("%s is a mask: it cuts content out and has none of its own.", sf.ID)
	}
	atlas, _ := unfold.Resolve(sc, o)
	affs := unfold.Affines(sc, o, atlas)
	if in.Size <= 0 || in.Size > tools.MaxImage {
		in.Size = 1024
	}
	fw, fh := faceFrame(sc, sf, affs)
	W, H := fitSize(fw, fh, in.Size)
	args := map[string]any{"sceneId": sc.ID, "surfaceId": sf.ID, "t": in.T, "width": W, "height": H}
	if draft != "" {
		args["draftId"] = draft
	}
	var img image.Image
	source, note := "", ""
	if render.HasClient(e) {
		var sha string
		img, sha, err = render.Call(ctx, e, "render.face", args)
		if err == nil {
			source = "the browser renderer, asset " + sha
		} else {
			note = fallbackNote(e, err)
		}
	} else {
		note = fallbackNote(e, nil)
	}
	if img == nil {
		f := newFlat(ctx, e, sc)
		img = f.face(o, sf, W, H)
		source = "projmap's built-in rasterizer"
		if len(f.skipped) > 0 {
			note += " Not drawn here: " + strings.Join(f.skippedList(), ", ") + "."
		}
	}
	out := raster.RGBA(img)
	if out.Bounds().Dx() != W || out.Bounds().Dy() != H {
		out = raster.RGBA(tools.Fit(img, max(W, H)))
	}
	if in.WithOutline {
		overlayFace(out, sc, o, sf, false)
	}
	c, err := tools.Encode(out, true)
	if err != nil {
		return nil, err
	}
	text := fmt.Sprintf("Face %s (%s) flat, %d×%d px at its aspect %.3f (flat size %.0f×%.0f scene px). x/%d = u, y/%d = v, top left = corner 1 (%s). From %s, rendered by %s.",
		sf.Name, sf.ID, W, H, fw/fh, fw, fh, W, H, firstPoint(sf), map[bool]string{true: "your draft " + draft, false: "the live scene"}[draft != ""], source)
	if note != "" {
		text += "\n" + strings.TrimSpace(note)
	}
	return tools.WithImages(text, c), nil
}

func firstPoint(sf *scene.Surface) string {
	if len(sf.PointIDs) > 0 {
		return "point " + sf.PointIDs[0]
	}
	return "no points"
}

func unfoldRender(ctx context.Context, e *tools.Env, in unfoldRenderIn) (*mcp.CallToolResult, error) {
	sc, draft, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	o, err := findObject(sc, in.ObjectID)
	if err != nil {
		return nil, err
	}
	atlas, _ := unfold.Resolve(sc, o)
	if len(atlas.Faces) == 0 {
		return nil, app_errors.BadRequest("Object %s has no faces to unfold.", o.ID)
	}
	if in.Size <= 0 || in.Size > tools.MaxImage {
		in.Size = tools.MaxImage
	}
	W, H := fitSize(atlas.Width, atlas.Height, in.Size)
	args := map[string]any{"sceneId": sc.ID, "objectId": o.ID, "t": in.T, "width": W, "height": H}
	if draft != "" {
		args["draftId"] = draft
	}
	var img image.Image
	source, note := "", ""
	if render.HasClient(e) {
		var sha string
		img, sha, err = render.Call(ctx, e, "render.unfold", args)
		if err == nil {
			source = "the browser renderer, asset " + sha
		} else {
			note = fallbackNote(e, err)
		}
	} else {
		note = fallbackNote(e, nil)
	}
	if img == nil {
		f := newFlat(ctx, e, sc)
		img = f.unfold(o, atlas, W, H)
		source = "projmap's built-in rasterizer"
		if len(f.skipped) > 0 {
			note += " Not drawn here: " + strings.Join(f.skippedList(), ", ") + "."
		}
	}
	out := raster.RGBA(img)
	if out.Bounds().Dx() != W || out.Bounds().Dy() != H {
		out = raster.RGBA(tools.Fit(img, max(W, H)))
	}
	overlayUnfold(out, sc, o, atlas, false)
	c, err := tools.Encode(out, true)
	if err != nil {
		return nil, err
	}
	text := fmt.Sprintf("Unfold of %s (%s), %d×%d px for a %.0f×%.0f atlas (1 image px = %.3f atlas px), face names and corner 1 marked. From %s, rendered by %s.",
		o.Name, o.ID, W, H, atlas.Width, atlas.Height, atlas.Width/float64(W), map[bool]string{true: "your draft " + draft, false: "the live scene"}[draft != ""], source)
	if note != "" {
		text += "\n" + strings.TrimSpace(note)
	}
	return tools.WithImages(text, c), nil
}

var (
	ink      = color.RGBA{245, 244, 240, 255}
	dim      = color.RGBA{140, 138, 133, 255}
	faint    = color.RGBA{70, 70, 74, 255}
	plate    = color.RGBA{38, 38, 40, 255}
	ground   = color.RGBA{14, 14, 16, 255}
	accent   = color.RGBA{255, 59, 48, 255}
	softInk  = color.NRGBA{245, 244, 240, 200}
	labelBg  = color.RGBA{0, 0, 0, 170}
	gridStep = []float64{0.25, 0.5, 0.75}
)

// faceShape is a face's outline in its own UV (a quad's square, a poly's points, a circle's ring).
func faceShape(sc *scene.Scene, sf *scene.Surface) []unfold.Vec {
	if g := unfold.SurfaceGeometry(sc, sf); g != nil && len(g.OutlineUV) >= 3 {
		return g.OutlineUV
	}
	return []unfold.Vec{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
}

// detailShape is a detail's outline in its parent's UV.
func detailShape(sc *scene.Scene, d, parent *scene.Surface) []unfold.Vec {
	g, pg := unfold.SurfaceGeometry(sc, d), unfold.SurfaceGeometry(sc, parent)
	if g == nil || pg == nil {
		return nil
	}
	var out []unfold.Vec
	for _, p := range g.Outline {
		out = append(out, pg.SceneToUV(p[0], p[1]))
	}
	return out
}

// overlayFace draws a face's outline, its details and the .25 grid onto a W×H image of the face's UV square, with
// margin px around it (0 for a render).
func overlayFaceAt(img *image.RGBA, sc *scene.Scene, o *scene.Object, sf *scene.Surface, ox, oy, w, h float64, template bool) {
	px := func(u, v float64) raster.Vec { return raster.Vec{ox + u*w, oy + v*h} }
	lw := math.Max(1.5, math.Max(w, h)/400)
	for _, s := range gridStep {
		var col color.Color = faint
		if !template {
			col = color.NRGBA{255, 255, 255, 70}
		}
		raster.Polyline(img, []raster.Vec{px(s, 0), px(s, 1)}, math.Max(1, lw/2), false, col)
		raster.Polyline(img, []raster.Vec{px(0, s), px(1, s)}, math.Max(1, lw/2), false, col)
	}
	var shape []raster.Vec
	for _, p := range faceShape(sc, sf) {
		shape = append(shape, px(p[0], p[1]))
	}
	raster.Polyline(img, shape, lw, true, ink)
	fs := math.Max(12, math.Min(w, h)/28)
	for i := range o.Surfaces {
		d := &o.Surfaces[i]
		if d.ParentID == nil || *d.ParentID != sf.ID {
			continue
		}
		shape := detailShape(sc, d, sf)
		if len(shape) < 2 {
			continue
		}
		dashedInside(img, shape, px, lw, accent)
		c := labelSpot(shape)
		raster.Label(img, d.Name, px(c[0], c[1]), fs, ink, labelBg)
	}
	if !template {
		c1 := px(0, 0)
		raster.Label(img, "1", raster.Vec{c1[0] + fs*0.9, c1[1] + fs*0.9}, fs, ink, accent)
	}
}

// dashedInside draws a detail's closed outline (in its parent's UV) dashed, only where it lies inside the parent,
// since the renderer clips details to their face.
func dashedInside(img *image.RGBA, shape []unfold.Vec, px func(u, v float64) raster.Vec, lw float64, col color.Color) {
	var run []raster.Vec
	flush := func() {
		if len(run) >= 2 {
			raster.Dashed(img, run, lw, false, lw*5, lw*3, col)
		}
		run = nil
	}
	for i := range shape {
		a, b := shape[i], shape[(i+1)%len(shape)]
		ca, cb, ok := clipSeg(a, b, 0, 1)
		if !ok {
			flush()
			continue
		}
		pa, pb := px(ca[0], ca[1]), px(cb[0], cb[1])
		if len(run) == 0 || math.Hypot(run[len(run)-1][0]-pa[0], run[len(run)-1][1]-pa[1]) > 0.01 {
			flush()
			run = []raster.Vec{pa}
		}
		run = append(run, pb)
	}
	flush()
}

// labelSpot is where a detail's name goes: its centre, kept inside the parent.
func labelSpot(shape []unfold.Vec) unfold.Vec {
	u0, v0, u1, v1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range shape {
		u0, v0, u1, v1 = math.Min(u0, p[0]), math.Min(v0, p[1]), math.Max(u1, p[0]), math.Max(v1, p[1])
	}
	u0, v0, u1, v1 = math.Max(u0, 0), math.Max(v0, 0), math.Min(u1, 1), math.Min(v1, 1)
	return unfold.Vec{(u0 + u1) / 2, (v0 + v1) / 2}
}

// arrow draws a line with a head at its end.
func arrow(img *image.RGBA, from, to raster.Vec, lw float64, col color.Color) {
	raster.Polyline(img, []raster.Vec{from, to}, lw, false, col)
	dx, dy := to[0]-from[0], to[1]-from[1]
	l := math.Hypot(dx, dy)
	if l == 0 {
		return
	}
	dx, dy = dx/l, dy/l
	hs := lw * 4
	raster.FillPolygon(img, []raster.Vec{{to[0] + dx*hs, to[1] + dy*hs}, {to[0] - dy*hs*0.7, to[1] + dx*hs*0.7}, {to[0] + dy*hs*0.7, to[1] - dx*hs*0.7}}, col)
}

func overlayFace(img *image.RGBA, sc *scene.Scene, o *scene.Object, sf *scene.Surface, template bool) {
	b := img.Bounds()
	overlayFaceAt(img, sc, o, sf, 0, 0, float64(b.Dx()), float64(b.Dy()), template)
}

func tick(v float64) string {
	switch v {
	case 0:
		return "0"
	case 1:
		return "1"
	}
	return strings.TrimPrefix(fmt.Sprintf("%.2f", v), "0")
}

// faceTemplate is a face's template: the face box (its UV square at its aspect) inside a margin with tick labels,
// corner numbers, axes, details and neighbours.
func faceTemplate(sc *scene.Scene, o *scene.Object, sf *scene.Surface, affs map[string]unfold.Affine, atlas scene.Atlas) (*image.RGBA, string) {
	fw, fh := faceFrame(sc, sf, affs)
	const margin = 64
	iw, ih := fitSize(fw, fh, tools.MaxImage-2*margin)
	W, H := iw+2*margin, ih+2*margin
	img := raster.New(W, H, ground)
	ox, oy, w, h := float64(margin), float64(margin), float64(iw), float64(ih)
	var shape []raster.Vec
	for _, p := range faceShape(sc, sf) {
		shape = append(shape, raster.Vec{ox + p[0]*w, oy + p[1]*h})
	}
	raster.FillPolygon(img, shape, plate)
	overlayFaceAt(img, sc, o, sf, ox, oy, w, h, true)
	fs := 15.0
	for _, s := range []float64{0, 0.25, 0.5, 0.75, 1} {
		raster.Text(img, tick(s), raster.Vec{ox + s*w, oy - fs*1.1}, fs, dim, true)
		raster.Text(img, tick(s), raster.Vec{ox - fs*1.6, oy + s*h}, fs, dim, true)
		raster.Polyline(img, []raster.Vec{{ox + s*w, oy - 6}, {ox + s*w, oy}}, 1.5, false, dim)
		raster.Polyline(img, []raster.Vec{{ox - 6, oy + s*h}, {ox, oy + s*h}}, 1.5, false, dim)
	}
	arrow(img, raster.Vec{ox + w*0.3, oy - fs*2.6}, raster.Vec{ox + w*0.7, oy - fs*2.6}, 2, accent)
	raster.Label(img, "u", raster.Vec{ox + w*0.5, oy - fs*2.6}, fs, accent, ground)
	arrow(img, raster.Vec{ox - fs*2.9, oy + h*0.3}, raster.Vec{ox - fs*2.9, oy + h*0.7}, 2, ink)
	raster.Label(img, "v", raster.Vec{ox - fs*2.9, oy + h*0.5}, fs, ink, ground)
	// corners
	if sf.Kind == "quad" && len(sf.PointIDs) == 4 {
		pos := [4]raster.Vec{{ox, oy}, {ox + w, oy}, {ox + w, oy + h}, {ox, oy + h}}
		off := [4]raster.Vec{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}}
		for i := 0; i < 4; i++ {
			p := raster.Vec{pos[i][0] + off[i][0]*fs*1.4, pos[i][1] + off[i][1]*fs*1.4}
			raster.Label(img, fmt.Sprintf("%d", i+1), p, fs, ink, accent)
		}
	}
	// neighbours along each edge, inside the face
	edges := unfold.Edges(sc, o, sf, atlas, affs)
	big := math.Max(18, math.Min(w, h)/9)
	for i, ed := range edges {
		if ed.Neighbour == nil {
			continue
		}
		mid := []raster.Vec{{ox + w/2, oy + fs*1.6}, {ox + w - fs*1.2, oy + h/2}, {ox + w/2, oy + h - fs*1.6}, {ox + fs*1.2, oy + h/2}}[i]
		txt := "touches " + ed.Neighbour.Name
		if i == 1 || i == 3 {
			// vertical edges: keep the label inside the face
			tw := raster.TextWidth(txt, fs)
			if i == 1 {
				mid[0] -= tw / 2
			} else {
				mid[0] += tw / 2
			}
		}
		raster.Label(img, txt, mid, fs, ink, labelBg)
	}
	_ = big
	raster.Text(img, sf.Name, raster.Vec{ox, oy + h + 22}, fs*1.6, ink, false)
	foot := fmt.Sprintf("%s  flat %.0fx%.0f px  aspect %.3f", sf.ID, fw, fh, fw/fh)
	raster.Text(img, foot, raster.Vec{ox + raster.TextWidth(sf.Name, fs*1.6) + fs, oy + h + 22 + fs*0.5}, fs, dim, false)
	text := fmt.Sprintf("Template of face %s (%s). The face's UV square is the box from (%d, %d) to (%d, %d) in this %d×%d image: u = (x − %d) / %d, v = (y − %d) / %d. "+
		"Corner numbers are the face's points in order; ticks mark 0, .25, .5, .75, 1; dashed red outlines are details; \"touches\" names the face across an edge.",
		sf.Name, sf.ID, margin, margin, margin+iw, margin+ih, W, H, margin, iw, margin, ih)
	return img, text
}

// overlayUnfold draws face outlines, names, the corner-1 marks and u/v arrows on an unfold image (template adds
// the grid and fills).
func overlayUnfold(img *image.RGBA, sc *scene.Scene, o *scene.Object, atlas scene.Atlas, template bool) {
	b := img.Bounds()
	k := float64(b.Dx()) / atlas.Width
	affs := unfold.Affines(sc, o, atlas)
	at := func(a unfold.Affine, u, v float64) raster.Vec {
		p := a.Apply(u, v)
		return raster.Vec{p[0] * k, p[1] * k}
	}
	lw := math.Max(1.5, float64(max(b.Dx(), b.Dy()))/500)
	fs := math.Max(12, float64(max(b.Dx(), b.Dy()))/70)
	for i := range o.Surfaces {
		sf := &o.Surfaces[i]
		a, ok := affs[sf.ID]
		if !ok || sf.ParentID != nil {
			continue
		}
		var shape []raster.Vec
		for _, p := range faceShape(sc, sf) {
			shape = append(shape, at(a, p[0], p[1]))
		}
		if template {
			raster.FillPolygon(img, shape, plate)
			for _, s := range gridStep {
				raster.Polyline(img, []raster.Vec{at(a, s, 0), at(a, s, 1)}, 1, false, faint)
				raster.Polyline(img, []raster.Vec{at(a, 0, s), at(a, 1, s)}, 1, false, faint)
			}
		}
		raster.Polyline(img, shape, lw, true, softInk)
		// u and v arrows from corner 1
		o0 := at(a, 0.06, 0.06)
		ue, ve := at(a, 0.24, 0.06), at(a, 0.06, 0.24)
		raster.Polyline(img, []raster.Vec{o0, ue}, lw, false, accent)
		raster.Polyline(img, []raster.Vec{o0, ve}, lw, false, ink)
		raster.Label(img, "u", at(a, 0.29, 0.06), fs, accent, labelBg)
		raster.Label(img, "v", at(a, 0.06, 0.29), fs, ink, labelBg)
		raster.Label(img, "1", o0, fs*0.9, ink, accent)
		raster.Label(img, sf.Name, at(a, 0.5, 0.88), fs*1.4, ink, labelBg)
	}
	for i := range o.Surfaces {
		d := &o.Surfaces[i]
		a, ok := affs[d.ID]
		if !ok || d.ParentID == nil {
			continue
		}
		var parent *scene.Surface
		for j := range o.Surfaces {
			if o.Surfaces[j].ID == *d.ParentID {
				parent = &o.Surfaces[j]
			}
		}
		pa, pok := affs[*d.ParentID]
		if parent == nil || !pok {
			continue
		}
		shape := detailShape(sc, d, parent)
		toPx := func(u, v float64) raster.Vec { return at(pa, u, v) }
		if template {
			dashedInside(img, shape, toPx, lw, accent)
			c := labelSpot(shape)
			raster.Label(img, d.Name, at(pa, c[0], c[1]), fs*0.8, ink, labelBg)
		} else {
			dashedInside(img, shape, toPx, math.Max(1, lw*0.6), color.NRGBA{255, 59, 48, 160})
		}
		_ = a
	}
}

func templateGet(ctx context.Context, e *tools.Env, in templateIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	switch {
	case in.SurfaceID != "" && in.ObjectID != "":
		return nil, app_errors.BadRequest("Pass surface_id (one face) or object_id (the whole unfold), not both.")
	case in.SurfaceID != "":
		o, sf, err := findSurface(sc, in.SurfaceID)
		if err != nil {
			return nil, err
		}
		atlas, _ := unfold.Resolve(sc, o)
		img, text := faceTemplate(sc, o, sf, unfold.Affines(sc, o, atlas), atlas)
		c, err := tools.Encode(img, true)
		if err != nil {
			return nil, err
		}
		return tools.WithImages(text, c), nil
	case in.ObjectID != "":
		o, err := findObject(sc, in.ObjectID)
		if err != nil {
			return nil, err
		}
		atlas, _ := unfold.Resolve(sc, o)
		if len(atlas.Faces) == 0 {
			return nil, app_errors.BadRequest("Object %s has no faces to unfold.", o.ID)
		}
		W, H := fitSize(atlas.Width, atlas.Height, tools.MaxImage)
		img := raster.New(W, H, ground)
		overlayUnfold(img, sc, o, atlas, true)
		c, err := tools.Encode(img, true)
		if err != nil {
			return nil, err
		}
		return tools.WithImages(fmt.Sprintf("Template of the %s unfold, %d×%d px for a %.0f×%.0f atlas (atlas px = image px × %.3f). "+
			"Each face shows corner 1, its u (red) and v (white) arrows, and the .25 grid in its own UV, so you can see how the atlas turns it. "+
			"Dashed red outlines are details.", o.Name, W, H, atlas.Width, atlas.Height, atlas.Width/float64(W)), c), nil
	}
	return nil, app_errors.BadRequest("Pass surface_id (one face) or object_id (the whole unfold).")
}
