package faces

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/domain/catalog"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/unfold"
	"projmap/internal/infrastructure/mcp/tools"
	"projmap/internal/infrastructure/mcp/tools/raster"
)

func registerWrite(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "face_draw", Title: "Draw on a face",
		Description: "Draws vector strokes on one face (or detail) in your draft, into a named drawing layer (layer_name, default \"drawing\"; " +
			"use one per idea, like \"bays\", \"logo\", \"leds\", so you can redo one alone). mode append (default) adds the strokes to the " +
			"layer, replace swaps the layer's strokes. The drawing warps onto the real face. " + UV + " " + Strokes +
			" Check the result with face_render."}, faceDraw)
	tools.Add(s, env, &mcp.Tool{Name: "face_drawing_clear", Title: "Clear a face's drawing",
		Description: "Removes a face's drawing layer layer_name from your draft, or every drawing layer of the face when layer_name is empty."}, faceClear)
	tools.Add(s, env, &mcp.Tool{Name: "object_draw", Title: "Draw across an object's unfold",
		Description: "Draws strokes across a whole object's unfold in ATLAS PIXELS (object_unfold_get gives the atlas size and each face's " +
			"rect; (0,0) is the atlas's top left, x right, y down). projmap splits each stroke onto every face it crosses, as that " +
			"face's drawing layer layer_name (default \"drawing\"), so a line over a shared edge runs on across it. width and size " +
			"are in atlas px here. mode replace clears that layer on every face of the object first. Text on a turned face " +
			"(rotation 90/180/270) reads along that face's own u axis. Strokes are otherwise as in face_draw."}, objectDraw)
	tools.Add(s, env, &mcp.Tool{Name: "layer_add", Title: "Add a picture or gradient layer",
		Description: "Adds a content layer (protocol §12) to a surface (target_kind surface: drawn in the face's UV square) or to an object " +
			"(target_kind object: drawn across its atlas, so it runs on across shared edges). kind media takes src \"asset:<sha>\" " +
			"(from asset_upload) or a scenery id, fit fill (cover, default), fit (contain) or stretch; kind gradient takes stops " +
			"[{color: \"#rrggbb\", pos: 0..1}] (1 to 8), angle (degrees, 0 = left to right), offset, repeat. Common: opacity 0..1, blend " +
			"normal|multiply|screen|add, x and y (shift in canvas fractions), scale, rotation (degrees clockwise), reveal 0..1 with " +
			"reveal_angle. Layers draw under the drawing layers, bottom to top in the order added."}, layerAdd)
	tools.Add(s, env, &mcp.Tool{Name: "layer_update", Title: "Change a content layer",
		Description: "Changes fields of a surface or object content layer by its id (only the fields you pass)."}, layerUpdate)
	tools.Add(s, env, &mcp.Tool{Name: "layer_remove", Title: "Remove a content layer",
		Description: "Removes a surface or object content layer (and the timeline tracks that animate it) from your draft."}, layerRemove)
	tools.Add(s, env, &mcp.Tool{Name: "asset_upload", Title: "Upload a picture",
		Description: "Stores a PNG, JPEG or SVG and returns its sha and src \"asset:<sha>\" for layer_add. Pass data_base64 (raw base64 or a " +
			"data: URL) or path (a file under your home folder on this Mac; ~ works). At most 16 MB. An SVG needs width and height or a " +
			"viewBox on its <svg> root; it renders in the browser renderer (the built-in fallback skips SVGs)."}, assetUpload)
}

// ---------------------------------------------------------------- strokes

// StrokeIn is one stroke as an agent sends it.
type StrokeIn struct {
	Tool   string      `json:"tool" jsonschema:"pen, line, rect, ellipse, circle, polygon or text"`
	Points [][]float64 `json:"points" jsonschema:"[[u, v], ...] in face UV (0..1 inside the face); atlas px for object_draw"`
	Color  string      `json:"color,omitempty" jsonschema:"#rrggbb, default #ffffff"`
	Width  *float64    `json:"width,omitempty" jsonschema:"line width in scene px of the face (atlas px for object_draw), default 4 (0 for text)"`
	Fill   bool        `json:"fill,omitempty" jsonschema:"fill rect, ellipse, circle or polygon with color"`
	Text   string      `json:"text,omitempty" jsonschema:"for tool text"`
	Size   float64     `json:"size,omitempty" jsonschema:"text height in scene px of the face, default 48"`
}

var shortHex = regexp.MustCompile(`^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$`)

func normColor(c string) (string, bool) {
	c = strings.TrimSpace(c)
	if c == "" {
		return "#ffffff", true
	}
	if m := shortHex.FindStringSubmatch(c); m != nil {
		c = "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]
	}
	if !strings.HasPrefix(c, "#") {
		c = "#" + c
	}
	c = strings.ToLower(c)
	return c, catalog.IsColor(c)
}

var toolPoints = map[string][2]int{"pen": {1, -1}, "line": {2, 2}, "rect": {2, 2}, "ellipse": {2, 2}, "circle": {2, 2}, "polygon": {3, -1}, "text": {1, 1}}

// strokesFrom validates and normalizes strokes; lo and hi bound the coordinates (UV: -1..2), sizeHint helps the
// error when points look like pixels.
func strokesFrom(in []StrokeIn, lo, hi float64, space string) ([]raster.Stroke, error) {
	if len(in) == 0 {
		return nil, app_errors.BadRequest("Pass at least one stroke.")
	}
	if len(in) > catalog.MaxStrokes {
		return nil, app_errors.BadRequest("%d strokes is too many; a layer holds at most %d.", len(in), catalog.MaxStrokes)
	}
	out := make([]raster.Stroke, 0, len(in))
	for i, s := range in {
		w := fmt.Sprintf("strokes[%d]", i)
		tool := strings.ToLower(strings.TrimSpace(s.Tool))
		n, ok := toolPoints[tool]
		if !ok {
			return nil, app_errors.BadRequest("%s.tool %q is not one of pen, line, rect, ellipse, circle, polygon, text.", w, s.Tool)
		}
		if len(s.Points) < n[0] || (n[1] > 0 && len(s.Points) > n[1]) {
			want := map[string]string{"pen": "2 or more points (a polyline)", "line": "exactly 2 points [start, end] (use pen for a polyline)",
				"rect": "exactly 2 points: opposite corners", "ellipse": "exactly 2 points: opposite corners of its box",
				"circle": "exactly 2 points: [centre, a point on the rim]", "polygon": "3 or more points (closed for you)",
				"text": "exactly 1 point: the text's top left"}[tool]
			return nil, app_errors.BadRequest("%s (%s) has %d points; it takes %s.", w, tool, len(s.Points), want)
		}
		st := raster.Stroke{Tool: tool, Fill: s.Fill, Text: s.Text, Size: s.Size}
		for j, p := range s.Points {
			if len(p) != 2 || math.IsNaN(p[0]) || math.IsNaN(p[1]) {
				return nil, app_errors.BadRequest("%s.points[%d] must be a pair [%s].", w, j, map[bool]string{true: "u, v", false: "x, y"}[space == "uv"])
			}
			if p[0] < lo || p[0] > hi || p[1] < lo || p[1] > hi {
				if space == "uv" {
					return nil, app_errors.BadRequest("%s.points[%d] = [%g, %g] is outside face UV. Points are fractions of the face: 0..1 inside it (-1..2 is accepted). "+
						"If you have pixels, divide by the face's sizePx (face_get).", w, j, p[0], p[1])
				}
				return nil, app_errors.BadRequest("%s.points[%d] = [%g, %g] is far outside the atlas (%g..%g px).", w, j, p[0], p[1], lo, hi)
			}
			st.Points = append(st.Points, [2]float64{p[0], p[1]})
		}
		if tool == "pen" && len(st.Points) == 1 {
			st.Points = append(st.Points, st.Points[0]) // a dot
		}
		col, ok := normColor(s.Color)
		if !ok {
			return nil, app_errors.BadRequest("%s.color %q must be #rrggbb (for example #ff3b30).", w, s.Color)
		}
		st.Color = col
		switch {
		case s.Width != nil:
			st.Width = *s.Width
		case tool == "text":
			st.Width = 0
		default:
			st.Width = 4
		}
		if st.Width < 0 || st.Width > 500 {
			return nil, app_errors.BadRequest("%s.width %g must be 0..500 (scene px of the face, not UV).", w, st.Width)
		}
		if tool == "text" {
			if strings.TrimSpace(s.Text) == "" {
				return nil, app_errors.BadRequest("%s is a text stroke without text.", w)
			}
			if len(s.Text) > 500 {
				return nil, app_errors.BadRequest("%s.text is longer than 500 bytes.", w)
			}
			if st.Size == 0 {
				st.Size = 48
			}
		} else if s.Text != "" {
			st.Text = ""
		}
		if st.Size < 0 || st.Size > 2000 {
			return nil, app_errors.BadRequest("%s.size %g must be 1..2000 (scene px of the face).", w, st.Size)
		}
		if st.Width == 0 && !st.Fill && tool != "text" {
			return nil, app_errors.BadRequest("%s has width 0 and no fill, so it would draw nothing.", w)
		}
		if st.Fill && !fillable[tool] {
			st.Fill = false
		}
		out = append(out, st)
	}
	return out, nil
}

var fillable = map[string]bool{"rect": true, "ellipse": true, "circle": true, "polygon": true}

// strokesValue turns strokes into the JSON value the effect stores (so validation sees plain JSON).
func strokesValue(st []raster.Stroke) []any {
	out := make([]any, 0, len(st))
	for _, s := range st {
		pts := make([]any, len(s.Points))
		for i, p := range s.Points {
			pts[i] = []any{p[0], p[1]}
		}
		m := map[string]any{"tool": s.Tool, "points": pts, "color": s.Color, "width": s.Width}
		if s.Fill {
			m["fill"] = true
		}
		if s.Tool == "text" {
			m["text"], m["size"] = s.Text, s.Size
		}
		out = append(out, m)
	}
	return out
}

func newID(prefix string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func cleanLayer(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return DefaultLayer, nil
	}
	if len(name) > 60 {
		return "", app_errors.BadRequest("layer_name is longer than 60 characters.")
	}
	return name, nil
}

// surfaceIndex finds a surface's indexes in the scene.
func surfaceIndex(sc *scene.Scene, id string) (int, int) {
	oi, si, _ := sc.FindSurface(id)
	return oi, si
}

// drawOps writes strokes into a surface's drawing layer (append or replace), creating it when missing.
func drawOps(sc *scene.Scene, sf *scene.Surface, layer string, st []raster.Stroke, replace bool) ([]docpatch.Op, int, error) {
	oi, si := surfaceIndex(sc, sf.ID)
	base := fmt.Sprintf("/objects/%d/surfaces/%d/effects", oi, si)
	for k, ef := range sf.Effects {
		if ef.Effect != "drawing" || layerName(ef) != layer {
			continue
		}
		all := st
		if !replace {
			all = append(raster.ParseStrokes(ef.Params["strokes"]), st...)
		}
		if len(all) > catalog.MaxStrokes {
			return nil, 0, app_errors.BadRequest("Layer %q would have %d strokes; a layer holds at most %d. Use another layer_name or mode replace.", layer, len(all), catalog.MaxStrokes)
		}
		ops := []docpatch.Op{docpatch.Add(fmt.Sprintf("%s/%d/params/strokes", base, k), strokesValue(all))}
		if !ef.Enabled {
			ops = append(ops, docpatch.Replace(fmt.Sprintf("%s/%d/enabled", base, k), true))
		}
		return ops, len(all), nil
	}
	ef := scene.SurfaceEffect{ID: newID("fx"), Name: layer, Effect: "drawing", Enabled: true,
		Params: map[string]any{"strokes": strokesValue(st), "reveal": 1.0}}
	if layer == DefaultLayer {
		ef.Name = ""
	}
	return []docpatch.Op{docpatch.Add(base+"/-", ef)}, len(st), nil
}

type faceDrawIn struct {
	SurfaceID string     `json:"surface_id" jsonschema:"surface id, name, or object/name"`
	Strokes   []StrokeIn `json:"strokes" jsonschema:"the strokes, points in the face's UV"`
	Mode      string     `json:"mode,omitempty" jsonschema:"append (default) or replace"`
	LayerName string     `json:"layer_name,omitempty" jsonschema:"drawing layer name, default drawing"`
}

func mode(m string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "", "append":
		return false, nil
	case "replace":
		return true, nil
	}
	return false, app_errors.BadRequest("mode %q must be append or replace.", m)
}

func faceDraw(ctx context.Context, e *tools.Env, in faceDrawIn) (*mcp.CallToolResult, error) {
	replace, err := mode(in.Mode)
	if err != nil {
		return nil, err
	}
	layer, err := cleanLayer(in.LayerName)
	if err != nil {
		return nil, err
	}
	st, err := strokesFrom(in.Strokes, -1, 2, "uv")
	if err != nil {
		return nil, err
	}
	sc, draft, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	_, sf, err := findSurface(sc, in.SurfaceID)
	if err != nil {
		return nil, err
	}
	if sf.Kind == "mask" {
		return nil, app_errors.BadRequest("%s is a mask; it draws nothing. Draw on the face under it.", sf.ID)
	}
	ops, n, err := drawOps(sc, sf, layer, st, replace)
	if err != nil {
		return nil, err
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	verb := "Added"
	if replace {
		verb = "Replaced the layer with"
	}
	return tools.Text("%s %d strokes on %s (%s): layer %q now has %d strokes, in your draft %s. Look at it with face_render(surface_id: %q, with_outline: true).",
		verb, len(st), sf.Name, sf.ID, layer, n, draft, sf.ID), nil
}

type clearIn struct {
	SurfaceID string `json:"surface_id" jsonschema:"surface id, name, or object/name"`
	LayerName string `json:"layer_name,omitempty" jsonschema:"the drawing layer to remove; empty removes every drawing layer of the face"`
}

func clearOps(sc *scene.Scene, sf *scene.Surface, layer string) ([]docpatch.Op, []string) {
	oi, si := surfaceIndex(sc, sf.ID)
	var ops []docpatch.Op
	var names []string
	for k := len(sf.Effects) - 1; k >= 0; k-- {
		ef := sf.Effects[k]
		if ef.Effect != "drawing" || (layer != "" && layerName(ef) != layer) {
			continue
		}
		ops = append(ops, docpatch.Remove(fmt.Sprintf("/objects/%d/surfaces/%d/effects/%d", oi, si, k)))
		names = append(names, layerName(ef))
	}
	return ops, names
}

func faceClear(ctx context.Context, e *tools.Env, in clearIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	_, sf, err := findSurface(sc, in.SurfaceID)
	if err != nil {
		return nil, err
	}
	ops, names := clearOps(sc, sf, strings.TrimSpace(in.LayerName))
	if len(ops) == 0 {
		d, _ := drawingsOf(sf, false)
		var have []string
		for _, x := range d {
			have = append(have, x.Layer)
		}
		return tools.Text("%s has no drawing layer %q. Its drawing layers: %s.", sf.ID, in.LayerName, strings.Join(append(have, "none")[:max(1, len(have))], ", ")), nil
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Removed drawing layers %s from %s in your draft.", strings.Join(names, ", "), sf.ID), nil
}

// ---------------------------------------------------------------- object_draw

type objectDrawIn struct {
	ObjectID  string     `json:"object_id" jsonschema:"object id or name"`
	Strokes   []StrokeIn `json:"strokes" jsonschema:"the strokes, points in ATLAS px"`
	Mode      string     `json:"mode,omitempty" jsonschema:"append (default) or replace (clears layer_name on every face first)"`
	LayerName string     `json:"layer_name,omitempty" jsonschema:"drawing layer name on each face, default drawing"`
}

// clipSeg clips a segment to the box [lo, hi]² (Liang–Barsky); ok is false when nothing is left.
func clipSeg(a, b [2]float64, lo, hi float64) ([2]float64, [2]float64, bool) {
	t0, t1 := 0.0, 1.0
	d := [2]float64{b[0] - a[0], b[1] - a[1]}
	for k := 0; k < 2; k++ {
		for _, pq := range [][2]float64{{-d[k], a[k] - lo}, {d[k], hi - a[k]}} {
			p, q := pq[0], pq[1]
			if p == 0 {
				if q < 0 {
					return a, b, false
				}
				continue
			}
			r := q / p
			if p < 0 {
				t0 = math.Max(t0, r)
			} else {
				t1 = math.Min(t1, r)
			}
		}
	}
	if t0 > t1 {
		return a, b, false
	}
	return [2]float64{a[0] + t0*d[0], a[1] + t0*d[1]}, [2]float64{a[0] + t1*d[0], a[1] + t1*d[1]}, true
}

// splitOnto maps an atlas-px stroke into a face's UV; it returns the pieces that touch the face.
func splitOnto(s raster.Stroke, aff unfold.Affine, facePx float64) ([]raster.Stroke, bool) {
	k := facePx / math.Max(aff.Width(), 1e-6) // atlas px → face px
	uv := make([][2]float64, len(s.Points))
	for i, p := range s.Points {
		q, ok := aff.Invert(p[0], p[1])
		if !ok {
			return nil, false
		}
		uv[i] = [2]float64{q[0], q[1]}
	}
	base := s
	base.Width = s.Width * k
	base.Size = s.Size * k
	const lo, hi = -0.5, 1.5
	switch s.Tool {
	case "pen", "line":
		var out []raster.Stroke
		var cur [][2]float64
		flush := func() {
			if len(cur) >= 2 {
				p := base
				p.Tool = "pen"
				if s.Tool == "line" {
					p.Tool = "line"
				}
				p.Points = cur
				out = append(out, p)
			}
			cur = nil
		}
		for i := 1; i < len(uv); i++ {
			a, b, ok := clipSeg(uv[i-1], uv[i], lo, hi)
			if !ok {
				flush()
				continue
			}
			if len(cur) == 0 || cur[len(cur)-1] != a {
				flush()
				cur = [][2]float64{a}
			}
			cur = append(cur, b)
			if b != uv[i] {
				flush()
			}
		}
		flush()
		for i := range out {
			if out[i].Tool == "line" && len(out[i].Points) > 2 {
				out[i].Tool = "pen"
			}
		}
		// keep only pieces that reach into the face
		var keep []raster.Stroke
		for _, p := range out {
			if touches(p.Points, 0) {
				keep = append(keep, p)
			}
		}
		return keep, true
	}
	pts := uv
	r := 0.0
	if s.Tool == "circle" {
		r = math.Hypot(uv[1][0]-uv[0][0], uv[1][1]-uv[0][1])
	}
	box := pts
	if s.Tool == "circle" {
		box = [][2]float64{{uv[0][0] - r, uv[0][1] - r}, {uv[0][0] + r, uv[0][1] + r}}
	}
	if s.Tool == "text" {
		w := raster.TextWidth(s.Text, base.Size) / facePx
		box = [][2]float64{uv[0], {uv[0][0] + w, uv[0][1] + base.Size/facePx}}
	}
	if !touches(box, 0) {
		return nil, true
	}
	for _, p := range pts {
		if p[0] < -1 || p[0] > 2 || p[1] < -1 || p[1] > 2 {
			return nil, false
		}
	}
	base.Points = pts
	return []raster.Stroke{base}, true
}

// touches tells whether the bounding box of points overlaps the face's UV square (grown by pad).
func touches(pts [][2]float64, pad float64) bool {
	u0, v0, u1, v1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range pts {
		u0, v0, u1, v1 = math.Min(u0, p[0]), math.Min(v0, p[1]), math.Max(u1, p[0]), math.Max(v1, p[1])
	}
	return u1 >= -pad && v1 >= -pad && u0 <= 1+pad && v0 <= 1+pad
}

func objectDraw(ctx context.Context, e *tools.Env, in objectDrawIn) (*mcp.CallToolResult, error) {
	replace, err := mode(in.Mode)
	if err != nil {
		return nil, err
	}
	layer, err := cleanLayer(in.LayerName)
	if err != nil {
		return nil, err
	}
	sc, draft, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	o, err := findObject(sc, in.ObjectID)
	if err != nil {
		return nil, err
	}
	atlas, _ := unfold.Resolve(sc, o)
	if len(atlas.Faces) == 0 {
		return nil, app_errors.BadRequest("Object %s has no faces to draw across.", o.ID)
	}
	ext := math.Max(atlas.Width, atlas.Height)
	st, err := strokesFrom(in.Strokes, -ext, 2*ext, "atlas")
	if err != nil {
		return nil, err
	}
	affs := unfold.Affines(sc, o, atlas)
	ids := make([]string, 0, len(atlas.Faces))
	for id := range atlas.Faces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var ops []docpatch.Op
	var report []string
	var skipped []string
	for _, id := range ids {
		_, sf, err := findSurface(sc, id)
		if err != nil {
			continue
		}
		g := unfold.SurfaceGeometry(sc, sf)
		if g == nil {
			continue
		}
		var mine []raster.Stroke
		for i, s := range st {
			pieces, ok := splitOnto(s, affs[id], g.Size[0])
			if !ok {
				skipped = append(skipped, fmt.Sprintf("strokes[%d] on %s (it reaches too far past the face)", i, sf.Name))
				continue
			}
			mine = append(mine, pieces...)
		}
		if replace {
			cops, _ := clearOps(sc, sf, layer)
			ops = append(ops, cops...)
			if len(mine) > 0 {
				view := *sf
				view.Effects = nil
				for _, ef := range sf.Effects {
					if ef.Effect != "drawing" || layerName(ef) != layer {
						view.Effects = append(view.Effects, ef)
					}
				}
				// the removes above shift indexes: write the new layer at the end of the list as it will be
				dops, _, err := drawOps(sc, &view, layer, mine, true)
				if err != nil {
					return nil, err
				}
				ops = append(ops, dops...)
			}
		} else if len(mine) > 0 {
			dops, _, err := drawOps(sc, sf, layer, mine, false)
			if err != nil {
				return nil, err
			}
			ops = append(ops, dops...)
		}
		if len(mine) > 0 {
			report = append(report, fmt.Sprintf("%s: %d", sf.Name, len(mine)))
		}
	}
	if len(ops) == 0 {
		return nil, app_errors.BadRequest("No stroke lands on a face of %s. The atlas is %.0f×%.0f px; object_unfold_get gives each face's rect.", o.ID, atlas.Width, atlas.Height)
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	text := fmt.Sprintf("Drew %d strokes across %s into layer %q, in your draft %s. Pieces per face: %s. Look with object_unfold_render(object_id: %q).",
		len(st), o.Name, layer, draft, strings.Join(append(report, "none")[:max(1, len(report))], ", "), o.ID)
	if len(skipped) > 0 {
		text += " Skipped: " + strings.Join(skipped, "; ") + "."
	}
	return tools.Text("%s", text), nil
}
