package backdrop

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/mcp/tools"
)

const introDescription = "Sets the scene's opening step, step 0 of a sequence (protocol §20 \"Step 0\"): the opening look (a backdrop mode, " +
	"static, live, color or scenery, optionally one of its presets) holds on the wall until GO; GO then converges the light onto the " +
	"object (converge true: convergeDuration seconds, from current, circle or frame, ease) or crossfades (transition fade, transitionMs) " +
	"or cuts into the mapping. Only the fields you pass change. sequence_start puts step 0 on the wall. Live with \"agents edit live\", else in your draft."

type introIn struct {
	Scene            string   `json:"scene,omitempty" jsonschema:"scene id or name; default the scene on the wall"`
	On               *bool    `json:"on,omitempty" jsonschema:"the scene opens with step 0"`
	Mode             string   `json:"mode,omitempty" jsonschema:"the opening look: static, live, color or scenery"`
	Preset           *string  `json:"preset,omitempty" jsonschema:"a preset id of that mode applied when the sequence starts; empty for none"`
	Converge         *bool    `json:"converge,omitempty" jsonschema:"GO converges onto the object (else it crossfades or cuts)"`
	ConvergeDuration *float64 `json:"convergeDuration,omitempty" jsonschema:"seconds, 0.1..60"`
	From             string   `json:"from,omitempty" jsonschema:"current, circle or frame"`
	Ease             string   `json:"ease,omitempty" jsonschema:"inOut, in, out or linear"`
	Transition       string   `json:"transition,omitempty" jsonschema:"fade or cut (without converge)"`
	TransitionMs     *float64 `json:"transitionMs,omitempty" jsonschema:"crossfade length in ms, 0..10000"`
}

func registerIntro(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "intro_set", Title: "Set the opening step", Description: introDescription}, introSet)
}

func introSet(ctx context.Context, e *tools.Env, in introIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, in.Scene)
	if err != nil {
		return nil, err
	}
	a := scene.DefaultIntro(w.sc.Mode)
	if w.sc.Intro != nil {
		a = *w.sc.Intro
	}
	if in.On != nil {
		a.On = *in.On
	}
	if in.Mode != "" {
		a.Source.Mode = in.Mode
	}
	if in.Preset != nil {
		if *in.Preset == "" {
			a.Source.PresetID = nil
		} else {
			p := *in.Preset
			a.Source.PresetID = &p
		}
	}
	if in.Converge != nil {
		a.Converge = *in.Converge
	}
	if in.ConvergeDuration != nil {
		a.ConvergeDuration = *in.ConvergeDuration
	}
	if in.From != "" {
		a.From = in.From
	}
	if in.Ease != "" {
		a.Ease = in.Ease
	}
	if in.Transition != "" {
		a.Transition = in.Transition
	}
	if in.TransitionMs != nil {
		a.TransitionMs = *in.TransitionMs
	}
	if err := w.write(ctx, []docpatch.Op{docpatch.Add("/intro", a)}); err != nil {
		return nil, err
	}
	how := fmt.Sprintf("a %s %.0f ms", a.Transition, a.TransitionMs)
	if a.Converge {
		how = fmt.Sprintf("a %.1f s converge from %s", a.ConvergeDuration, a.From)
	}
	return tools.Text("Step 0 of scene %s is %v: it opens with the %s look, and GO goes into the mapping with %s, %s.", w.sc.Name, a.On, a.Source.Mode, how, w.where("")), nil
}
