package backdrop

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/domain/catalog"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/mcp/tools"
)

// ColorLayerIn is a light's colour layer.
type ColorLayerIn struct {
	Kind   string         `json:"kind" jsonschema:"gradient, generator, or none to clear it"`
	Ref    string         `json:"ref,omitempty" jsonschema:"a gradients id or a colorGenerators id"`
	Params map[string]any `json:"params,omitempty" jsonschema:"the item's params; missing ones take the catalog defaults"`
}

type lightIn struct {
	Stack     string   `json:"stack,omitempty" jsonschema:"static or live; default live when the scene is in live mode, else static"`
	Intensity *float64 `json:"intensity,omitempty" jsonschema:"0..1"`
	Focus     *float64 `json:"focus,omitempty" jsonschema:"attachment focus 0..1: 1 is sharp (the default), 0 fully soft"`
	// BackgroundFocus blurs the background (static) or the live layers (live), protocol §16.
	BackgroundFocus *float64      `json:"backgroundFocus,omitempty" jsonschema:"background focus 0..1: the colour, background layers (static) or live layers (live) under the attachments; 1 is sharp"`
	Kelvin          *float64      `json:"kelvin,omitempty" jsonschema:"colour temperature 1000..12000 (CCT): 2700 warm tungsten, 3200 golden, 5600 daylight, 6500 cool"`
	Tint            *float64      `json:"tint,omitempty" jsonschema:"-1..1, negative green, positive magenta"`
	Hue             *float64      `json:"hue,omitempty" jsonschema:"0..360 (HSI)"`
	Sat             *float64      `json:"sat,omitempty" jsonschema:"0..1 (HSI)"`
	ColorMode       string        `json:"colorMode,omitempty" jsonschema:"cct or hsi; kelvin or tint imply cct, hue or sat imply hsi"`
	FX              string        `json:"fx,omitempty" jsonschema:"none, candle, fire, lightning, paparazzi, tv, breathe, strobe or police"`
	FXSpeed         *float64      `json:"fxSpeed,omitempty" jsonschema:"0..1"`
	ColorLayer      *ColorLayerIn `json:"colorLayer,omitempty" jsonschema:"colours the light: {kind: gradient|generator, ref, params?}; {kind: none} clears it"`
	Fringe          *float64      `json:"fringe,omitempty" jsonschema:"0..1 chromatic edge of the lens"`
	Vignette        *float64      `json:"vignette,omitempty" jsonschema:"0..1 falloff towards the corners"`
	SlideX          *float64      `json:"slideX,omitempty" jsonschema:"frame slide -1..1 of the width: 0.25 moves the whole picture a quarter to the right"`
	SlideY          *float64      `json:"slideY,omitempty" jsonschema:"frame slide -1..1 of the height, down"`
}

func setF(dst *float64, v *float64) {
	if v != nil {
		*dst = *v
	}
}

// colorLayer resolves a colour layer input: catalog defaults under the given params.
func colorLayer(c *catalog.Catalog, in *ColorLayerIn) (*scene.ColorLayer, error) {
	switch in.Kind {
	case "none", "":
		return nil, nil
	case scene.ColorLayerGradient, scene.ColorLayerGenerator:
	default:
		return nil, app_errors.BadRequest("colorLayer.kind must be gradient, generator or none.")
	}
	schema, ok := c.LayerSchema(in.Kind, in.Ref)
	if !ok {
		return nil, app_errors.NotFound("%s %q is not in the catalog. catalog_get %s lists them.", in.Kind, in.Ref,
			map[string]string{scene.ColorLayerGradient: "gradients", scene.ColorLayerGenerator: "colorGenerators"}[in.Kind])
	}
	params := catalog.Defaults(schema)
	if in.Kind == scene.ColorLayerGradient {
		for k, v := range c.Gradient(in.Ref) {
			params[k] = v
		}
	}
	for k, v := range in.Params {
		params[k] = v
	}
	return &scene.ColorLayer{Kind: in.Kind, Ref: in.Ref, Params: params}, nil
}

func lightSet(ctx context.Context, e *tools.Env, in lightIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	mode, st, err := w.stack(in.Stack)
	if err != nil {
		return nil, err
	}
	l := scene.DefaultStackLight()
	if st.Light != nil {
		l = *st.Light
	}
	setF(&l.Intensity, in.Intensity)
	setF(&l.Focus, in.Focus)
	setF(&l.BackgroundFocus, in.BackgroundFocus)
	if in.Kelvin != nil || in.Tint != nil {
		l.Color.Mode = "cct"
	}
	if in.Hue != nil || in.Sat != nil {
		l.Color.Mode = "hsi"
	}
	if in.ColorMode != "" {
		l.Color.Mode = in.ColorMode
	}
	setF(&l.Color.Kelvin, in.Kelvin)
	setF(&l.Color.Tint, in.Tint)
	setF(&l.Color.Hue, in.Hue)
	setF(&l.Color.Sat, in.Sat)
	if in.FX != "" {
		l.FX.Kind = in.FX
	}
	setF(&l.FX.Speed, in.FXSpeed)
	if in.ColorLayer != nil {
		if l.ColorLayer, err = colorLayer(cat(e), in.ColorLayer); err != nil {
			return nil, err
		}
	}
	setF(&l.Fringe, in.Fringe)
	setF(&l.Vignette, in.Vignette)
	setF(&l.Slide.X, in.SlideX)
	setF(&l.Slide.Y, in.SlideY)
	if err := w.write(ctx, []docpatch.Op{docpatch.Replace("/backdrop/"+mode+"/light", l)}); err != nil {
		return nil, err
	}
	col := fmt.Sprintf("%.0f K", l.Color.Kelvin)
	if l.Color.Mode == "hsi" {
		col = fmt.Sprintf("hue %.0f sat %.2f", l.Color.Hue, l.Color.Sat)
	}
	if l.ColorLayer != nil {
		col = l.ColorLayer.Kind + " " + l.ColorLayer.Ref
	}
	return tools.Text("The %s light is intensity %.2f, attachment focus %.2f, background focus %.2f, %s, fx %s, slide (%.2f, %.2f), %s.", mode, l.Intensity, l.Focus, l.BackgroundFocus, col,
		l.FX.Kind, l.Slide.X, l.Slide.Y, w.where(mode)), nil
}

type attachmentIn struct {
	Stack    string         `json:"stack,omitempty" jsonschema:"static or live; default live when the scene is in live mode, else static"`
	Gobo     string         `json:"gobo" jsonschema:"a gobos id from catalog_get (plate-grid-window, plate-blinds, plate-moon-and-stars, plate-dots…)"`
	Params   map[string]any `json:"params,omitempty" jsonschema:"the gobo's params (catalog_get gobos) plus throw 0..1, skew -1..1, depth 0..1; missing ones take the catalog defaults"`
	Rotation *float64       `json:"rotation,omitempty" jsonschema:"degrees -360..360; default the gobo's"`
	OffsetX  *float64       `json:"offsetX,omitempty" jsonschema:"-2..2 frame widths from the centre"`
	OffsetY  *float64       `json:"offsetY,omitempty" jsonschema:"-2..2 frame heights from the centre"`
	Scale    *float64       `json:"scale,omitempty" jsonschema:"0.05..10; default the gobo's"`
	Opacity  *float64       `json:"opacity,omitempty" jsonschema:"0..1 how much light it blocks: 1 metal, lower a glass gobo"`
	Motion   string         `json:"motion,omitempty" jsonschema:"a motionPresets id (sun-lr, sun-rl, drift, sway, rise, set) that starts now"`
}

// newAttachment builds an attachment from the input: catalog defaults, then the given fields.
func newAttachment(e *tools.Env, in attachmentIn) (scene.Attachment, error) {
	a, err := scene.NewAttachment(cat(e), in.Gobo, in.Params)
	if err != nil {
		return a, app_errors.NotFound("Gobo %q is not in the catalog. catalog_get gobos lists them.", in.Gobo)
	}
	setF(&a.Rotation, in.Rotation)
	setF(&a.OffsetX, in.OffsetX)
	setF(&a.OffsetY, in.OffsetY)
	setF(&a.Scale, in.Scale)
	setF(&a.Opacity, in.Opacity)
	if in.Motion != "" {
		m, err := presetMotion(e, in.Motion)
		if err != nil {
			return a, err
		}
		a.Motion = m
	}
	return a, nil
}

func presetMotion(e *tools.Env, id string) (*scene.Motion, error) {
	m := scene.PresetMotion(cat(e), id)
	if m == nil {
		var ids []string
		for _, mp := range cat(e).MotionPresets {
			ids = append(ids, mp.ID)
		}
		return nil, app_errors.NotFound("Motion preset %q does not exist; use one of %s.", id, strings.Join(ids, ", "))
	}
	m.On, m.Phase, m.StartedAt = true, 0, nowMs(e)
	return m, nil
}

func attachmentAdd(ctx context.Context, e *tools.Env, in attachmentIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	mode, st, err := w.stack(in.Stack)
	if err != nil {
		return nil, err
	}
	a, err := newAttachment(e, in)
	if err != nil {
		return nil, err
	}
	ops := append(lightOps(mode, st), docpatch.Add("/backdrop/"+mode+"/attachments/-", a))
	if err := w.write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Added attachment %s (%s, scale %.2f, rotation %.0f°) to the %s light, %s.", a.ID, a.Name, a.Scale, a.Rotation, mode, w.where(mode)), nil
}

// findAttachment finds an attachment by id in the given stack, or in static then live.
func findAttachment(w *writer, stack, id string) (string, int, *scene.Attachment, error) {
	modes := []string{scene.ModeStatic, scene.ModeLive}
	if stack != "" {
		if stack != scene.ModeStatic && stack != scene.ModeLive {
			return "", 0, nil, app_errors.BadRequest("stack must be static or live.")
		}
		modes = []string{stack}
	}
	for _, m := range modes {
		st := w.sc.Backdrop.Stack(m)
		for i := range st.Attachments {
			if st.Attachments[i].ID == id {
				return m, i, &st.Attachments[i], nil
			}
		}
	}
	return "", 0, nil, app_errors.NotFound("Attachment %s does not exist. scene_get lists the attachments of static and live.", id)
}

type attachmentUpdateIn struct {
	Stack    string         `json:"stack,omitempty" jsonschema:"static or live (default: wherever the id is)"`
	ID       string         `json:"id" jsonschema:"the attachment's id"`
	Gobo     string         `json:"gobo,omitempty" jsonschema:"another gobos id (its params reset to the catalog defaults under yours)"`
	Name     *string        `json:"name,omitempty"`
	Visible  *bool          `json:"visible,omitempty"`
	Opacity  *float64       `json:"opacity,omitempty" jsonschema:"0..1 how much light it blocks"`
	Rotation *float64       `json:"rotation,omitempty" jsonschema:"degrees -360..360"`
	OffsetX  *float64       `json:"offsetX,omitempty" jsonschema:"-2..2"`
	OffsetY  *float64       `json:"offsetY,omitempty" jsonschema:"-2..2"`
	Scale    *float64       `json:"scale,omitempty" jsonschema:"0.05..10"`
	Params   map[string]any `json:"params,omitempty" jsonschema:"merged into its params"`
}

func attachmentUpdate(ctx context.Context, e *tools.Env, in attachmentUpdateIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	mode, i, cur, err := findAttachment(w, in.Stack, in.ID)
	if err != nil {
		return nil, err
	}
	a := *cur
	params := map[string]any{}
	for k, v := range cur.Params {
		params[k] = v
	}
	if in.Gobo != "" && in.Gobo != a.Gobo {
		g := cat(e).Gobo(in.Gobo)
		if g == nil {
			return nil, app_errors.NotFound("Gobo %q is not in the catalog. catalog_get gobos lists them.", in.Gobo)
		}
		a.Gobo, a.Name, params = g.ID, g.Name, cat(e).GoboDefaults(g.ID)
	}
	for k, v := range in.Params {
		params[k] = v
	}
	a.Params = params
	if in.Name != nil {
		a.Name = *in.Name
	}
	if in.Visible != nil {
		a.Visible = *in.Visible
	}
	setF(&a.Opacity, in.Opacity)
	setF(&a.Rotation, in.Rotation)
	setF(&a.OffsetX, in.OffsetX)
	setF(&a.OffsetY, in.OffsetY)
	setF(&a.Scale, in.Scale)
	if err := w.write(ctx, []docpatch.Op{docpatch.Replace(fmt.Sprintf("/backdrop/%s/attachments/%d", mode, i), a)}); err != nil {
		return nil, err
	}
	return tools.Text("Updated attachment %s (%s), %s.", a.ID, a.Name, w.where(mode)), nil
}

type attachmentRemoveIn struct {
	Stack string `json:"stack,omitempty" jsonschema:"static or live (default: wherever the id is)"`
	ID    string `json:"id" jsonschema:"the attachment's id"`
}

func attachmentRemove(ctx context.Context, e *tools.Env, in attachmentRemoveIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	mode, i, a, err := findAttachment(w, in.Stack, in.ID)
	if err != nil {
		return nil, err
	}
	if err := w.write(ctx, []docpatch.Op{docpatch.Remove(fmt.Sprintf("/backdrop/%s/attachments/%d", mode, i))}); err != nil {
		return nil, err
	}
	return tools.Text("Removed attachment %s (%s), %s.", a.ID, a.Name, w.where(mode)), nil
}

type goboIn struct {
	Stack  string         `json:"stack,omitempty" jsonschema:"static or live; default live when the scene is in live mode, else static"`
	Gobo   string         `json:"gobo" jsonschema:"a gobos id from catalog_get"`
	Params map[string]any `json:"params,omitempty" jsonschema:"the gobo's params; missing ones take the catalog defaults"`
}

func goboSet(ctx context.Context, e *tools.Env, in goboIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	mode, st, err := w.stack(in.Stack)
	if err != nil {
		return nil, err
	}
	a, err := newAttachment(e, attachmentIn{Gobo: in.Gobo, Params: in.Params})
	if err != nil {
		return nil, err
	}
	if len(st.Attachments) > 0 {
		// a pick keeps the place (protocol §16): the old attachment's id (timeline tracks follow it), its placement,
		// opacity and motion; only the plate and its own params change
		o := st.Attachments[0]
		a.ID, a.Motion, a.Rotation, a.OffsetX, a.OffsetY, a.Scale, a.Opacity, a.Visible = o.ID, o.Motion, o.Rotation, o.OffsetX, o.OffsetY, o.Scale, o.Opacity, o.Visible
	}
	ops := append(lightOps(mode, st), docpatch.Replace("/backdrop/"+mode+"/attachments", []scene.Attachment{a}))
	if err := w.write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("The %s light shines through one %s (%s), %s.", mode, a.Name, a.ID, w.where(mode)), nil
}

// LayerIn is a backdrop layer for backdrop_set.
type LayerIn struct {
	ID      string         `json:"id,omitempty" jsonschema:"keep an existing layer's id; made when missing"`
	Kind    string         `json:"kind" jsonschema:"procedural, gradient, generator, photo, video or solid"`
	Ref     string         `json:"ref" jsonschema:"a catalog id of that kind; photo: a scenery id or asset:<sha>; video: asset:<sha> or youtube:<id> (catalog_get videos)"`
	Name    string         `json:"name,omitempty"`
	Visible *bool          `json:"visible,omitempty"`
	Opacity *float64       `json:"opacity,omitempty" jsonschema:"0..1"`
	Blend   string         `json:"blend,omitempty" jsonschema:"normal (default), multiply (casts shadows into the live light), screen or add"`
	Params  map[string]any `json:"params,omitempty" jsonschema:"the item's params; missing ones take the catalog defaults"`
}

type backdropIn struct {
	Mode   string    `json:"mode" jsonschema:"static (background layers under the attachments: solid, gradient, generator or procedural), live, color or scenery"`
	Layers []LayerIn `json:"layers" jsonschema:"bottom to top"`
}

func backdropSet(ctx context.Context, e *tools.Env, in backdropIn) (*mcp.CallToolResult, error) {
	switch in.Mode {
	case scene.ModeStatic, scene.ModeLive, scene.ModeColor, scene.ModeScenery:
	default:
		return nil, app_errors.BadRequest("mode must be static, live, color or scenery.")
	}
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	layers := []scene.Layer{}
	var names []string
	for i, li := range in.Layers {
		if li.Kind == "gobo" {
			return nil, app_errors.BadRequest("Layer %d is a gobo: gobos are attachments in front of the light. Use attachment_add {stack: %s, gobo: %q}.", i, in.Mode, li.Ref)
		}
		if in.Mode == scene.ModeStatic && !scene.StaticLayerKinds[li.Kind] {
			return nil, app_errors.BadRequest("Layer %d: the static stack takes background layers under the attachments: solid, gradient, generator or procedural, not %s.", i, li.Kind)
		}
		l, err := scene.NewLayer(cat(e), li.Kind, li.Ref)
		if err != nil {
			return nil, app_errors.BadRequest("Layer %d: %v. catalog_get lists the ids.", i, err)
		}
		if li.ID != "" {
			l.ID = li.ID
		}
		if li.Name != "" {
			l.Name = li.Name
		}
		if li.Visible != nil {
			l.Visible = *li.Visible
		}
		setF(&l.Opacity, li.Opacity)
		if li.Blend != "" {
			l.Blend = li.Blend
		}
		for k, v := range li.Params {
			l.Params[k] = v
		}
		layers = append(layers, l)
		names = append(names, l.Name+" ("+l.ID+")")
	}
	if err := w.write(ctx, []docpatch.Op{docpatch.Replace("/backdrop/"+in.Mode+"/layers", layers)}); err != nil {
		return nil, err
	}
	list := "empty"
	if len(names) > 0 {
		list = strings.Join(names, ", ")
	}
	return tools.Text("The %s stack is %s, %s.", in.Mode, list, w.where(in.Mode)), nil
}

type motionIn struct {
	Target     string    `json:"target" jsonschema:"light, an attachment id, or a photo or video layer id"`
	Stack      string    `json:"stack,omitempty" jsonschema:"for target light: static or live (default live when the scene is in live mode, else static)"`
	Preset     string    `json:"preset,omitempty" jsonschema:"a motionPresets id (sun-lr, sun-rl, drift, sway, rise, set) to start from, or none to remove the motion"`
	On         *bool     `json:"on,omitempty" jsonschema:"false pauses it where it is; default true"`
	From       *scene.Pt `json:"from,omitempty" jsonschema:"start offset {x, y} in frame fractions -2..2"`
	Via        *scene.Pt `json:"via,omitempty" jsonschema:"a point the path curves through"`
	To         *scene.Pt `json:"to,omitempty" jsonschema:"end offset {x, y}"`
	Duration   *float64  `json:"duration,omitempty" jsonschema:"seconds per pass, 1..86400"`
	Easing     string    `json:"easing,omitempty" jsonschema:"linear, in, out, inOut or sine"`
	Loop       string    `json:"loop,omitempty" jsonschema:"once, loop or pingpong"`
	Rotate     *float64  `json:"rotate,omitempty" jsonschema:"degrees turned over the pass"`
	ScaleFrom  *float64  `json:"scaleFrom,omitempty" jsonschema:"0.1..10"`
	ScaleTo    *float64  `json:"scaleTo,omitempty" jsonschema:"0.1..10"`
	KelvinFrom *float64  `json:"kelvinFrom,omitempty" jsonschema:"0 or 1000..12000: a CCT drift (both set)"`
	KelvinTo   *float64  `json:"kelvinTo,omitempty" jsonschema:"0 or 1000..12000"`
}

func motionSet(ctx context.Context, e *tools.Env, in motionIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	var path, mode, what string
	var cur *scene.Motion
	var ops []docpatch.Op
	layerMotion := false
	switch {
	case in.Target == "light":
		m, st, err := w.stack(in.Stack)
		if err != nil {
			return nil, err
		}
		ops = lightOps(m, st)
		mode, path, cur, what = m, "/backdrop/"+m+"/light/motion", st.Light.Motion, "the "+m+" light"
	default:
		if m, i, a, err := findAttachment(w, "", in.Target); err == nil {
			mode, path, cur, what = m, fmt.Sprintf("/backdrop/%s/attachments/%d/motion", m, i), a.Motion, "attachment "+a.ID
			break
		}
		found := false
		for _, m := range scene.BackdropModes {
			for i, l := range w.sc.Backdrop.Stack(m).Layers {
				if l.ID != in.Target {
					continue
				}
				if l.Kind != "photo" && l.Kind != scene.LayerVideo {
					return nil, app_errors.BadRequest("Layer %s is a %s layer: only photo and video layers move. Move the light or an attachment instead.", l.ID, l.Kind)
				}
				mode, path, cur, what, found, layerMotion = m, fmt.Sprintf("/backdrop/%s/layers/%d/motion", m, i), l.Motion, "layer "+l.ID, true, true
			}
		}
		if !found {
			return nil, app_errors.NotFound("Target %s is not light, an attachment or a backdrop layer. scene_get lists them.", in.Target)
		}
	}
	if in.Preset == "none" {
		if layerMotion {
			if cur != nil {
				ops = append(ops, docpatch.Remove(path))
			}
		} else {
			ops = append(ops, docpatch.Replace(path, nil))
		}
		if len(ops) > 0 {
			if err := w.write(ctx, ops); err != nil {
				return nil, err
			}
		}
		return tools.Text("%s stands still, %s.", strings.ToUpper(what[:1])+what[1:], w.where(mode)), nil
	}
	m := scene.DefaultMotion()
	if cur != nil {
		m = *cur
	}
	if in.Preset != "" {
		pm, err := presetMotion(e, in.Preset)
		if err != nil {
			return nil, err
		}
		m = *pm
	}
	if in.From != nil {
		m.From = *in.From
	}
	if in.Via != nil {
		v := *in.Via
		m.Via = &v
	}
	if in.To != nil {
		m.To = *in.To
	}
	setF(&m.Duration, in.Duration)
	if in.Easing != "" {
		m.Easing = in.Easing
	}
	if in.Loop != "" {
		m.Loop = in.Loop
	}
	setF(&m.Rotate, in.Rotate)
	setF(&m.ScaleFrom, in.ScaleFrom)
	setF(&m.ScaleTo, in.ScaleTo)
	setF(&m.KelvinFrom, in.KelvinFrom)
	setF(&m.KelvinTo, in.KelvinTo)
	if in.Preset == "" && (in.From != nil || in.To != nil || in.Via != nil || in.Rotate != nil || in.ScaleFrom != nil || in.ScaleTo != nil) {
		m.Preset = ""
	}
	m.On = in.On == nil || *in.On
	m.StartedAt = nowMs(e)
	// keep the place (protocol §15): a pause, a speed change or any other edit continues from the current progress;
	// a preset starts from its beginning
	m.Phase = 0
	if cur != nil && in.Preset == "" {
		m.Phase = progress(cur, m.StartedAt)
	}
	if layerMotion {
		ops = append(ops, docpatch.Add(path, m))
	} else {
		ops = append(ops, docpatch.Replace(path, m))
	}
	if err := w.write(ctx, ops); err != nil {
		return nil, err
	}
	state := "moves"
	if !m.On {
		state = "pauses"
	}
	label := m.Preset
	if label == "" {
		label = "a custom path"
	}
	return tools.Text("%s %s (%s, %.0f s per pass, %s, %s), %s.", strings.ToUpper(what[:1])+what[1:], state, label, m.Duration, m.Easing, m.Loop, w.where(mode)), nil
}

// progress is a motion's u at server time nowMs (protocol §15), before looping.
func progress(m *scene.Motion, nowMs float64) float64 {
	u := m.Phase
	if m.On && m.Duration > 0 {
		u += (nowMs - m.StartedAt) / (1000 * m.Duration)
	}
	switch m.Loop {
	case "once":
		u = min(max(u, 0), 1)
	case "pingpong":
		for u >= 2 {
			u -= 2
		}
	default:
		for u >= 1 {
			u--
		}
	}
	return min(max(u, 0), 2)
}

type presetIn struct {
	Preset string `json:"preset" jsonschema:"preset id or name"`
}

func presetApply(ctx context.Context, e *tools.Env, in presetIn) (*mcp.CallToolResult, error) {
	list, err := e.D.Presets.List(ctx)
	if err != nil {
		return nil, err
	}
	var pr *scene.Preset
	for i := range list {
		if list[i].ID == in.Preset {
			pr = &list[i]
		}
	}
	for i := range list {
		if pr == nil && strings.EqualFold(list[i].Name, strings.TrimSpace(in.Preset)) {
			pr = &list[i]
		}
	}
	if pr == nil {
		var names []string
		for _, p := range list {
			names = append(names, p.Name)
		}
		return nil, app_errors.NotFound("Preset %q does not exist; the presets are %s.", in.Preset, strings.Join(names, ", "))
	}
	w, err := open(ctx, e, "")
	if err != nil {
		return nil, err
	}
	if w.live {
		if _, err := e.D.Presets.Apply(ctx, pr.ID, w.sceneID, "agent:"+e.S.AgentName()); err != nil {
			return nil, err
		}
	} else {
		pr.Upgrade()
		if err := w.write(ctx, scene.PresetOps(pr, w.sc)); err != nil {
			return nil, err
		}
	}
	w.sc.Mode = pr.Mode
	return tools.Text("Applied preset %s (%s): %s mode is on air, %s.", pr.Name, pr.ID, pr.Mode, w.where("")), nil
}
