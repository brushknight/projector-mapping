// Package mcp is projmap's Model Context Protocol server: the read, look, write and act tools of docs/mcp-plan.md,
// the resources and the prompts, over streamable HTTP at /mcp (and stdio through `projmap mcp`). Every MCP session
// gets its own Session: writes land in that session's draft, never live.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"net/http"

	gomcp "github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	devicessvc "projmap/internal/application/services/devices"
	"projmap/internal/config"
	"projmap/internal/infrastructure/http_server/middleware"
	"projmap/internal/infrastructure/mcp/tools"
	backdroptools "projmap/internal/infrastructure/mcp/tools/backdrop"
	cameratools "projmap/internal/infrastructure/mcp/tools/camera"
	catalogtools "projmap/internal/infrastructure/mcp/tools/catalog"
	facetools "projmap/internal/infrastructure/mcp/tools/faces"
	rendertools "projmap/internal/infrastructure/mcp/tools/render"
	scenetools "projmap/internal/infrastructure/mcp/tools/scenes"
	showtools "projmap/internal/infrastructure/mcp/tools/show"
	soundtools "projmap/internal/infrastructure/mcp/tools/sounds"
)

// StyleGuide is docs://style-guide.
const StyleGuide = `House style for projmap shows:
- Tron-like lines: thin bright strokes along real edges, crisp, with a soft glow.
- Pixel stepping: motion that snaps in small steps reads as digital; use pixelStep on trace.
- Black and white plus one accent colour per scene (default accent #FF3B30, red, for on-air moments).
- Reveal before you decorate: trace the edges, build the faces, then add details (bays, fan, cpu).
- Keep it legible on the real object: test with camera_compare before proposing.`

func init() {
	cameratools.UseRenderer(func(ctx context.Context, e *tools.Env, t float64) (image.Image, string, error) {
		return rendertools.Frame(ctx, e, t, true, tools.MaxImage)
	})
}

type ctxKey struct{}

// Handler is the streamable HTTP handler for /mcp: callers need a principal (this Mac, or a device or agent token).
func Handler(d *tools.Deps, devices devicessvc.DeviceService) http.Handler {
	h := gomcp.NewStreamableHTTPHandler(func(r *http.Request) *gomcp.Server {
		p, _ := r.Context().Value(ctxKey{}).(*middleware.Principal)
		if p == nil {
			return nil
		}
		return NewServer(d, tools.Principal{Role: p.Role, DeviceID: p.DeviceID, SessionID: p.SessionID, Local: p.Local})
	}, &gomcp.StreamableHTTPOptions{DisableLocalhostProtection: true})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := middleware.Resolve(r, devices)
		if err != nil {
			e := app_errors.As(err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(e.Status)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": e.Code, "message": e.Message})
			return
		}
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, p)))
	})
}

// NewServer builds a server for one session.
func NewServer(d *tools.Deps, p tools.Principal) *gomcp.Server {
	sess := &tools.Session{P: p}
	env := &tools.Env{D: d, S: sess}
	s := gomcp.NewServer(&gomcp.Implementation{Name: "projmap", Title: "projmap projection mapping", Version: config.Version},
		&gomcp.ServerOptions{
			Instructions: "projmap drives a projector. Read with scene_get, look with output_render and camera_snapshot, write into your draft " +
				"(surface_create, clip_add, cue_add…), check with camera_compare or alignment_error, and finish with proposal_submit. " +
				"Coordinates are scene pixels (0,0 top left). To draw an object's real details on its faces: object_unfold_get, " +
				"face_template_get, face_draw (points in face UV: (0,0) = the face's first point, u toward the 2nd, v toward the 4th), " +
				"face_render to look, then proposal_submit; docs://drawing and the dress-object prompt walk through it. " +
				"Sound effects: sound_list shows the library and the soundboard pads; clip_add {sound, offset?, volume?} puts a sound on the " +
				"timeline (a sound track), and sound_play plays a pad or sound on the audio output. " +
				"The backdrop (what the wall shows outside mapping): catalog_get, scene_list, scene_create, scene_activate, mode_set, " +
				"light_set (the light: intensity, focus, kelvin, fx, slide), attachment_add / attachment_update / attachment_remove / gobo_set " +
				"(gobos in front of the light), backdrop_set (live, color, scenery layers), motion_set (sun passes, drifts) and preset_apply. " +
				"With the editor's \"agents edit live\" switch they change the wall at once, else they write into your draft. " +
				"Projector, live-show and apply tools need the editor's agent toggles.",
			InitializedHandler: func(ctx context.Context, req *gomcp.InitializedRequest) {
				if ip := req.Session.InitializeParams(); ip != nil && ip.ClientInfo != nil {
					sess.Client = ip.ClientInfo.Name
				}
			},
		})
	scenetools.Register(s, env)
	catalogtools.Register(s, env)
	rendertools.Register(s, env)
	cameratools.Register(s, env)
	showtools.Register(s, env)
	facetools.Register(s, env)
	soundtools.Register(s, env)
	backdroptools.Register(s, env)
	registerResources(s, env)
	registerPrompts(s)
	return s
}

func registerResources(s *gomcp.Server, env *tools.Env) {
	text := func(uri, mime, body string) *gomcp.ReadResourceResult {
		return &gomcp.ReadResourceResult{Contents: []*gomcp.ResourceContents{{URI: uri, MIMEType: mime, Text: body}}}
	}
	s.AddResource(&gomcp.Resource{URI: "scene://current", Name: "current scene", MIMEType: "application/json",
		Description: "The scene you work on (your draft once you have written, else the live scene) as JSON."},
		func(ctx context.Context, _ *gomcp.ReadResourceRequest) (*gomcp.ReadResourceResult, error) {
			sc, _, err := env.View(ctx)
			if err != nil {
				return nil, err
			}
			b, _ := json.MarshalIndent(sc, "", " ")
			return text("scene://current", "application/json", string(b)), nil
		})
	s.AddResource(&gomcp.Resource{URI: "effects://catalog", Name: "effect catalog", MIMEType: "application/json",
		Description: "Every effect with its param schema."},
		func(ctx context.Context, _ *gomcp.ReadResourceRequest) (*gomcp.ReadResourceResult, error) {
			l, err := env.D.Catalog.Effects(ctx)
			if err != nil {
				return nil, err
			}
			b, _ := json.MarshalIndent(l, "", " ")
			return text("effects://catalog", "application/json", string(b)), nil
		})
	s.AddResource(&gomcp.Resource{URI: "docs://effect-api", Name: "effect API", MIMEType: "text/markdown",
		Description: "How to write GLSL and JS effects."},
		func(context.Context, *gomcp.ReadResourceRequest) (*gomcp.ReadResourceResult, error) {
			return text("docs://effect-api", "text/markdown", env.D.EffectAPI), nil
		})
	s.AddResource(&gomcp.Resource{URI: "docs://drawing", Name: "drawing on faces", MIMEType: "text/markdown",
		Description: "Face UV, strokes, layers and a worked example (four drive bays on a cube's right face)."},
		func(context.Context, *gomcp.ReadResourceRequest) (*gomcp.ReadResourceResult, error) {
			return text("docs://drawing", "text/markdown", facetools.DrawingDoc), nil
		})
	s.AddResource(&gomcp.Resource{URI: "docs://style-guide", Name: "house style", MIMEType: "text/plain",
		Description: "The look projmap shows aim for."},
		func(context.Context, *gomcp.ReadResourceRequest) (*gomcp.ReadResourceResult, error) {
			return text("docs://style-guide", "text/plain", StyleGuide), nil
		})
}

func registerPrompts(s *gomcp.Server) {
	s.AddPrompt(&gomcp.Prompt{Name: "dress-object", Title: "Dress an object as the real device",
		Description: "Draw a real device's details (bays, vents, logo, LEDs, seams) on a mapped object's flat faces, look, compare, iterate, propose.",
		Arguments: []*gomcp.PromptArgument{{Name: "objectId", Description: "object id or name, for example obj_cube or zimacube", Required: true},
			{Name: "device", Description: "what the real object is, for example \"ZimaCube NAS\"", Required: true}}},
		func(_ context.Context, req *gomcp.GetPromptRequest) (*gomcp.GetPromptResult, error) {
			a := req.Params.Arguments
			obj, dev := a["objectId"], a["device"]
			if dev == "" {
				dev = "device"
			}
			msg := fmt.Sprintf(facetools.Prompt, obj, dev, obj, dev)
			return &gomcp.GetPromptResult{Description: "dress " + obj + " as " + dev, Messages: []*gomcp.PromptMessage{{Role: "user", Content: &gomcp.TextContent{Text: msg}}}}, nil
		})
	s.AddPrompt(&gomcp.Prompt{Name: "animate-object", Title: "Animate an object",
		Description: "Make one mapped object come alive.",
		Arguments: []*gomcp.PromptArgument{{Name: "object", Description: "object name or id", Required: true},
			{Name: "mood", Description: "for example calm, techy, dramatic"}, {Name: "duration", Description: "seconds"}}},
		func(_ context.Context, req *gomcp.GetPromptRequest) (*gomcp.GetPromptResult, error) {
			a := req.Params.Arguments
			msg := "Animate the object \"" + a["object"] + "\" in projmap"
			if a["mood"] != "" {
				msg += " with a " + a["mood"] + " mood"
			}
			if a["duration"] != "" {
				msg += " over " + a["duration"] + " seconds"
			}
			msg += ". First call scene_get, then reference_photo_get (or camera_snapshot) to see the real object, then surface_get for its faces. " +
				"Look before you write: render key frames with output_render. Place clips and cues, check the motion with output_render_strip, " +
				"and finish with proposal_submit. Follow docs://style-guide."
			return &gomcp.GetPromptResult{Description: "animate " + a["object"], Messages: []*gomcp.PromptMessage{{Role: "user", Content: &gomcp.TextContent{Text: msg}}}}, nil
		})
	s.AddPrompt(&gomcp.Prompt{Name: "reveal-sequence", Title: "Reveal sequence",
		Description: "Reveal several objects one after another, one cue each.",
		Arguments: []*gomcp.PromptArgument{{Name: "objects", Description: "comma-separated object names", Required: true},
			{Name: "duration", Description: "total seconds"}}},
		func(_ context.Context, req *gomcp.GetPromptRequest) (*gomcp.GetPromptResult, error) {
			a := req.Params.Arguments
			msg := "Build a reveal sequence in projmap for: " + a["objects"]
			if a["duration"] != "" {
				msg += ", about " + a["duration"] + " seconds in total"
			}
			msg += ". Call scene_get and reference_photo_get first. Give each object its own cue (cue_add) so the phone's GO steps through them: " +
				"trace the edges, build the faces, then the details. Check with output_render_strip, then proposal_submit with a one-line summary."
			return &gomcp.GetPromptResult{Description: "reveal " + a["objects"], Messages: []*gomcp.PromptMessage{{Role: "user", Content: &gomcp.TextContent{Text: msg}}}}, nil
		})
}
