package backdrop

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/mcp/tools"
)

const accentDescription = "Draws the mapped objects over the backdrop in static, live, color and scenery mode (protocol §19): each " +
	"object's outer silhouette (no inner edges, no details) as a sharp line with a glow, and an optional fill: light (a soft " +
	"light inside), cut (the backdrop blocked inside, the object stays dark with lit edges) or only (the backdrop only inside). " +
	"Only the fields you pass change; on: false turns it off. Live on the wall with \"agents edit live\", else in your draft."

type accentIn struct {
	Scene       string   `json:"scene,omitempty" jsonschema:"scene id or name; default the scene on the wall"`
	On          *bool    `json:"on,omitempty" jsonschema:"draw the accent"`
	Objects     []string `json:"objects,omitempty" jsonschema:"object ids or names to accent; [\"all\"] for every object"`
	Outline     *bool    `json:"outline,omitempty" jsonschema:"draw the silhouette line"`
	Width       *float64 `json:"width,omitempty" jsonschema:"line width in scene px, 0..64"`
	Color       string   `json:"color,omitempty" jsonschema:"line colour #rrggbb (also the light fill's colour)"`
	Glow        *float64 `json:"glow,omitempty" jsonschema:"glow around the line, 0..1"`
	Fill        *bool    `json:"fill,omitempty" jsonschema:"fill the silhouette"`
	FillMode    string   `json:"fill_mode,omitempty" jsonschema:"light, cut or only"`
	FillOpacity *float64 `json:"fill_opacity,omitempty" jsonschema:"fill strength, 0..1"`
}

func registerAccent(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "object_accent_set", Title: "Accent the objects", Description: accentDescription}, objectAccentSet)
}

func objectAccentSet(ctx context.Context, e *tools.Env, in accentIn) (*mcp.CallToolResult, error) {
	w, err := open(ctx, e, in.Scene)
	if err != nil {
		return nil, err
	}
	a := scene.DefaultObjectAccent()
	if w.sc.ObjectAccent != nil {
		a = *w.sc.ObjectAccent
	}
	set := func(dst *bool, v *bool) {
		if v != nil {
			*dst = *v
		}
	}
	setF := func(dst *float64, v *float64) {
		if v != nil {
			*dst = *v
		}
	}
	set(&a.On, in.On)
	set(&a.Outline.On, in.Outline)
	set(&a.Fill.On, in.Fill)
	setF(&a.Outline.Width, in.Width)
	setF(&a.Outline.Glow, in.Glow)
	setF(&a.Fill.Opacity, in.FillOpacity)
	if in.Color != "" {
		a.Outline.Color = in.Color
	}
	if in.FillMode != "" {
		a.Fill.Mode = in.FillMode
	}
	if len(in.Objects) > 0 {
		if len(in.Objects) == 1 && in.Objects[0] == "all" {
			a.Objects = scene.AccentObjects{All: true}
		} else {
			ids := make([]string, 0, len(in.Objects))
			for _, ref := range in.Objects {
				i := w.sc.FindObject(ref)
				if i < 0 {
					return nil, app_errors.NotFound("Object %s does not exist in scene %s.", ref, w.sc.Name)
				}
				ids = append(ids, w.sc.Objects[i].ID)
			}
			a.Objects = scene.AccentObjects{IDs: ids}
		}
	}
	if err := w.write(ctx, []docpatch.Op{docpatch.Add("/objectAccent", a)}); err != nil {
		return nil, err
	}
	which := "every object"
	if !a.Objects.All {
		which = strings.Join(a.Objects.IDs, ", ")
	}
	state := "off"
	if a.On {
		state = fmt.Sprintf("on for %s (outline %v, %.0f px %s, glow %.2f; fill %v, %s at %.2f)", which, a.Outline.On, a.Outline.Width,
			a.Outline.Color, a.Outline.Glow, a.Fill.On, a.Fill.Mode, a.Fill.Opacity)
	}
	return tools.Text("The object accent of scene %s is %s, %s.", w.sc.Name, state, w.where("")), nil
}
