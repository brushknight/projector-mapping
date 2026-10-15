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
	tools.Add(s, env, &mcp.Tool{Name: "converge_start", Title: "Start with converge",
		Description: "The opening of a mapping sequence: records the backdrop mode on air (static, live, color or scenery) as the light that converges, " +
			"switches the wall to objects mode, uses the converge clip at t = 0 or inserts one (duration seconds, default 2, onto object or the first object; " +
			"\"all\" for every object), then plays from 0 and holds at the first cue after it for GO. The light closes from its own shape onto the object's silhouette. " +
			"Needs \"agent may go live\"."}, convergeStart)
	tools.Add(s, env, &mcp.Tool{Name: "sequence_start", Title: "Start the sequence",
		Description: "Puts step 0 on the wall (protocol §20 \"Step 0\"): the scene's opening look (intro_set; without one, the backdrop on air with converge on) " +
			"holds, animated, until GO; GO then converges onto the object or crossfades into the mapping and plays to the first cue. Back from the first cue returns to step 0. " +
			"Needs \"agent may go live\"."}, sequenceStart)
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

type convergeIn struct {
	Scene    string   `json:"scene,omitempty" jsonschema:"scene id; default the scene on the wall"`
	Duration *float64 `json:"duration,omitempty" jsonschema:"seconds of an inserted converge clip, 0.1..60, default 2"`
	Object   string   `json:"object,omitempty" jsonschema:"object id or name an inserted clip converges onto, or all; default the first object"`
	Source   string   `json:"source,omitempty" jsonschema:"static, live, color or scenery: whose light converges; default the mode on air (in objects mode, the clip's own)"`
}

func convergeStart(ctx context.Context, e *tools.Env, in convergeIn) (*mcp.CallToolResult, error) {
	if err := e.NeedLive(ctx); err != nil {
		return nil, err
	}
	obj := in.Object
	if obj != "" && obj != "all" {
		id := in.Scene
		if id == "" {
			id = e.D.Show.Get(ctx).ActiveSceneID
		}
		if sc, err := e.D.Scenes.Scene(ctx, id); err == nil {
			if oi := sc.FindObject(obj); oi >= 0 {
				obj = sc.Objects[oi].ID
			}
		}
	}
	args, _ := json.Marshal(map[string]any{"sceneId": in.Scene, "duration": in.Duration, "objectId": obj, "source": in.Source})
	st, err := e.D.Show.Do(ctx, "converge", args, "agent:"+e.S.AgentName())
	if err != nil {
		return nil, err
	}
	return tools.JSON(fmt.Sprintf("The wall converges onto the object and holds at the next cue for GO (show %s).", st.Transport.State), st), nil
}

type sequenceIn struct {
	Scene string `json:"scene,omitempty" jsonschema:"scene id; default the scene on the wall"`
}

func sequenceStart(ctx context.Context, e *tools.Env, in sequenceIn) (*mcp.CallToolResult, error) {
	if err := e.NeedLive(ctx); err != nil {
		return nil, err
	}
	args, _ := json.Marshal(map[string]any{"sceneId": in.Scene})
	st, err := e.D.Show.Do(ctx, "sequence.start", args, "agent:"+e.S.AgentName())
	if err != nil {
		return nil, err
	}
	return tools.JSON("Step 0 holds on the wall: the opening look waits for GO.", st), nil
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
