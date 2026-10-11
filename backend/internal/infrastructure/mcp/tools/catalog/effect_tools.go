// Package catalog holds the MCP tools over the effect library.
package catalog

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	catalogsvc "projmap/internal/application/services/catalog"
	"projmap/internal/infrastructure/mcp/tools"
)

// Register adds the effect tools.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "effects_list", Title: "List effects",
		Description: "Every effect (built-in, user and agent made) with its parameter schema. Use the ids in clip_add and surface effects."}, effectsList)
	tools.Add(s, env, &mcp.Tool{Name: "effect_source_get", Title: "Read an effect's source",
		Description: "The source of a user or agent effect (GLSL or JS), to learn from or fork. Built-ins live in the renderer and have no stored source; read docs://effect-api for the contract."}, effectSource)
	tools.Add(s, env, &mcp.Tool{Name: "effect_create", Title: "Write a new effect",
		Description: "Stores a new effect. GLSL (preferred) defines vec4 effect(vec2 uv, float t, float progress); JS exports default render(ctx, {t, progress, width, height, aspect, seed, params}). params is a param schema {name: {type, min, max, default}}. Returns the id and the static check's problems; the real compile happens in the renderer, so check it with output_render after placing a clip."}, effectCreate)
	tools.Add(s, env, &mcp.Tool{Name: "effect_update", Title: "Change an effect",
		Description: "Replaces a user or agent effect's source (and params when given)."}, effectUpdate)
}

type noIn struct{}

func effectsList(ctx context.Context, e *tools.Env, _ noIn) (*mcp.CallToolResult, error) {
	l, err := e.D.Catalog.Effects(ctx)
	if err != nil {
		return nil, err
	}
	type row struct {
		ID     string          `json:"id"`
		Name   string          `json:"name"`
		Kind   string          `json:"kind"`
		Origin string          `json:"origin"`
		Params json.RawMessage `json:"params"`
	}
	out := make([]row, 0, len(l))
	for _, x := range l {
		out = append(out, row{x.ID, x.Name, x.Kind, x.Origin, x.Params})
	}
	return tools.JSON("", out), nil
}

type idIn struct {
	ID string `json:"id"`
}

func effectSource(ctx context.Context, e *tools.Env, in idIn) (*mcp.CallToolResult, error) {
	x, err := e.D.Catalog.Effect(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if x.Source == nil {
		p, _ := json.Marshal(x.Params)
		return tools.Text("%s is a built-in effect implemented in the renderer (frontend/src/render/effects/%s); it has no stored source. Its params: %s", x.ID, x.ID, p), nil
	}
	return tools.Text("// %s (%s, %s)\n%s", x.ID, x.Kind, x.Origin, *x.Source), nil
}

type createIn struct {
	Name   string         `json:"name"`
	Kind   string         `json:"kind" jsonschema:"glsl or js"`
	Source string         `json:"source"`
	Params map[string]any `json:"params,omitempty" jsonschema:"param schema: {name: {type: number|integer|boolean|color|enum|string, min, max, default, label}}"`
}

func origin(e *tools.Env) string { return "agent:" + e.S.AgentName() }

func reply(id string, problems []string) *mcp.CallToolResult {
	if len(problems) == 0 {
		return tools.Text("Stored effect %s. The static check found no problems; place it with clip_add and look with output_render.", id)
	}
	return tools.Text("Stored effect %s, but fix these: %s.", id, strings.Join(problems, "; "))
}

func effectCreate(ctx context.Context, e *tools.Env, in createIn) (*mcp.CallToolResult, error) {
	x, problems, err := e.D.Catalog.CreateEffect(ctx, catalogsvc.EffectInput{Name: in.Name, Kind: in.Kind, Source: in.Source, Params: in.Params, Origin: origin(e)})
	if err != nil {
		return nil, err
	}
	return reply(x.ID, problems), nil
}

type updateIn struct {
	ID     string         `json:"id"`
	Source string         `json:"source"`
	Params map[string]any `json:"params,omitempty"`
}

func effectUpdate(ctx context.Context, e *tools.Env, in updateIn) (*mcp.CallToolResult, error) {
	var params any
	if in.Params != nil {
		params = in.Params
	}
	x, problems, err := e.D.Catalog.UpdateEffect(ctx, in.ID, catalogsvc.EffectInput{Source: in.Source, Params: params})
	if err != nil {
		return nil, err
	}
	return reply(x.ID, problems), nil
}
