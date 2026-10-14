package faces

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/unfold"
	"projmap/internal/infrastructure/mcp/tools"
	"projmap/internal/infrastructure/mcp/tools/raster"
)

// Register adds the face tools.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "object_unfold_get", Title: "Read an object's unfold",
		Description: "An object's faces unfolded flat like a dieline (its atlas), to draw on them: the atlas size; per face its rect " +
			"{x, y, w, h, rotation} in atlas px, its real flat size sizePx [width, height] in scene px and aspect, its corners in order " +
			"(point id, scene px, uv, atlas px), its edges (top = corner 1→2 at v=0, right = 2→3 at u=1, bottom = 3→4 at v=1, left = 4→1 " +
			"at u=0) with the face across each and whether they touch in the atlas, its details (bays, fans, logos mapped as surfaces) " +
			"with their box and corners in the face's UV, and its existing layers and drawing layers (stroke counts; face_get lists the " +
			"strokes). " + UV + " Rotation turns a face's UV inside its atlas rect: 0 u right v down, 90 u down v left, 180 u left v up, " +
			"270 u up v right."}, unfoldGet)
	tools.Add(s, env, &mcp.Tool{Name: "face_get", Title: "Read one face's UV frame",
		Description: "One face (or detail) for drawing: its flat size sizePx and aspect, corners (point id, scene px, uv, atlas px), " +
			"edges with neighbours, details inside it with their UV box, its content layers, and every drawing layer with its " +
			"strokes. " + UV + " " + Strokes}, faceGet)
	registerLook(s, env)
	registerWrite(s, env)
}

type objectIn struct {
	ObjectID string `json:"object_id" jsonschema:"object id or name (scene_get lists them)"`
}

type surfaceIn struct {
	SurfaceID string `json:"surface_id" jsonschema:"surface id, name, or object/name (for example zimacube/right)"`
}

// findObject resolves an object by id or name.
func findObject(sc *scene.Scene, idOrName string) (*scene.Object, error) {
	if i := sc.FindObject(strings.TrimSpace(idOrName)); i >= 0 {
		return &sc.Objects[i], nil
	}
	var names []string
	for _, o := range sc.Objects {
		names = append(names, fmt.Sprintf("%s (%s)", o.ID, o.Name))
	}
	return nil, app_errors.NotFound("Object %q does not exist. The objects are: %s.", idOrName, strings.Join(names, ", "))
}

// findSurface resolves a surface by id, name, or object/name.
func findSurface(sc *scene.Scene, ref string) (*scene.Object, *scene.Surface, error) {
	ref = strings.TrimSpace(ref)
	if oi, si, ok := sc.FindSurface(ref); ok {
		return &sc.Objects[oi], &sc.Objects[oi].Surfaces[si], nil
	}
	objRef, name := "", ref
	if i := strings.LastIndex(ref, "/"); i > 0 {
		objRef, name = ref[:i], ref[i+1:]
	}
	for oi := range sc.Objects {
		o := &sc.Objects[oi]
		if objRef != "" && o.ID != objRef && o.Name != objRef {
			continue
		}
		for si := range o.Surfaces {
			if o.Surfaces[si].Name == name {
				return o, &o.Surfaces[si], nil
			}
		}
	}
	return nil, nil, app_errors.NotFound("Surface %q does not exist. object_unfold_get or scene_get lists the faces.", ref)
}

func r2(v float64) float64 { return math.Round(v*100) / 100 }
func r4(v float64) float64 { return math.Round(v*10000) / 10000 }
func v4(v unfold.Vec) [2]float64 {
	return [2]float64{r4(v[0]), r4(v[1])}
}
func v2(v unfold.Vec) [2]float64 { return [2]float64{r2(v[0]), r2(v[1])} }

type cornerOut struct {
	N       int         `json:"n"`
	PointID string      `json:"pointId"`
	Scene   [2]float64  `json:"scene"`
	UV      [2]float64  `json:"uv"`
	Atlas   *[2]float64 `json:"atlas,omitempty"`
}

type detailOut struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	// UVBox is [u0, v0, u1, v1] in the parent face's UV.
	UVBox    [4]float64   `json:"uvBox"`
	UVCenter [2]float64   `json:"uvCenter"`
	Corners  [][2]float64 `json:"uvCorners,omitempty"`
	RadiusPx float64      `json:"radiusPx,omitempty"`
	Layers   int          `json:"layers"`
	Drawings int          `json:"drawingLayers"`
}

type drawingOut struct {
	EffectID string          `json:"effectId"`
	Layer    string          `json:"layerName"`
	Enabled  bool            `json:"enabled"`
	Reveal   float64         `json:"reveal"`
	Count    int             `json:"strokeCount"`
	Strokes  []raster.Stroke `json:"strokes,omitempty"`
}

type effectOut struct {
	ID     string `json:"id"`
	Effect string `json:"effect"`
	Name   string `json:"name,omitempty"`
}

type faceOut struct {
	ID       string               `json:"id"`
	Name     string               `json:"name"`
	ObjectID string               `json:"objectId"`
	Kind     string               `json:"kind"`
	Role     string               `json:"role"`
	ParentID *string              `json:"parentId,omitempty"`
	SizePx   [2]float64           `json:"sizePx"`
	Aspect   float64              `json:"aspect"`
	Atlas    any                  `json:"atlas"`
	Corners  []cornerOut          `json:"corners"`
	Edges    []unfold.Edge        `json:"edges,omitempty"`
	Details  []detailOut          `json:"details"`
	Layers   []scene.ContentLayer `json:"layers"`
	Drawings []drawingOut         `json:"drawingLayers"`
	Effects  []effectOut          `json:"otherEffects,omitempty"`
}

// layerName is a drawing effect's layer name ("drawing" for the editor's unnamed one).
func layerName(ef scene.SurfaceEffect) string {
	if ef.Name != "" {
		return ef.Name
	}
	return DefaultLayer
}

// DefaultLayer is the drawing layer a write uses when none is named (the editor's own drawing).
const DefaultLayer = "drawing"

func drawingsOf(sf *scene.Surface, full bool) ([]drawingOut, []effectOut) {
	draws, others := []drawingOut{}, []effectOut{}
	for _, ef := range sf.Effects {
		if ef.Effect != "drawing" {
			others = append(others, effectOut{ID: ef.ID, Effect: ef.Effect, Name: ef.Name})
			continue
		}
		st := raster.ParseStrokes(ef.Params["strokes"])
		rv := 1.0
		if f, ok := ef.Params["reveal"].(float64); ok {
			rv = f
		}
		d := drawingOut{EffectID: ef.ID, Layer: layerName(ef), Enabled: ef.Enabled, Reveal: rv, Count: len(st)}
		if full {
			d.Strokes = st
		}
		draws = append(draws, d)
	}
	return draws, others
}

// describe is a face's (or detail's) drawing frame.
func describe(sc *scene.Scene, o *scene.Object, sf *scene.Surface, atlas scene.Atlas, affs map[string]unfold.Affine, full bool) faceOut {
	f := faceOut{ID: sf.ID, Name: sf.Name, ObjectID: o.ID, Kind: sf.Kind, Role: sf.Role, ParentID: sf.ParentID,
		Corners: []cornerOut{}, Details: []detailOut{}, Layers: sf.Layers}
	if f.Layers == nil {
		f.Layers = []scene.ContentLayer{}
	}
	g := unfold.SurfaceGeometry(sc, sf)
	if g != nil {
		f.SizePx = v2(g.Size)
		f.Aspect = r4(g.Aspect())
	}
	aff, placed := affs[sf.ID]
	if r, ok := atlas.Faces[sf.ID]; ok {
		f.Atlas = map[string]any{"x": r.X, "y": r.Y, "w": r.W, "h": r.H, "rotation": r.Rotation}
	} else if placed {
		f.Atlas = map[string]any{"origin": v2(aff.O), "uAxis": v2(aff.U), "vAxis": v2(aff.V), "note": "a detail: atlas px = origin + u·uAxis + v·vAxis"}
	}
	if g != nil && sf.Kind != "circle" && sf.Kind != "line" {
		for i, id := range sf.PointIDs {
			p := sc.Point(id)
			if p == nil {
				continue
			}
			c := cornerOut{N: i + 1, PointID: id, Scene: [2]float64{r2(p.X), r2(p.Y)}, UV: v4(g.SceneToUV(p.X, p.Y))}
			if sf.Kind == "quad" && i < 4 {
				c.UV = [2]float64{[]float64{0, 1, 1, 0}[i], []float64{0, 0, 1, 1}[i]}
			}
			if placed {
				a := v2(aff.Apply(c.UV[0], c.UV[1]))
				c.Atlas = &a
			}
			f.Corners = append(f.Corners, c)
		}
	} else if sf.Kind == "circle" && len(sf.PointIDs) == 2 {
		for i, id := range sf.PointIDs {
			if p := sc.Point(id); p != nil && g != nil {
				f.Corners = append(f.Corners, cornerOut{N: i + 1, PointID: id, Scene: [2]float64{r2(p.X), r2(p.Y)}, UV: v4(g.SceneToUV(p.X, p.Y))})
			}
		}
	}
	f.Edges = unfold.Edges(sc, o, sf, atlas, affs)
	for i := range o.Surfaces {
		d := &o.Surfaces[i]
		if d.ParentID == nil || *d.ParentID != sf.ID {
			continue
		}
		f.Details = append(f.Details, detailIn(sc, d, sf))
	}
	f.Drawings, f.Effects = drawingsOf(sf, full)
	return f
}

// detailIn places a detail in its parent's UV.
func detailIn(sc *scene.Scene, d, parent *scene.Surface) detailOut {
	out := detailOut{ID: d.ID, Name: d.Name, Kind: d.Kind, Layers: len(d.Layers)}
	for _, ef := range d.Effects {
		if ef.Effect == "drawing" {
			out.Drawings++
		}
	}
	g, pg := unfold.SurfaceGeometry(sc, d), unfold.SurfaceGeometry(sc, parent)
	if g == nil || pg == nil {
		return out
	}
	u0, v0, u1, v1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range g.Outline {
		uv := pg.SceneToUV(p[0], p[1])
		u0, v0, u1, v1 = math.Min(u0, uv[0]), math.Min(v0, uv[1]), math.Max(u1, uv[0]), math.Max(v1, uv[1])
	}
	out.UVBox = [4]float64{r4(u0), r4(v0), r4(u1), r4(v1)}
	out.UVCenter = [2]float64{r4((u0 + u1) / 2), r4((v0 + v1) / 2)}
	switch d.Kind {
	case "circle":
		out.UVCenter = v4(pg.SceneToUV(g.Corners[0][0], g.Corners[0][1]))
		out.RadiusPx = r2(g.Size[0] / 2)
	default:
		for _, p := range g.Corners {
			out.Corners = append(out.Corners, v4(pg.SceneToUV(p[0], p[1])))
		}
	}
	return out
}

func unfoldGet(ctx context.Context, e *tools.Env, in objectIn) (*mcp.CallToolResult, error) {
	sc, draft, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	o, err := findObject(sc, in.ObjectID)
	if err != nil {
		return nil, err
	}
	atlas, stored := unfold.Resolve(sc, o)
	affs := unfold.Affines(sc, o, atlas)
	faces := []faceOut{}
	others := []map[string]any{}
	for i := range o.Surfaces {
		sf := &o.Surfaces[i]
		if _, ok := atlas.Faces[sf.ID]; ok {
			faces = append(faces, describe(sc, o, sf, atlas, affs, false))
		} else if sf.ParentID == nil {
			others = append(others, map[string]any{"id": sf.ID, "name": sf.Name, "kind": sf.Kind, "role": sf.Role,
				"why": "not in the atlas (only faces that are not lines or masks are)"})
		}
	}
	objLayers := o.Layers
	if objLayers == nil {
		objLayers = []scene.ContentLayer{}
	}
	out := map[string]any{
		"object":      map[string]any{"id": o.ID, "name": o.Name},
		"conventions": UV + " Atlas px: (0,0) top left of the atlas, x right, y down; a face's uv lands at its rect by its rotation.",
		"atlas":       map[string]any{"width": atlas.Width, "height": atlas.Height, "stored": stored},
		"faces":       faces, "notInAtlas": others, "objectLayers": objLayers,
		"draw": "face_draw(surface_id, strokes) in face UV; object_draw(object_id, strokes) in atlas px; layer_add for pictures and gradients; face_template_get to see the frame.",
	}
	head := fmt.Sprintf("Object %s (%s): %d faces in a %.0f×%.0f atlas (%s).", o.Name, o.ID, len(faces), atlas.Width, atlas.Height,
		map[bool]string{true: "stored", false: "auto layout, not stored yet"}[stored])
	if draft != "" {
		head += " From your draft " + draft + "."
	}
	return tools.JSON(head, out), nil
}

func faceGet(ctx context.Context, e *tools.Env, in surfaceIn) (*mcp.CallToolResult, error) {
	sc, draft, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	o, sf, err := findSurface(sc, in.SurfaceID)
	if err != nil {
		return nil, err
	}
	atlas, _ := unfold.Resolve(sc, o)
	affs := unfold.Affines(sc, o, atlas)
	f := describe(sc, o, sf, atlas, affs, true)
	out := map[string]any{"face": f, "conventions": UV, "strokes": Strokes}
	head := fmt.Sprintf("Face %s (%s) of %s: %.0f×%.0f scene px flat (aspect %.3f), %d details, %d drawing layers.",
		sf.Name, sf.ID, o.Name, f.SizePx[0], f.SizePx[1], f.Aspect, len(f.Details), len(f.Drawings))
	if draft != "" {
		head += " From your draft " + draft + "."
	}
	return tools.JSON(head, out), nil
}
