// Package scenes holds the MCP tools over scenes: reading geometry and the timeline, and writing surfaces, clips and
// cues into the session's draft, its diff and the proposal.
package scenes

import (
	"context"
	"fmt"
	"math"
	"sort"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/mcp/tools"
)

// Register adds the scene tools.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "scene_get", Title: "Read the scene",
		Description: "The scene you are working on (your draft once you have written, else the live scene): output size and orientation, every object with its surfaces and their points in scene pixels (0,0 = top left), the backdrop layers and a timeline summary. Start here. To dress an object (draw its real details on its faces), go on with object_unfold_get, face_template_get, face_draw and face_render; docs://drawing explains face UV and strokes."}, sceneGet)
	tools.Add(s, env, &mcp.Tool{Name: "surface_get", Title: "Read one surface",
		Description: "One surface in detail: points, edges with lengths, area, centroid, which points it shares with other surfaces and which faces touch it, its parent and details."}, surfaceGet)
	tools.Add(s, env, &mcp.Tool{Name: "timeline_get", Title: "Read the timeline",
		Description: "Tracks (with their targets), clips (effect, start, end, fades, hold, params) and cues (GO stops) of the scene; with t, also the clips in effect at t (a held clip keeps its end state until the next clip of that effect on its track). Sound tracks (target kind sound) hold sound clips {sound, offset, volume}; a cue may carry a sound that plays when it starts."}, timelineGet)
	tools.Add(s, env, &mcp.Tool{Name: "reference_photo_get", Title: "See the reference photo",
		Description: "The photo taken from the projector lens position (never projected): what the real objects look like from the projector. Scene pixels line up with it when it was taken at the lens."}, referencePhoto)
	registerWrite(s, env)
}

type noIn struct{}

// pointsOf is a surface's points as [[x, y]].
func pointsOf(sc *scene.Scene, sf *scene.Surface) [][2]float64 {
	out := [][2]float64{}
	for _, p := range sc.SurfacePoints(sf) {
		out = append(out, [2]float64{p.X, p.Y})
	}
	return out
}

func sceneGet(ctx context.Context, e *tools.Env, _ noIn) (*mcp.CallToolResult, error) {
	sc, draft, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	set, err := e.Setup(ctx, sc)
	if err != nil {
		return nil, err
	}
	w, h := set.Output.SceneSize()
	type surf struct {
		ID       string       `json:"id"`
		Name     string       `json:"name"`
		Kind     string       `json:"kind"`
		Role     string       `json:"role"`
		PointIDs []string     `json:"pointIds"`
		Points   [][2]float64 `json:"points"`
		Parent   *string      `json:"parentId,omitempty"`
		Effects  []string     `json:"effects,omitempty"`
		Visible  bool         `json:"visible"`
	}
	type obj struct {
		ID       string   `json:"id"`
		Name     string   `json:"name"`
		Tags     []string `json:"tags"`
		Surfaces []surf   `json:"surfaces"`
	}
	objs := []obj{}
	for _, o := range sc.Objects {
		oo := obj{ID: o.ID, Name: o.Name, Tags: o.Tags, Surfaces: []surf{}}
		for i := range o.Surfaces {
			sf := &o.Surfaces[i]
			var fx []string
			for _, ef := range sf.Effects {
				fx = append(fx, ef.Effect)
			}
			oo.Surfaces = append(oo.Surfaces, surf{ID: sf.ID, Name: sf.Name, Kind: sf.Kind, Role: sf.Role, PointIDs: sf.PointIDs,
				Points: pointsOf(sc, sf), Parent: sf.ParentID, Effects: fx, Visible: sf.Visible})
		}
		objs = append(objs, oo)
	}
	layers := map[string]any{}
	for _, m := range scene.BackdropModes {
		st := sc.Backdrop.Stack(m)
		list := []map[string]any{}
		for _, l := range st.Layers {
			ll := map[string]any{"id": l.ID, "kind": l.Kind, "ref": l.Ref, "name": l.Name, "visible": l.Visible, "opacity": l.Opacity, "blend": l.Blend}
			if l.Motion != nil {
				ll["motion"] = l.Motion
			}
			list = append(list, ll)
		}
		if m != scene.ModeStatic && m != scene.ModeLive {
			layers[m] = list
			continue
		}
		// static and live: one light through attachments (gobos), protocol §15
		atts := []map[string]any{}
		for _, a := range st.Attachments {
			atts = append(atts, map[string]any{"id": a.ID, "gobo": a.Gobo, "name": a.Name, "visible": a.Visible, "opacity": a.Opacity,
				"rotation": a.Rotation, "offsetX": a.OffsetX, "offsetY": a.OffsetY, "scale": a.Scale, "params": a.Params, "motion": a.Motion})
		}
		layers[m] = map[string]any{"layers": list, "light": st.Light, "attachments": atts}
	}
	out := map[string]any{
		"id": sc.ID, "name": sc.Name, "version": sc.Version, "draftId": nilIfEmpty(draft),
		"output":    map[string]any{"sceneWidth": w, "sceneHeight": h, "orientation": set.Output.Orientation, "physicalWidth": set.Output.Width, "physicalHeight": set.Output.Height, "flipH": set.Output.FlipH, "flipV": set.Output.FlipV},
		"reference": set.ReferenceAsset, "calibrationId": set.CalibrationID,
		"mode": sc.Mode, "kind": sc.Kind, "underlay": sc.Underlay,
		"objects": objs, "backdrop": layers,
		"timeline": map[string]any{"duration": sc.Timeline.Duration, "tracks": len(sc.Timeline.Tracks), "clips": len(sc.Timeline.Clips), "cues": len(sc.Timeline.Cues)},
	}
	head := fmt.Sprintf("Scene %s (%s), %d objects, %.0fx%.0f scene px, %s on air. Mapped objects only show on the wall in objects mode.", sc.Name, sc.ID, len(sc.Objects), w, h, sc.Mode)
	if draft != "" {
		head += " Showing your draft " + draft + "."
	}
	return tools.JSON(head, out), nil
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

type surfaceIn struct {
	ID string `json:"id" jsonschema:"surface id (or name)"`
}

// findSurface resolves a surface by id or name.
func findSurface(sc *scene.Scene, idOrName string) (*scene.Object, *scene.Surface, error) {
	if oi, si, ok := sc.FindSurface(idOrName); ok {
		return &sc.Objects[oi], &sc.Objects[oi].Surfaces[si], nil
	}
	for oi := range sc.Objects {
		for si := range sc.Objects[oi].Surfaces {
			if sc.Objects[oi].Surfaces[si].Name == idOrName {
				return &sc.Objects[oi], &sc.Objects[oi].Surfaces[si], nil
			}
		}
	}
	return nil, nil, app_errors.NotFound("Surface %s does not exist. scene_get lists the surfaces.", idOrName)
}

// Geometry of a polygon.
func area(p []scene.Point) float64 {
	a := 0.0
	for i := range p {
		j := (i + 1) % len(p)
		a += p[i].X*p[j].Y - p[j].X*p[i].Y
	}
	return math.Abs(a) / 2
}

func centroid(p []scene.Point) [2]float64 {
	var x, y float64
	for _, q := range p {
		x += q.X
		y += q.Y
	}
	n := float64(max(len(p), 1))
	return [2]float64{round(x / n), round(y / n)}
}

func round(v float64) float64 { return math.Round(v*100) / 100 }

// Edges are a surface's edges as point id pairs (closed unless it is a line).
func Edges(sf *scene.Surface) [][2]string {
	ids := sf.PointIDs
	var out [][2]string
	for i := 0; i+1 < len(ids); i++ {
		out = append(out, [2]string{ids[i], ids[i+1]})
	}
	if sf.Kind != "line" && sf.Kind != "circle" && len(ids) > 2 {
		out = append(out, [2]string{ids[len(ids)-1], ids[0]})
	}
	return out
}

func surfaceGet(ctx context.Context, e *tools.Env, in surfaceIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	o, sf, err := findSurface(sc, in.ID)
	if err != nil {
		return nil, err
	}
	pts := sc.SurfacePoints(sf)
	edges := []map[string]any{}
	for _, ed := range Edges(sf) {
		a, b := sc.Point(ed[0]), sc.Point(ed[1])
		if a == nil || b == nil {
			continue
		}
		edges = append(edges, map[string]any{"from": ed[0], "to": ed[1], "length": round(math.Hypot(b.X-a.X, b.Y-a.Y))})
	}
	shared := map[string][]string{}
	touching := map[string]bool{}
	children := []string{}
	mine := map[string]bool{}
	for _, id := range sf.PointIDs {
		mine[id] = true
	}
	for oi := range sc.Objects {
		for si := range sc.Objects[oi].Surfaces {
			other := &sc.Objects[oi].Surfaces[si]
			if other.ID == sf.ID {
				continue
			}
			if other.ParentID != nil && *other.ParentID == sf.ID {
				children = append(children, other.ID)
			}
			for _, id := range other.PointIDs {
				if mine[id] {
					shared[id] = append(shared[id], other.ID)
					touching[other.ID] = true
				}
			}
		}
	}
	touch := []string{}
	for id := range touching {
		touch = append(touch, id)
	}
	sort.Strings(touch)
	out := map[string]any{"id": sf.ID, "name": sf.Name, "object": o.ID, "kind": sf.Kind, "role": sf.Role, "parentId": sf.ParentID,
		"points": pts, "edges": edges, "area": round(area(pts)), "centroid": centroid(pts), "sharedPoints": shared,
		"touches": touch, "details": children, "effects": sf.Effects, "opacity": sf.Opacity, "softEdge": sf.SoftEdge, "mesh": sf.Mesh}
	if sf.Kind == "circle" && len(pts) == 2 {
		out["radius"] = round(math.Hypot(pts[1].X-pts[0].X, pts[1].Y-pts[0].Y))
		delete(out, "area")
	}
	return tools.JSON("", out), nil
}

type timelineIn struct {
	T *float64 `json:"t,omitempty" jsonschema:"seconds: also list the clips in effect at t (playing, or held after their end)"`
}

func timelineGet(ctx context.Context, e *tools.Env, in timelineIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	head := fmt.Sprintf("%.1f s, %d tracks, %d clips, %d cues.", sc.Timeline.Duration, len(sc.Timeline.Tracks),
		len(sc.Timeline.Clips), len(sc.Timeline.Cues))
	if in.T == nil {
		return tools.JSON(head, sc.Timeline), nil
	}
	// (§20) the state at t: every clip up to t with its hold, the same from a seek as from playing there
	return tools.JSON(head+fmt.Sprintf(" State at %.2f s: see at.", *in.T), struct {
		scene.Timeline
		At []scene.ClipState `json:"at"`
	}{sc.Timeline, sc.Timeline.StateAt(*in.T)}), nil
}

func referencePhoto(ctx context.Context, e *tools.Env, _ noIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	set, err := e.Setup(ctx, sc)
	if err != nil {
		return nil, err
	}
	if set.ReferenceAsset == nil || *set.ReferenceAsset == "" {
		return tools.Text("No reference photo yet. Ask the user to take one from the lens position (phone: \"just take a photo\"), or use camera_snapshot."), nil
	}
	b, err := e.D.Assets.Read(ctx, *set.ReferenceAsset)
	if err != nil {
		return nil, err
	}
	img, orig, err := tools.ImageBytes(b)
	if err != nil {
		return nil, err
	}
	w, h := set.Output.SceneSize()
	ob := orig.Bounds()
	return tools.WithImages(fmt.Sprintf("Reference photo %s, %dx%d px (the scene is %.0fx%.0f; scale photo pixels by %.3f to get scene pixels).",
		*set.ReferenceAsset, ob.Dx(), ob.Dy(), w, h, w/float64(ob.Dx())), img), nil
}
