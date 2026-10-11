// Package show holds the act tools: the projector and the live show, gated by the editor's agent toggles.
package show

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	"projmap/internal/infrastructure/mcp/tools"
)

// Register adds the act tools.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "preview_on_projector", Title: "Preview the draft on the projector",
		Description: "Plays your draft on the real projector from..to seconds, then holds. Needs \"agent may preview\". The live scene is untouched."}, preview)
	tools.Add(s, env, &mcp.Tool{Name: "transport", Title: "Control the live show",
		Description: "Live control: play, pause, stop, go (next cue), back, seek {t}, blackout {on}. Needs \"agent may go live\", which is off by default."}, transport)
	tools.Add(s, env, &mcp.Tool{Name: "projector_show", Title: "Show something on the projector",
		Description: "Puts a test pattern (white, black, gray stripes), surface outlines, or a frame of your draft on the projector; off returns to normal. Needs \"agent may preview\"."}, projectorShow)
}

type previewIn struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
}

func preview(ctx context.Context, e *tools.Env, in previewIn) (*mcp.CallToolResult, error) {
	if err := e.NeedPreview(ctx); err != nil {
		return nil, err
	}
	id, err := e.DraftID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := e.D.Show.Preview(ctx, id, in.From, in.To, true); err != nil {
		return nil, err
	}
	return tools.Text("The projector plays draft %s from %.2f to %.2f s, then holds.", id, in.From, in.To), nil
}

type transportIn struct {
	Action  string   `json:"action" jsonschema:"play, pause, stop, go, back, seek or blackout"`
	T       *float64 `json:"t,omitempty" jsonschema:"seconds, for seek"`
	On      *bool    `json:"on,omitempty" jsonschema:"for blackout"`
	SceneID string   `json:"scene_id,omitempty" jsonschema:"for activate"`
}

func transport(ctx context.Context, e *tools.Env, in transportIn) (*mcp.CallToolResult, error) {
	if err := e.NeedLive(ctx); err != nil {
		return nil, err
	}
	args, _ := json.Marshal(map[string]any{"t": in.T, "on": in.On, "sceneId": in.SceneID})
	st, err := e.D.Show.Do(ctx, in.Action, args, "agent:"+e.S.AgentName())
	if err != nil {
		return nil, err
	}
	return tools.JSON(fmt.Sprintf("Show: %s, on air %v.", st.Transport.State, st.OnAir), st), nil
}

type showIn struct {
	Kind       string   `json:"kind" jsonschema:"pattern, outline, draft_frame or off"`
	Pattern    string   `json:"pattern,omitempty" jsonschema:"white, black or gray (for kind pattern)"`
	Axis       string   `json:"axis,omitempty" jsonschema:"x or y (gray)"`
	Bit        int      `json:"bit,omitempty"`
	Inverse    bool     `json:"inverse,omitempty"`
	SurfaceIDs []string `json:"surface_ids,omitempty" jsonschema:"for outline"`
	T          float64  `json:"t,omitempty" jsonschema:"seconds, for draft_frame"`
	Ms         int      `json:"ms,omitempty" jsonschema:"how long outlines stay, default 3000"`
}

// OutputTarget is the projector output.
var OutputTarget = realtime.Target{Role: "output"}

func projectorShow(ctx context.Context, e *tools.Env, in showIn) (*mcp.CallToolResult, error) {
	if err := e.NeedPreview(ctx); err != nil {
		return nil, err
	}
	call := func(method string, args any) error {
		cctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		_, err := e.D.Caller.Call(cctx, OutputTarget, method, args)
		return err
	}
	switch in.Kind {
	case "pattern":
		args := map[string]any{"kind": in.Pattern}
		if in.Pattern == "gray" {
			args["axis"], args["bit"], args["inverse"] = in.Axis, in.Bit, in.Inverse
		} else if in.Pattern != "white" && in.Pattern != "black" {
			return nil, app_errors.BadRequest("pattern must be white, black or gray.")
		}
		if err := call("output.pattern", args); err != nil {
			return nil, err
		}
		return tools.Text("The projector shows the %s pattern. Use kind off to return to normal.", in.Pattern), nil
	case "outline":
		if in.Ms <= 0 {
			in.Ms = 3000
		}
		if err := call("output.outline", map[string]any{"surfaceIds": in.SurfaceIDs, "color": "#ffffff", "width": 3, "ms": in.Ms}); err != nil {
			return nil, err
		}
		return tools.Text("The projector outlines %v for %d ms.", in.SurfaceIDs, in.Ms), nil
	case "draft_frame":
		id, err := e.DraftID(ctx)
		if err != nil {
			return nil, err
		}
		if _, err := e.D.Show.Preview(ctx, id, in.T, in.T, false); err != nil {
			return nil, err
		}
		return tools.Text("The projector holds draft %s at %.2f s. Use kind off to end the preview.", id, in.T), nil
	case "off":
		_ = call("output.pattern", map[string]any{"kind": "off"})
		if e.D.Show.Get(ctx).Preview != nil {
			if _, err := e.D.Show.Preview(ctx, "", 0, 0, false); err != nil {
				return nil, err
			}
		}
		return tools.Text("The projector is back to normal."), nil
	}
	return nil, app_errors.BadRequest("kind must be pattern, outline, draft_frame or off.")
}
