// Package backdrop holds the MCP tools for the backdrop side of projmap (protocol §15): the catalog, scenes and their
// kinds, the stack light, attachments (gobos), backdrop layers, motion and presets. With the editor's "agents edit
// live" switch (settings.agentLiveEdits) their writes go straight to the live scene as a normal patch by
// agent:<name>, so the wall, the phone and the viewer change at once; without it they go into the agent's draft like
// every other write tool.
package backdrop

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	scenessvc "projmap/internal/application/services/scenes"
	"projmap/internal/domain/catalog"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/mcp/tools"
)

// Register adds the backdrop tools.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "catalog_get", Title: "Read the catalog",
		Description: "What you can put on the wall, compact: gobos (attachments: metal plates in windows, nature, sky, patterns and beams; " +
			"each follows a reference photo (source); window presets have family window, their preset geometry in window, and take the " +
			"windowParams: sashes, cols, rows, gap, width, height, frame, mullion, arch, archHeight, spokes, hub, round, taper, taperY, " +
			"slant, slantY, diamond, diamonds, jewels, slats, slatWidth, vertical), " +
			"procedural layers (tree sway, clouds, rain…), gradients, colorGenerators (animated colour), scenery photos, the video and sound " +
			"libraries, motionPresets (sun-lr, drift…) and sceneTemplates. Pass section to get one of them. Read it before you pick ids."}, catalogGet)
	tools.Add(s, env, &mcp.Tool{Name: "scene_list", Title: "List the scenes",
		Description: "Every scene with its id, name, kind (static, live, color, scenery, mapping), mode on air, and which one is on the wall. " +
			"Also says whether your backdrop writes go live (the editor's \"agents edit live\" switch) or into your draft."}, sceneList)
	tools.Add(s, env, &mcp.Tool{Name: "scene_create", Title: "Create a scene",
		Description: "Creates a scene of a kind (static, live, color, scenery or mapping) from a template (sceneTemplates in catalog_get; " +
			"default: the kind's first template, for example static-window: the 6-pane grid window plate at 3200 K with the sun pass ready but off). " +
			"It does not go on the wall: scene_activate does that."}, sceneCreate)
	tools.Add(s, env, &mcp.Tool{Name: "scene_activate", Title: "Put a scene on the wall",
		Description: "Puts a scene (id or name) on the wall; its kind's mode goes on air. Needs the editor's \"agents edit live\" switch or " +
			"\"agent may go live\". After it, backdrop writes with \"agents edit live\" on change this scene."}, sceneActivate)
	tools.Add(s, env, &mcp.Tool{Name: "mode_set", Title: "Switch what is on air",
		Description: "Sets the scene's mode: static (light through attachments), live (animated layers), color (gradients), scenery (photo or " +
			"video) or objects (mapped objects and the timeline). Live on the wall with \"agents edit live\", else in your draft."}, modeSet)
	tools.Add(s, env, &mcp.Tool{Name: "light_set", Title: "Change the light",
		Description: "Changes the stack light of static (default) or live: intensity, focus (the attachments: 1 sharp, 0 soft), backgroundFocus (the background or live layers under them), colour as kelvin+tint (CCT) or " +
			"hue+sat (HSI), fx (none, candle, fire, lightning, paparazzi, tv, breathe, strobe, police) with fxSpeed, a colorLayer " +
			"({kind: gradient|generator, ref, params?}, or {kind: none} to clear), lens fringe and vignette, and the frame slide " +
			"(slideX, slideY in frame fractions -1..1). Only the fields you pass change. Live on the wall with \"agents edit live\", else in your draft."}, lightSet)
	tools.Add(s, env, &mcp.Tool{Name: "attachment_add", Title: "Add an attachment",
		Description: "Adds a gobo (a metal plate from catalog_get gobos) in front of the light of static (default) or live, with the " +
			"catalog's scale, rotation and params (yours override them; params include throw 0..1, skew -1..1, depth 0..1, field " +
			"round|fill|stretch|tile, and for a window preset its geometry: cols, rows, sashes, gap, width, height, frame, mullion, arch, " +
			"archHeight, spokes, hub, round, taper, taperY, slant, slantY, diamond, diamonds, jewels, slats, slatWidth, vertical). " +
			"motion takes a motionPresets id (sun-lr, sun-rl, drift, sway, rise, set). More attachments block more light. Returns its id."}, attachmentAdd)
	tools.Add(s, env, &mcp.Tool{Name: "attachment_update", Title: "Change an attachment",
		Description: "Changes an attachment by id: gobo, name, visible, opacity (how much light it blocks), rotation (degrees), offsetX/offsetY " +
			"(frame fractions from the centre, -2..2), scale (0.05..10) or params (merged into its params)."}, attachmentUpdate)
	tools.Add(s, env, &mcp.Tool{Name: "attachment_remove", Title: "Remove an attachment", Description: "Removes an attachment by id."}, attachmentRemove)
	tools.Add(s, env, &mcp.Tool{Name: "gobo_set", Title: "Pick one gobo",
		Description: "The quick pick: replaces every attachment of static (default) or live with one of this gobo (catalog defaults, your " +
			"params on top). It keeps the light, and the old attachment's id, placement, opacity and motion."}, goboSet)
	tools.Add(s, env, &mcp.Tool{Name: "backdrop_set", Title: "Set the backdrop layers",
		Description: "Replaces the layers of static (its background under the attachments: solid, gradient, generator or procedural), live, color or scenery. Each layer: {kind: procedural|gradient|generator|photo|video|solid, ref, " +
			"name?, visible?, opacity?, blend?: normal|multiply|screen|add, params?}; ids are made, catalog defaults filled in. In live, " +
			"multiply layers (tree sway, clouds) cast shadows into the light; gobos go in attachments (attachment_add)."}, backdropSet)
	tools.Add(s, env, &mcp.Tool{Name: "motion_set", Title: "Move the light or an attachment",
		Description: "Sets the motion of the light (target light), an attachment (its id) or a photo or video layer (its id): a preset from " +
			"motionPresets (sun-lr: the sun passes left to right…) and/or from, via, to (frame fractions -2..2), duration (seconds per pass), " +
			"easing (linear, in, out, inOut, sine), loop (once, loop, pingpong), rotate (degrees), scaleFrom/scaleTo, kelvinFrom/kelvinTo. " +
			"on false pauses it; preset none removes it. It starts now."}, motionSet)
	registerAccent(s, env)
	registerIntro(s, env)
	tools.Add(s, env, &mcp.Tool{Name: "preset_apply", Title: "Apply a preset",
		Description: "Applies a preset (id or name: golden hour, office am, noir blinds, breezy window, storm, ember, flowers, and the user's " +
			"own) to the active scene: it replaces that mode's stack and puts the mode on air."}, presetApply)
}

// Where the writes went, for results.
const (
	whereLive  = "live on the wall"
	whereDraft = "in your draft"
)

// writer is where a backdrop tool writes: the live active scene ("agents edit live") or the agent's draft.
type writer struct {
	e       *tools.Env
	live    bool
	sceneID string
	version int64
	sc      *scene.Scene
	active  bool // the scene is on the wall
}

// open reads the scene a backdrop tool works on. sceneRef (id or name, optional) picks another scene; with "agents
// edit live" off only the draft's scene can be written.
func open(ctx context.Context, e *tools.Env, sceneRef string) (*writer, error) {
	activeID := e.D.Show.Get(ctx).ActiveSceneID
	if e.Settings(ctx).AgentLiveEdits {
		// the editor's agent panel shows live writes too: attach a session (without a draft) for the tool events
		if _, err := e.LiveSession(ctx); err != nil {
			return nil, err
		}
		id := activeID
		if sceneRef != "" {
			sum, err := findScene(ctx, e, sceneRef)
			if err != nil {
				return nil, err
			}
			id = sum.ID
		}
		if id == "" {
			return nil, app_errors.NoScene("No scene is on the wall. scene_list shows the scenes, scene_activate puts one up.")
		}
		doc, v, err := e.D.Scenes.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		sc, err := scene.Decode(doc)
		if err != nil {
			return nil, err
		}
		return &writer{e: e, live: true, sceneID: id, version: v, sc: sc, active: id == activeID}, nil
	}
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	if sceneRef != "" {
		sum, err := findScene(ctx, e, sceneRef)
		if err != nil {
			return nil, err
		}
		if sum.ID != sc.ID {
			return nil, app_errors.BadRequest("Your draft is on scene %s (%s). Without the editor's \"agents edit live\" switch you can only change that scene; leave scene out or ask the user to turn the switch on.", sc.ID, sc.Name)
		}
	}
	return &writer{e: e, sceneID: sc.ID, version: sc.Version, sc: sc, active: sc.ID == activeID}, nil
}

// write commits ops: a patch on the live scene by agent:<name>, or ops appended to the draft.
func (w *writer) write(ctx context.Context, ops []docpatch.Op) error {
	if !w.live {
		return w.e.Write(ctx, ops)
	}
	_, err := w.e.D.Scenes.Patch(ctx, scenessvc.PatchCmd{SceneID: w.sceneID, Base: w.version, Ops: ops, By: "agent:" + w.e.S.AgentName()})
	if e := app_errors.As(err); err != nil && e.Code == "stale" {
		return app_errors.Conflict("Someone changed the scene while you worked. Call the tool again.")
	}
	return err
}

// where says where the write went, with a hint when the wall shows another mode or scene.
func (w *writer) where(mode string) string {
	out := whereDraft
	if w.live {
		out = whereLive
		if !w.active {
			out = "live on scene " + w.sc.Name + " (not on the wall: scene_activate puts it up)"
		}
	}
	if mode != "" && w.sc.Mode != mode {
		out += fmt.Sprintf("; the wall shows %s mode, mode_set %s shows it", w.sc.Mode, mode)
	}
	return out
}

// stack resolves the stack argument: static or live; empty is live when the scene is in live mode, else static.
func (w *writer) stack(arg string) (string, *scene.LayerStack, error) {
	switch arg {
	case "":
		if w.sc.Mode == scene.ModeLive {
			return scene.ModeLive, &w.sc.Backdrop.Live, nil
		}
		return scene.ModeStatic, &w.sc.Backdrop.Static, nil
	case scene.ModeStatic, scene.ModeLive:
		return arg, w.sc.Backdrop.Stack(arg), nil
	}
	return "", nil, app_errors.BadRequest("stack must be static or live, not %q.", arg)
}

// lightOps make sure a live stack has a light (attachments need one to show); nil when it has one.
func lightOps(mode string, st *scene.LayerStack) []docpatch.Op {
	if st.Light != nil {
		return nil
	}
	l := scene.DefaultStackLight()
	st.Light = &l
	return []docpatch.Op{docpatch.Replace("/backdrop/"+mode+"/light", l)}
}

func cat(e *tools.Env) *catalog.Catalog { return e.D.Catalog.Catalog() }

// findScene finds a scene by id or name (case-insensitive).
func findScene(ctx context.Context, e *tools.Env, ref string) (*scene.Summary, error) {
	l, err := e.D.Scenes.List(ctx)
	if err != nil {
		return nil, err
	}
	ref = strings.TrimSpace(ref)
	for i := range l {
		if l[i].ID == ref {
			return &l[i], nil
		}
	}
	for i := range l {
		if strings.EqualFold(l[i].Name, ref) {
			return &l[i], nil
		}
	}
	return nil, app_errors.NotFound("Scene %q does not exist. scene_list shows the scenes.", ref)
}

// nowMs is the server clock in Unix ms.
func nowMs(e *tools.Env) float64 { return float64(e.D.Show.Now() / 1e6) }

// compactSchema is a param schema as {name: {type, min, max, default, options}} without labels.
func compactSchema(s catalog.Schema) map[string]any {
	out := map[string]any{}
	for k, p := range s {
		m := map[string]any{"type": p.Type}
		if p.Min != nil {
			m["min"] = *p.Min
		}
		if p.Max != nil {
			m["max"] = *p.Max
		}
		if p.Default != nil {
			m["default"] = p.Default
		}
		if len(p.Options) > 0 {
			m["options"] = p.Options
		}
		out[k] = m
	}
	return out
}

// Sections of catalog_get.
var sections = []string{"gobos", "procedural", "gradients", "colorGenerators", "scenery", "videos", "sounds", "motionPresets", "sceneTemplates"}

type catalogIn struct {
	Section string `json:"section,omitempty" jsonschema:"one of gobos, procedural, gradients, colorGenerators, scenery, videos, sounds, motionPresets, sceneTemplates; empty for everything"`
}

func catalogGet(ctx context.Context, e *tools.Env, in catalogIn) (*mcp.CallToolResult, error) {
	c := cat(e)
	build := map[string]func() (any, error){
		"gobos": func() (any, error) {
			out := []map[string]any{}
			// (protocol §16) the window params once, not on every window preset
			windowKeys := map[string]bool{}
			for _, g := range c.WindowParamGroups {
				for _, k := range g.Params {
					windowKeys[k] = true
				}
			}
			var windowParams catalog.Schema
			for _, it := range c.Gobos {
				g := c.Gobo(it.ID)
				own := g.Params
				item := map[string]any{"id": g.ID, "name": g.Name, "category": g.Category, "description": g.Description,
					"defaults": g.Defaults, "scale": g.Attachment.Scale, "rotation": g.Attachment.Rotation, "focus": g.Focus}
				if g.Family == "window" {
					own = catalog.Schema{}
					preset := map[string]any{}
					if windowParams == nil {
						windowParams = catalog.Schema{}
					}
					for k, p := range g.Params {
						if !windowKeys[k] {
							own[k] = p
							continue
						}
						preset[k] = p.Default
						if _, ok := windowParams[k]; !ok {
							wp := p
							wp.Default = nil
							windowParams[k] = wp
						}
					}
					item["family"], item["window"] = g.Family, preset
				}
				item["params"] = compactSchema(own)
				if g.Source != "" {
					item["source"] = g.Source
				}
				out = append(out, item)
			}
			res := map[string]any{"items": out, "goboParams": compactSchema(c.GoboParams), "light": compactSchema(c.StackLight.Params),
				"attachment": compactSchema(c.StackLight.AttachmentParams), "kelvin": c.StackLight.Kelvin, "categories": c.GoboCategories}
			if windowParams != nil {
				res["windowParams"], res["windowParamGroups"] = compactSchema(windowParams), c.WindowParamGroups
			}
			return res, nil
		},
		"procedural": func() (any, error) {
			out := []map[string]any{}
			for _, it := range c.Procedural {
				var extra struct {
					Category string `json:"category"`
					Animated bool   `json:"animated"`
				}
				_ = json.Unmarshal(it.Raw, &extra)
				out = append(out, map[string]any{"id": it.ID, "name": it.Name, "category": extra.Category, "animated": extra.Animated, "params": compactSchema(it.Params)})
			}
			return out, nil
		},
		"gradients": func() (any, error) {
			out := []map[string]any{}
			for _, it := range c.Gradients {
				out = append(out, map[string]any{"id": it.ID, "name": it.Name, "defaults": c.Gradient(it.ID)})
			}
			return map[string]any{"items": out, "params": compactSchema(c.GradientPrms)}, nil
		},
		"colorGenerators": func() (any, error) {
			out := []map[string]any{}
			for _, it := range c.ColorGenerators {
				var extra struct {
					Description string `json:"description"`
				}
				_ = json.Unmarshal(it.Raw, &extra)
				out = append(out, map[string]any{"id": it.ID, "name": it.Name, "description": extra.Description, "params": compactSchema(it.Params)})
			}
			return out, nil
		},
		"scenery": func() (any, error) {
			out := []map[string]any{}
			for _, it := range c.Scenery {
				out = append(out, map[string]any{"id": it.ID, "name": it.Name})
			}
			return map[string]any{"items": out, "photoParams": compactSchema(c.PhotoParams), "videoParams": compactSchema(c.VideoParams)}, nil
		},
		"videos": func() (any, error) {
			out := []map[string]any{}
			if e.D.Videos == nil {
				return out, nil
			}
			l, err := e.D.Videos.List(ctx)
			if err != nil {
				return nil, err
			}
			for _, v := range l {
				out = append(out, map[string]any{"id": v.ID, "name": v.Name, "ref": v.Ref, "duration": v.Duration})
			}
			return out, nil
		},
		"sounds": func() (any, error) {
			out := []map[string]any{}
			if e.D.Sounds == nil {
				return out, nil
			}
			l, err := e.D.Sounds.List(ctx)
			if err != nil {
				return nil, err
			}
			for _, a := range l {
				d := 0.0
				if a.Duration != nil {
					d = *a.Duration
				}
				out = append(out, map[string]any{"sha": a.SHA, "name": a.Name, "duration": d})
			}
			return out, nil
		},
		"motionPresets": func() (any, error) {
			out := []map[string]any{}
			for _, mp := range c.MotionPresets {
				out = append(out, map[string]any{"id": mp.ID, "name": mp.Name, "description": mp.Description})
			}
			return map[string]any{"items": out, "easings": c.MotionEasings, "loops": c.MotionLoops}, nil
		},
		"sceneTemplates": func() (any, error) {
			return map[string]any{"kinds": c.SceneKinds, "templates": c.SceneTemplates}, nil
		},
	}
	if in.Section != "" {
		f, ok := build[in.Section]
		if !ok {
			return nil, app_errors.BadRequest("section must be one of %s.", strings.Join(sections, ", "))
		}
		v, err := f()
		if err != nil {
			return nil, err
		}
		return tools.JSON(fmt.Sprintf("Catalog %s (version %d).", in.Section, c.Version), v), nil
	}
	all := map[string]any{}
	for _, k := range sections {
		v, err := build[k]()
		if err != nil {
			return nil, err
		}
		all[k] = v
	}
	return tools.JSON(fmt.Sprintf("Catalog version %d: %d gobos, %d procedural layers, %d gradients, %d colour generators, %d scenery photos. "+
		"Gobos go on as attachments (attachment_add, gobo_set); procedural, gradient, generator, photo and video layers go in backdrop_set; "+
		"motion presets in motion_set.", c.Version, len(c.Gobos), len(c.Procedural), len(c.Gradients), len(c.ColorGenerators), len(c.Scenery)), all), nil
}

type noIn struct{}

func sceneList(ctx context.Context, e *tools.Env, _ noIn) (*mcp.CallToolResult, error) {
	l, err := e.D.Scenes.List(ctx)
	if err != nil {
		return nil, err
	}
	active := e.D.Show.Get(ctx).ActiveSceneID
	type line struct {
		scene.Summary
		OnWall bool `json:"onWall"`
	}
	out := []line{}
	for _, s := range l {
		out = append(out, line{Summary: s, OnWall: s.ID == active})
	}
	head := fmt.Sprintf("%d scenes; %s is on the wall.", len(out), active)
	if e.Settings(ctx).AgentLiveEdits {
		head += " The editor's \"agents edit live\" switch is on: backdrop tools change the scene on the wall at once."
	} else {
		head += " The editor's \"agents edit live\" switch is off: backdrop tools write into your draft (proposal_submit hands it over)."
	}
	return tools.JSON(head, out), nil
}

type createIn struct {
	Name     string `json:"name" jsonschema:"the scene's name"`
	Kind     string `json:"kind" jsonschema:"static, live, color, scenery or mapping"`
	Template string `json:"template,omitempty" jsonschema:"a sceneTemplates id (catalog_get sceneTemplates); default: the kind's first template"`
}

func sceneCreate(ctx context.Context, e *tools.Env, in createIn) (*mcp.CallToolResult, error) {
	if in.Kind == "" && in.Template == "" {
		return nil, app_errors.BadRequest("Pass kind (static, live, color, scenery or mapping) or a template.")
	}
	sc, err := e.D.Scenes.Create(ctx, scenessvc.CreateIn{Name: in.Name, SetupID: e.D.Show.Get(ctx).ActiveSetupID, Kind: in.Kind, Template: in.Template})
	if err != nil {
		return nil, err
	}
	return tools.Text("Created scene %s (%s), kind %s, mode %s. It is not on the wall yet: scene_activate %s puts it up.", sc.ID, sc.Name, sc.Kind, sc.Mode, sc.ID), nil
}

type activateIn struct {
	Scene string `json:"scene" jsonschema:"scene id or name"`
}

func sceneActivate(ctx context.Context, e *tools.Env, in activateIn) (*mcp.CallToolResult, error) {
	st := e.Settings(ctx)
	if !st.AgentLiveEdits && !st.AgentMayGoLive {
		return nil, app_errors.Forbidden("Putting a scene on the wall needs the editor's \"agents edit live\" switch (agentLiveEdits) or \"agent may go live\". Ask the user to turn one on.")
	}
	sum, err := findScene(ctx, e, in.Scene)
	if err != nil {
		return nil, err
	}
	args, _ := json.Marshal(map[string]string{"sceneId": sum.ID})
	if _, err := e.D.Show.Do(ctx, "activate", args, "agent:"+e.S.AgentName()); err != nil {
		return nil, err
	}
	sc, err := e.D.Scenes.Scene(ctx, sum.ID)
	if err != nil {
		return nil, err
	}
	msg := fmt.Sprintf("Scene %s (%s) is on the wall in %s mode.", sc.ID, sc.Name, sc.Mode)
	if a, _ := e.AgentSession(ctx, false); a != nil && a.SceneID != "" && a.SceneID != sc.ID && !st.AgentLiveEdits {
		msg += " Your draft is still on scene " + a.SceneID + "."
	}
	return tools.Text("%s", msg), nil
}

type modeIn struct {
	Mode  string `json:"mode" jsonschema:"static, live, color, scenery or objects"`
	Scene string `json:"scene,omitempty" jsonschema:"scene id or name; default the scene on the wall"`
}

func modeSet(ctx context.Context, e *tools.Env, in modeIn) (*mcp.CallToolResult, error) {
	if !scene.Modes[in.Mode] {
		return nil, app_errors.BadRequest("mode must be static, live, color, scenery or objects.")
	}
	w, err := open(ctx, e, in.Scene)
	if err != nil {
		return nil, err
	}
	if err := w.write(ctx, []docpatch.Op{docpatch.Replace("/mode", in.Mode)}); err != nil {
		return nil, err
	}
	w.sc.Mode = in.Mode
	return tools.Text("Scene %s shows %s mode, %s.", w.sc.Name, in.Mode, w.where("")), nil
}
