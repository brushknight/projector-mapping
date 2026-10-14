package scenes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/mcp/tools"
	soundtools "projmap/internal/infrastructure/mcp/tools/sounds"
)

func registerWrite(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "surface_create", Title: "Create a surface",
		Description: "Adds a surface to an object in your draft (the object is created when no object has that id or name). Points are scene pixels, quads clockwise from top left. A point within 3 px of an existing point reuses it (weld), so faces that share a corner move together; pass an existing point id to reuse it exactly."}, surfaceCreate)
	tools.Add(s, env, &mcp.Tool{Name: "surface_update", Title: "Change a surface",
		Description: "Changes a surface's name, kind, role, point ids, parent, visibility, opacity, soft edge or always-on effects (effects replaces the whole list)."}, surfaceUpdate)
	tools.Add(s, env, &mcp.Tool{Name: "surface_nudge", Title: "Nudge points",
		Description: "Moves a surface's points by dx, dy scene pixels (all of them, or only point_id). Shared points move every face that uses them. Use after alignment_error or camera_compare to fix small misalignments."}, surfaceNudge)
	tools.Add(s, env, &mcp.Tool{Name: "clip_add", Title: "Add a clip",
		Description: "Places an effect on the timeline for a target (surface, object or all) from start to end seconds. Reuses the track of that target or makes one. Params follow the effect's schema (effects_list). " +
			"For a sound effect pass sound (a library sha or name from sound_list), optional offset (seconds into the file) and volume (0..1): the clip goes on the scene's first sound track (made when there is none) and plays from start to end."}, clipAdd)
	tools.Add(s, env, &mcp.Tool{Name: "clip_update", Title: "Change a clip",
		Description: "Changes a clip's effect, timing, fades or params (params merge into the existing ones)."}, clipUpdate)
	tools.Add(s, env, &mcp.Tool{Name: "clip_remove", Title: "Remove a clip", Description: "Removes a clip from the timeline."}, clipRemove)
	tools.Add(s, env, &mcp.Tool{Name: "cue_add", Title: "Add a cue",
		Description: "Adds a cue (a GO stop on the phone) at a time in seconds. auto_follow lets playback run through it."}, cueAdd)
	tools.Add(s, env, &mcp.Tool{Name: "cue_update", Title: "Change a cue", Description: "Changes a cue's time, label or auto_follow."}, cueUpdate)
	tools.Add(s, env, &mcp.Tool{Name: "draft_diff", Title: "Summarize the draft",
		Description: "A human-readable summary of everything your draft changes against the live scene it started from."}, draftDiff)
	tools.Add(s, env, &mcp.Tool{Name: "proposal_submit", Title: "Submit the proposal",
		Description: "Hands your draft to the user with a one-line summary. The editor shows apply, preview and discard. Call it when you are done."}, proposalSubmit)
	tools.Add(s, env, &mcp.Tool{Name: "draft_apply", Title: "Apply your draft",
		Description: "Puts your draft on the live scene (the wall shows it in objects mode). Needs the editor's \"agent may apply\" toggle (agentMayApply), which is off by default; without it, use proposal_submit and let the user apply. Your next write starts a new draft."}, draftApply)
}

// NewID is prefix_<8 hex>.
func NewID(prefix string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

// PointIn is a point to place.
type PointIn struct {
	ID string  `json:"id,omitempty" jsonschema:"existing point id to reuse (x and y are ignored then)"`
	X  float64 `json:"x" jsonschema:"scene pixels from the left"`
	Y  float64 `json:"y" jsonschema:"scene pixels from the top"`
}

// SurfaceIn creates a surface.
type SurfaceIn struct {
	Object   string    `json:"object" jsonschema:"object id or name; a new object is made when none matches"`
	Name     string    `json:"name" jsonschema:"surface name, for example top or bay 1"`
	Kind     string    `json:"kind,omitempty" jsonschema:"quad (4 points clockwise from top left), tri, poly, circle (centre, rim), line or mask; default quad"`
	Role     string    `json:"role,omitempty" jsonschema:"face, edge or detail; default face (detail needs parent_id)"`
	Points   []PointIn `json:"points" jsonschema:"the points in order"`
	ParentID string    `json:"parent_id,omitempty" jsonschema:"for details: the face they sit in"`
	NoWeld   bool      `json:"no_weld,omitempty" jsonschema:"true keeps every point separate even when one is within 3 px of an existing point"`
}

// CreateSurface writes a new surface into the session's draft and returns its id and point ids.
func CreateSurface(ctx context.Context, e *tools.Env, in SurfaceIn) (string, []string, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return "", nil, err
	}
	if in.Kind == "" {
		in.Kind = "quad"
	}
	if in.Role == "" {
		in.Role = "face"
		if in.ParentID != "" {
			in.Role = "detail"
		}
	}
	if strings.TrimSpace(in.Name) == "" {
		return "", nil, app_errors.BadRequest("Name the surface.")
	}
	var ops []docpatch.Op
	ids := make([]string, 0, len(in.Points))
	pool := append([]scene.Point(nil), sc.Points...)
	for _, p := range in.Points {
		if p.ID != "" {
			if sc.Point(p.ID) == nil {
				return "", nil, app_errors.NotFound("Point %s does not exist.", p.ID)
			}
			ids = append(ids, p.ID)
			continue
		}
		if !in.NoWeld {
			found := ""
			for _, q := range pool {
				if math.Hypot(q.X-p.X, q.Y-p.Y) <= 3 {
					found = q.ID
					break
				}
			}
			if found != "" {
				ids = append(ids, found)
				continue
			}
		}
		np := scene.Point{ID: NewID("p"), X: round(p.X), Y: round(p.Y)}
		pool = append(pool, np)
		ops = append(ops, docpatch.Add("/points/-", np))
		ids = append(ids, np.ID)
	}
	sf := scene.Surface{ID: NewID("srf"), Name: in.Name, Kind: in.Kind, Role: in.Role, PointIDs: ids, Visible: true, Opacity: 1,
		Effects: []scene.SurfaceEffect{}}
	if in.ParentID != "" {
		_, parent, err := findSurface(sc, in.ParentID)
		if err != nil {
			return "", nil, err
		}
		pid := parent.ID
		sf.ParentID = &pid
	}
	if sf.Role == "face" {
		sf.SoftEdge = 8
	}
	oi := sc.FindObject(in.Object)
	if oi < 0 {
		name := in.Object
		if name == "" {
			name = in.Name
		}
		obj := scene.Object{ID: NewID("obj"), Name: name, Tags: []string{}, Visible: true, Surfaces: []scene.Surface{sf}}
		ops = append(ops, docpatch.Add("/objects/-", obj))
	} else {
		ops = append(ops, docpatch.Add(fmt.Sprintf("/objects/%d/surfaces/-", oi), sf))
	}
	if err := e.Write(ctx, ops); err != nil {
		return "", nil, err
	}
	return sf.ID, ids, nil
}

func surfaceCreate(ctx context.Context, e *tools.Env, in SurfaceIn) (*mcp.CallToolResult, error) {
	id, pts, err := CreateSurface(ctx, e, in)
	if err != nil {
		return nil, err
	}
	return tools.Text("Created surface %s (%s) with points %s in your draft.", id, in.Name, strings.Join(pts, ", ")), nil
}

type surfaceUpdateIn struct {
	ID       string                `json:"id" jsonschema:"surface id or name"`
	Name     *string               `json:"name,omitempty"`
	Kind     *string               `json:"kind,omitempty"`
	Role     *string               `json:"role,omitempty"`
	PointIDs []string              `json:"point_ids,omitempty" jsonschema:"replaces the point list"`
	ParentID *string               `json:"parent_id,omitempty" jsonschema:"empty string clears the parent"`
	Visible  *bool                 `json:"visible,omitempty"`
	Opacity  *float64              `json:"opacity,omitempty"`
	SoftEdge *float64              `json:"soft_edge,omitempty"`
	Effects  []scene.SurfaceEffect `json:"effects,omitempty" jsonschema:"always-on effects [{id, effect, enabled, params}]; replaces the list"`
}

func surfacePath(sc *scene.Scene, id string) (string, *scene.Surface, error) {
	_, sf, err := findSurface(sc, id)
	if err != nil {
		return "", nil, err
	}
	oi, si, _ := sc.FindSurface(sf.ID)
	return fmt.Sprintf("/objects/%d/surfaces/%d", oi, si), sf, nil
}

func surfaceUpdate(ctx context.Context, e *tools.Env, in surfaceUpdateIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	base, sf, err := surfacePath(sc, in.ID)
	if err != nil {
		return nil, err
	}
	var ops []docpatch.Op
	set := func(field string, v any) { ops = append(ops, docpatch.Replace(base+"/"+field, v)) }
	if in.Name != nil {
		set("name", *in.Name)
	}
	if in.Kind != nil {
		set("kind", *in.Kind)
	}
	if in.Role != nil {
		set("role", *in.Role)
	}
	if in.PointIDs != nil {
		set("pointIds", in.PointIDs)
	}
	if in.ParentID != nil {
		if *in.ParentID == "" {
			set("parentId", nil)
		} else {
			set("parentId", *in.ParentID)
		}
	}
	if in.Visible != nil {
		set("visible", *in.Visible)
	}
	if in.Opacity != nil {
		set("opacity", *in.Opacity)
	}
	if in.SoftEdge != nil {
		set("softEdge", *in.SoftEdge)
	}
	if in.Effects != nil {
		for i := range in.Effects {
			if in.Effects[i].ID == "" {
				in.Effects[i].ID = NewID("fx")
			}
			if in.Effects[i].Params == nil {
				in.Effects[i].Params = map[string]any{}
			}
		}
		set("effects", in.Effects)
	}
	if len(ops) == 0 {
		return tools.Text("Nothing to change on %s.", sf.ID), nil
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Updated surface %s in your draft.", sf.ID), nil
}

type nudgeIn struct {
	ID      string  `json:"id" jsonschema:"surface id or name"`
	DX      float64 `json:"dx" jsonschema:"scene pixels to the right"`
	DY      float64 `json:"dy" jsonschema:"scene pixels down"`
	PointID string  `json:"point_id,omitempty" jsonschema:"move only this point of the surface"`
}

func surfaceNudge(ctx context.Context, e *tools.Env, in nudgeIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	_, sf, err := findSurface(sc, in.ID)
	if err != nil {
		return nil, err
	}
	ids := sf.PointIDs
	if in.PointID != "" {
		ids = []string{in.PointID}
	}
	var ops []docpatch.Op
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		i := sc.PointIndex(id)
		if i < 0 {
			return nil, app_errors.NotFound("Point %s does not exist.", id)
		}
		p := sc.Points[i]
		ops = append(ops, docpatch.Replace(fmt.Sprintf("/points/%d/x", i), round(p.X+in.DX)), docpatch.Replace(fmt.Sprintf("/points/%d/y", i), round(p.Y+in.DY)))
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Moved %d points of %s by (%.2f, %.2f).", len(seen), sf.ID, in.DX, in.DY), nil
}

// TargetIn is a track target.
type TargetIn struct {
	Kind string `json:"kind" jsonschema:"surface, object, all or sound"`
	ID   string `json:"id,omitempty" jsonschema:"surface or object id (or name); empty for all"`
}

type clipAddIn struct {
	Target  TargetIn       `json:"target,omitempty" jsonschema:"the track's target (not needed with track, or for a sound clip)"`
	Track   string         `json:"track,omitempty" jsonschema:"an existing track id instead of a target"`
	Effect  string         `json:"effect,omitempty" jsonschema:"effect id from effects_list (sound for a sound clip, implied by sound)"`
	Start   float64        `json:"start" jsonschema:"seconds"`
	End     float64        `json:"end,omitempty" jsonschema:"seconds (a sound clip without end lasts as long as its sound)"`
	FadeIn  *float64       `json:"fade_in,omitempty" jsonschema:"seconds, default 0.2"`
	FadeOut *float64       `json:"fade_out,omitempty" jsonschema:"seconds, default 0.2"`
	Params  map[string]any `json:"params,omitempty"`
	Sound   string         `json:"sound,omitempty" jsonschema:"for a sound clip: a library sound sha or name (sound_list)"`
	Offset  *float64       `json:"offset,omitempty" jsonschema:"for a sound clip: seconds into the file where the clip starts, default 0"`
	Volume  *float64       `json:"volume,omitempty" jsonschema:"for a sound clip: 0..1, default 1"`
}

func resolveTarget(sc *scene.Scene, t TargetIn) (scene.Target, string, error) {
	switch t.Kind {
	case "all":
		return scene.Target{Kind: "all"}, "all", nil
	case "object":
		oi := sc.FindObject(t.ID)
		if oi < 0 {
			return scene.Target{}, "", app_errors.NotFound("Object %s does not exist.", t.ID)
		}
		id := sc.Objects[oi].ID
		return scene.Target{Kind: "object", ID: &id}, sc.Objects[oi].Name, nil
	case "surface":
		o, sf, err := findSurface(sc, t.ID)
		if err != nil {
			return scene.Target{}, "", err
		}
		id := sf.ID
		return scene.Target{Kind: "surface", ID: &id}, o.Name + " · " + sf.Name, nil
	case scene.TargetSound:
		return scene.Target{Kind: scene.TargetSound}, "sound", nil
	}
	return scene.Target{}, "", app_errors.BadRequest("target.kind must be surface, object, all or sound.")
}

func clipAdd(ctx context.Context, e *tools.Env, in clipAddIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	var ops []docpatch.Op
	track := in.Track
	isSound := in.Sound != "" || in.Effect == scene.EffectSound || in.Target.Kind == scene.TargetSound
	if isSound {
		return soundClipAdd(ctx, e, sc, in)
	}
	if track == "" {
		tg, name, err := resolveTarget(sc, in.Target)
		if err != nil {
			return nil, err
		}
		for _, tr := range sc.Timeline.Tracks {
			if reflect.DeepEqual(tr.Target, tg) {
				track = tr.ID
				break
			}
		}
		if track == "" {
			nt := scene.Track{ID: NewID("trk"), Name: name, Target: tg}
			ops = append(ops, docpatch.Add("/timeline/tracks/-", nt))
			track = nt.ID
		}
	}
	fi, fo := 0.2, 0.2
	if in.FadeIn != nil {
		fi = *in.FadeIn
	}
	if in.FadeOut != nil {
		fo = *in.FadeOut
	}
	if fi+fo > in.End-in.Start {
		fi, fo = 0, 0
	}
	if in.Params == nil {
		in.Params = map[string]any{}
	}
	cl := scene.Clip{ID: NewID("clp"), TrackID: track, Effect: in.Effect, Start: in.Start, End: in.End, FadeIn: fi, FadeOut: fo, Params: in.Params}
	ops = append(ops, docpatch.Add("/timeline/clips/-", cl))
	if in.End > sc.Timeline.Duration {
		ops = append(ops, docpatch.Replace("/timeline/duration", math.Ceil(in.End)))
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Added clip %s (%s, %.2f to %.2f s) on track %s.", cl.ID, cl.Effect, cl.Start, cl.End, track), nil
}

// soundClipAdd puts a sound clip on a sound track: the given track, else the scene's first sound track (made when
// there is none).
func soundClipAdd(ctx context.Context, e *tools.Env, sc *scene.Scene, in clipAddIn) (*mcp.CallToolResult, error) {
	ref := in.Sound
	if ref == "" {
		if v, ok := in.Params["sound"].(string); ok {
			ref = v
		}
	}
	if ref == "" {
		return nil, app_errors.BadRequest("A sound clip needs sound: a library sha or name (sound_list).")
	}
	a, err := soundtools.FindSound(ctx, e, ref)
	if err != nil {
		return nil, err
	}
	var ops []docpatch.Op
	track := in.Track
	if track != "" {
		ok := false
		for _, tr := range sc.Timeline.Tracks {
			if tr.ID == track {
				ok = tr.Target.Kind == scene.TargetSound
			}
		}
		if !ok {
			return nil, app_errors.BadRequest("Track %s is not a sound track; leave track out to use the scene's sound track.", track)
		}
	} else {
		for _, tr := range sc.Timeline.Tracks {
			if tr.Target.Kind == scene.TargetSound {
				track = tr.ID
				break
			}
		}
		if track == "" {
			nt := scene.Track{ID: NewID("trk"), Name: "sound", Target: scene.Target{Kind: scene.TargetSound}}
			ops = append(ops, docpatch.Add("/timeline/tracks/-", nt))
			track = nt.ID
		}
	}
	end := in.End
	if end <= in.Start && a.Duration != nil && *a.Duration > 0 {
		end = in.Start + *a.Duration
	}
	params := map[string]any{"sound": a.SHA, "offset": 0.0, "volume": 1.0}
	if in.Offset != nil {
		params["offset"] = *in.Offset
	}
	if in.Volume != nil {
		params["volume"] = *in.Volume
	}
	fi, fo := 0.0, 0.0
	if in.FadeIn != nil {
		fi = *in.FadeIn
	}
	if in.FadeOut != nil {
		fo = *in.FadeOut
	}
	cl := scene.Clip{ID: NewID("clp"), TrackID: track, Effect: scene.EffectSound, Start: in.Start, End: end, FadeIn: fi, FadeOut: fo, Params: params}
	ops = append(ops, docpatch.Add("/timeline/clips/-", cl))
	if end > sc.Timeline.Duration {
		ops = append(ops, docpatch.Replace("/timeline/duration", math.Ceil(end)))
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Added sound clip %s (%s, %.2f to %.2f s) on sound track %s.", cl.ID, a.Name, cl.Start, cl.End, track), nil
}

type clipUpdateIn struct {
	ID      string         `json:"id"`
	Effect  *string        `json:"effect,omitempty"`
	Start   *float64       `json:"start,omitempty"`
	End     *float64       `json:"end,omitempty"`
	FadeIn  *float64       `json:"fade_in,omitempty"`
	FadeOut *float64       `json:"fade_out,omitempty"`
	Params  map[string]any `json:"params,omitempty" jsonschema:"merged into the clip's params"`
}

func clipIndex(sc *scene.Scene, id string) (int, error) {
	for i, c := range sc.Timeline.Clips {
		if c.ID == id {
			return i, nil
		}
	}
	return -1, app_errors.NotFound("Clip %s does not exist. timeline_get lists the clips.", id)
}

func clipUpdate(ctx context.Context, e *tools.Env, in clipUpdateIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	i, err := clipIndex(sc, in.ID)
	if err != nil {
		return nil, err
	}
	cl := sc.Timeline.Clips[i]
	if in.Effect != nil {
		cl.Effect = *in.Effect
	}
	if in.Start != nil {
		cl.Start = *in.Start
	}
	if in.End != nil {
		cl.End = *in.End
	}
	if in.FadeIn != nil {
		cl.FadeIn = *in.FadeIn
	}
	if in.FadeOut != nil {
		cl.FadeOut = *in.FadeOut
	}
	for k, v := range in.Params {
		cl.Params[k] = v
	}
	ops := []docpatch.Op{docpatch.Replace(fmt.Sprintf("/timeline/clips/%d", i), cl)}
	if cl.End > sc.Timeline.Duration {
		ops = append(ops, docpatch.Replace("/timeline/duration", math.Ceil(cl.End)))
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Updated clip %s.", cl.ID), nil
}

type idIn struct {
	ID string `json:"id"`
}

func clipRemove(ctx context.Context, e *tools.Env, in idIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	i, err := clipIndex(sc, in.ID)
	if err != nil {
		return nil, err
	}
	if err := e.Write(ctx, []docpatch.Op{docpatch.Remove(fmt.Sprintf("/timeline/clips/%d", i))}); err != nil {
		return nil, err
	}
	return tools.Text("Removed clip %s.", in.ID), nil
}

type cueAddIn struct {
	At         float64 `json:"at" jsonschema:"seconds"`
	Label      string  `json:"label"`
	AutoFollow bool    `json:"auto_follow,omitempty" jsonschema:"true lets playback run through this cue instead of holding"`
}

func cueAdd(ctx context.Context, e *tools.Env, in cueAddIn) (*mcp.CallToolResult, error) {
	if _, _, err := e.WriteView(ctx); err != nil {
		return nil, err
	}
	c := scene.Cue{ID: NewID("cue"), At: in.At, Label: in.Label, AutoFollow: in.AutoFollow}
	if err := e.Write(ctx, []docpatch.Op{docpatch.Add("/timeline/cues/-", c)}); err != nil {
		return nil, err
	}
	return tools.Text("Added cue %s at %.2f s.", c.ID, c.At), nil
}

type cueUpdateIn struct {
	ID         string   `json:"id"`
	At         *float64 `json:"at,omitempty"`
	Label      *string  `json:"label,omitempty"`
	AutoFollow *bool    `json:"auto_follow,omitempty"`
}

func cueUpdate(ctx context.Context, e *tools.Env, in cueUpdateIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	for i, c := range sc.Timeline.Cues {
		if c.ID != in.ID {
			continue
		}
		if in.At != nil {
			c.At = *in.At
		}
		if in.Label != nil {
			c.Label = *in.Label
		}
		if in.AutoFollow != nil {
			c.AutoFollow = *in.AutoFollow
		}
		if err := e.Write(ctx, []docpatch.Op{docpatch.Replace(fmt.Sprintf("/timeline/cues/%d", i), c)}); err != nil {
			return nil, err
		}
		return tools.Text("Updated cue %s.", c.ID), nil
	}
	return nil, app_errors.NotFound("Cue %s does not exist.", in.ID)
}

func draftDiff(ctx context.Context, e *tools.Env, _ noIn) (*mcp.CallToolResult, error) {
	id, err := e.DraftID(ctx)
	if err != nil {
		return nil, err
	}
	d, err := e.D.Drafts.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	base, err := scene.Decode(d.BaseDoc)
	if err != nil {
		return nil, err
	}
	view, err := e.D.Drafts.View(ctx, id)
	if err != nil {
		return nil, err
	}
	lines := Diff(base, view)
	if len(lines) == 0 {
		return tools.Text("Draft %s changes nothing yet.", id), nil
	}
	return tools.Text("Draft %s (%d ops) against version %d:\n- %s", id, len(d.Ops), d.BaseVersion, strings.Join(lines, "\n- ")), nil
}

// Diff lists what changes from a to b in words.
func Diff(a, b *scene.Scene) []string {
	var out []string
	surfs := func(s *scene.Scene) map[string]scene.Surface {
		m := map[string]scene.Surface{}
		for _, o := range s.Objects {
			for _, sf := range o.Surfaces {
				m[sf.ID] = sf
			}
		}
		return m
	}
	sa, sb := surfs(a), surfs(b)
	for id, sf := range sb {
		if old, ok := sa[id]; !ok {
			out = append(out, fmt.Sprintf("adds surface %s %q (%s, %d points)", id, sf.Name, sf.Kind, len(sf.PointIDs)))
		} else if !reflect.DeepEqual(old, sf) {
			out = append(out, fmt.Sprintf("changes surface %s %q", id, sf.Name))
		}
	}
	for id, sf := range sa {
		if _, ok := sb[id]; !ok {
			out = append(out, fmt.Sprintf("removes surface %s %q", id, sf.Name))
		}
	}
	pa := map[string]scene.Point{}
	for _, p := range a.Points {
		pa[p.ID] = p
	}
	moved := 0
	maxMove := 0.0
	for _, p := range b.Points {
		if q, ok := pa[p.ID]; ok && (q.X != p.X || q.Y != p.Y) {
			moved++
			maxMove = math.Max(maxMove, math.Hypot(p.X-q.X, p.Y-q.Y))
		}
	}
	if moved > 0 {
		out = append(out, fmt.Sprintf("moves %d points (at most %.1f px)", moved, maxMove))
	}
	oa := map[string]bool{}
	for _, o := range a.Objects {
		oa[o.ID] = true
	}
	for _, o := range b.Objects {
		if !oa[o.ID] {
			out = append(out, fmt.Sprintf("adds object %s %q", o.ID, o.Name))
		}
	}
	diffList := func(kind string, la, lb any, idOf func(any) (string, string)) {
		ma := map[string]string{}
		va := reflect.ValueOf(la)
		for i := 0; i < va.Len(); i++ {
			id, desc := idOf(va.Index(i).Interface())
			b, _ := json.Marshal(va.Index(i).Interface())
			ma[id] = string(b)
			_ = desc
		}
		vb := reflect.ValueOf(lb)
		seen := map[string]bool{}
		for i := 0; i < vb.Len(); i++ {
			id, desc := idOf(vb.Index(i).Interface())
			seen[id] = true
			b, _ := json.Marshal(vb.Index(i).Interface())
			if old, ok := ma[id]; !ok {
				out = append(out, fmt.Sprintf("adds %s %s", kind, desc))
			} else if old != string(b) {
				out = append(out, fmt.Sprintf("changes %s %s", kind, desc))
			}
		}
		for id := range ma {
			if !seen[id] {
				out = append(out, fmt.Sprintf("removes %s %s", kind, id))
			}
		}
	}
	diffList("clip", a.Timeline.Clips, b.Timeline.Clips, func(v any) (string, string) {
		c := v.(scene.Clip)
		return c.ID, fmt.Sprintf("%s (%s, %.1f to %.1f s)", c.ID, c.Effect, c.Start, c.End)
	})
	diffList("cue", a.Timeline.Cues, b.Timeline.Cues, func(v any) (string, string) {
		c := v.(scene.Cue)
		return c.ID, fmt.Sprintf("%s %q at %.1f s", c.ID, c.Label, c.At)
	})
	diffList("track", a.Timeline.Tracks, b.Timeline.Tracks, func(v any) (string, string) {
		t := v.(scene.Track)
		return t.ID, fmt.Sprintf("%s %q", t.ID, t.Name)
	})
	for _, m := range scene.BackdropModes {
		diffList(m+" layer", a.Backdrop.Stack(m).Layers, b.Backdrop.Stack(m).Layers, func(v any) (string, string) {
			l := v.(scene.Layer)
			return l.ID, fmt.Sprintf("%s %q", l.ID, l.Name)
		})
	}
	if a.Mode != b.Mode {
		out = append(out, fmt.Sprintf("puts %s on air (was %s)", b.Mode, a.Mode))
	}
	if a.Timeline.Duration != b.Timeline.Duration {
		out = append(out, fmt.Sprintf("sets the timeline to %.1f s", b.Timeline.Duration))
	}
	return out
}

type proposalIn struct {
	Summary string `json:"summary" jsonschema:"one line for the user: what the draft does"`
}

func proposalSubmit(ctx context.Context, e *tools.Env, in proposalIn) (*mcp.CallToolResult, error) {
	id, err := e.DraftID(ctx)
	if err != nil {
		return nil, err
	}
	d, err := e.D.Drafts.Propose(ctx, id, in.Summary)
	if err != nil {
		return nil, err
	}
	if a, _ := e.AgentSession(ctx, false); a != nil {
		e.D.Agents.Finish(ctx, a.ID, "done")
	}
	return tools.Text("Proposed draft %s (%d ops). The user sees it in the editor's agent panel with apply, preview and discard.", d.ID, len(d.Ops)), nil
}

type applyIn struct {
	Summary string `json:"summary,omitempty" jsonschema:"one line for the history: what the draft does"`
}

func draftApply(ctx context.Context, e *tools.Env, in applyIn) (*mcp.CallToolResult, error) {
	if err := e.NeedApply(ctx); err != nil {
		return nil, err
	}
	id, err := e.DraftID(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Summary) != "" {
		if _, err := e.D.Drafts.Propose(ctx, id, in.Summary); err != nil {
			return nil, err
		}
	}
	a, _ := e.AgentSession(ctx, false)
	d, v, err := e.D.Drafts.Apply(ctx, id, "agent:"+e.S.AgentName())
	if err != nil {
		return nil, err
	}
	if a != nil {
		e.D.Agents.Finish(ctx, a.ID, "done")
	}
	return tools.Text("Applied draft %s (%d ops): the live scene is at version %d. Your next write starts a new draft.", d.ID, len(d.Ops), v), nil
}
