// Package tools holds what the MCP tools share: the services they call (Deps), the per-session state (Session: the
// caller and its draft), the registration wrapper (errors as tool results, event logging) and image helpers.
package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/image/draw"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	agentssvc "projmap/internal/application/services/agents"
	assetssvc "projmap/internal/application/services/assets"
	camerasvc "projmap/internal/application/services/camera"
	catalogsvc "projmap/internal/application/services/catalog"
	scenessvc "projmap/internal/application/services/scenes"
	setupssvc "projmap/internal/application/services/setups"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/domain/agents"
	"projmap/internal/domain/devices"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/setup"
)

// Deps are the services the tools call.
type Deps struct {
	Scenes       scenessvc.SceneService
	Drafts       scenessvc.DraftService
	Presets      scenessvc.PresetService
	Setups       setupssvc.SetupService
	Show         showsvc.ShowService
	Catalog      catalogsvc.CatalogService
	Assets       assetssvc.AssetService
	Agents       agentssvc.AgentService
	Camera       camerasvc.CameraService
	Calibrations camerasvc.CalibrationService
	Caller       realtime.Caller
	// EffectAPI is docs/effects.md.
	EffectAPI string
	// RenderTimeout bounds render.frame.
	RenderTimeout time.Duration
	// Port is the server's HTTP port, for the links tools print (default 7400).
	Port int
}

// EditorURL is the editor's address on this Mac, for messages to the user.
func (d *Deps) EditorURL() string {
	p := d.Port
	if p == 0 {
		p = 7400
	}
	return fmt.Sprintf("http://localhost:%d", p)
}

// Principal is who opened the MCP session.
type Principal struct {
	Role      devices.Role
	DeviceID  string
	SessionID string
	Local     bool
}

// Session is one MCP session's state: the caller and, once it writes, its agent session and draft.
type Session struct {
	P Principal
	// Client is the MCP client's name (claude-code, codex-mcp-client…).
	Client string

	mu    sync.Mutex
	agent *agents.Session
}

// Env is what a tool handler gets.
type Env struct {
	D *Deps
	S *Session
}

// AgentName guesses codex or claude from the client name.
func (s *Session) AgentName() string {
	if strings.Contains(strings.ToLower(s.Client), "codex") {
		return "codex"
	}
	return "claude"
}

// AgentSession returns the session's agent session, attaching one (with a draft) when create is set.
func (e *Env) AgentSession(ctx context.Context, create bool) (*agents.Session, error) {
	e.S.mu.Lock()
	defer e.S.mu.Unlock()
	if e.S.agent != nil && e.S.P.SessionID == "" {
		// a client that attached on its own starts over once its draft is applied or discarded, so it can keep
		// working (and its look tools show the live scene until it writes again)
		if d, err := e.D.Drafts.Get(ctx, e.S.agent.DraftID); err == nil && !d.IsOpen() {
			e.S.agent = nil
		}
	}
	if e.S.agent != nil {
		return e.S.agent, nil
	}
	if e.S.P.SessionID != "" {
		a, err := e.D.Agents.Get(ctx, e.S.P.SessionID)
		if err != nil {
			return nil, err
		}
		e.S.agent = a
		return a, nil
	}
	if !create {
		return nil, nil
	}
	a, err := e.D.Agents.Attach(ctx, e.S.AgentName(), "")
	if err != nil {
		return nil, err
	}
	e.S.agent = a
	return a, nil
}

// DraftID is the session's draft (created on first use).
func (e *Env) DraftID(ctx context.Context) (string, error) {
	a, err := e.AgentSession(ctx, true)
	if err != nil {
		return "", err
	}
	d, err := e.D.Drafts.Get(ctx, a.DraftID)
	if err != nil {
		return "", err
	}
	if !d.IsOpen() {
		return "", app_errors.Conflict("Draft %s is %s. Start a new agent session to keep working.", d.ID, d.Status)
	}
	return a.DraftID, nil
}

// View is the scene the agent works on: its draft when it has one, else the active scene.
func (e *Env) View(ctx context.Context) (*scene.Scene, string, error) {
	a, err := e.AgentSession(ctx, false)
	if err != nil {
		return nil, "", err
	}
	if a != nil {
		s, err := e.D.Drafts.View(ctx, a.DraftID)
		return s, a.DraftID, err
	}
	id := e.D.Show.Get(ctx).ActiveSceneID
	if id == "" {
		return nil, "", app_errors.NoScene("No scene is active.")
	}
	s, err := e.D.Scenes.Scene(ctx, id)
	return s, "", err
}

// WriteView is the draft view for a write (the draft is created first).
func (e *Env) WriteView(ctx context.Context) (*scene.Scene, string, error) {
	id, err := e.DraftID(ctx)
	if err != nil {
		return nil, "", err
	}
	s, err := e.D.Drafts.View(ctx, id)
	return s, id, err
}

// Write appends ops to the session's draft.
func (e *Env) Write(ctx context.Context, ops []docpatch.Op) error {
	id, err := e.DraftID(ctx)
	if err != nil {
		return err
	}
	_, err = e.D.Drafts.AddOps(ctx, id, ops)
	return err
}

// Setup is the setup of a scene.
func (e *Env) Setup(ctx context.Context, sc *scene.Scene) (*setup.Setup, error) {
	s, _, err := e.D.Setups.Get(ctx, sc.SetupID)
	return s, err
}

// Settings are the agent toggles.
func (e *Env) Settings(ctx context.Context) agents.Settings { return e.D.Agents.Settings(ctx) }

// NeedPreview refuses unless the editor allows agents to use the projector.
func (e *Env) NeedPreview(ctx context.Context) error {
	if !e.Settings(ctx).AgentMayPreview {
		return app_errors.Forbidden("The editor has not allowed agents to use the projector. Ask the user to turn on \"agent may preview\" in the editor.")
	}
	return nil
}

// NeedLive refuses unless the editor allows agents to go live.
func (e *Env) NeedLive(ctx context.Context) error {
	if !e.Settings(ctx).AgentMayGoLive {
		return app_errors.Forbidden("The editor has not allowed agents to control the live show. Ask the user to turn on \"agent may go live\".")
	}
	return nil
}

// NeedApply refuses unless the editor allows agents to apply their own drafts.
func (e *Env) NeedApply(ctx context.Context) error {
	if !e.Settings(ctx).AgentMayApply {
		return app_errors.Forbidden("The editor has not allowed agents to apply drafts. Use proposal_submit so the user can apply it, or ask the user to turn on \"agent may apply\" in the editor's agent panel (agentMayApply in PATCH /api/v1/settings).")
	}
	return nil
}

// Handler is a tool's body.
type Handler[In any] func(ctx context.Context, e *Env, in In) (*mcp.CallToolResult, error)

// Add registers a tool: errors become tool results (isError) the agent can read, and attached sessions get an event.
func Add[In any](s *mcp.Server, env *Env, t *mcp.Tool, h Handler[In]) {
	mcp.AddTool(s, t, func(ctx context.Context, req *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
		start := time.Now()
		res, err := h(ctx, env, in)
		if err != nil {
			res = &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: app_errors.As(err).Message}}}
			if e := app_errors.As(err); e.Code == "internal" {
				res.Content = []mcp.Content{&mcp.TextContent{Text: err.Error()}}
			}
		}
		env.log(ctx, t.Name, in, !res.IsError, time.Since(start))
		return res, nil, nil
	})
}

func (e *Env) log(ctx context.Context, tool string, in any, ok bool, d time.Duration) {
	e.S.mu.Lock()
	a := e.S.agent
	e.S.mu.Unlock()
	if a == nil || e.D.Agents.Owned(a.ID) {
		return
	}
	b, _ := json.Marshal(in)
	text := tool
	var m map[string]any
	if json.Unmarshal(b, &m) == nil && len(m) > 0 {
		// a readable line for the agent panel: the tool, then what it acted on
		var parts []string
		for _, k := range []string{"name", "surface_id", "object_id", "layer_id", "layer_name", "id", "summary"} {
			if v, ok := m[k].(string); ok && v != "" {
				parts = append(parts, v)
			}
		}
		if st, ok := m["strokes"].([]any); ok {
			parts = append(parts, fmt.Sprintf("%d strokes", len(st)))
		}
		if len(parts) > 0 {
			text = tool + " · " + strings.Join(parts, " · ")
		} else {
			text = tool + " " + string(b)
		}
	}
	if len(text) > 120 {
		text = text[:120] + "…"
	}
	e.D.Agents.Log(context.WithoutCancel(ctx), a.ID, agents.Event{Kind: agents.KindTool, Tool: tool, Text: text, DurationMs: d.Milliseconds(), OK: &ok})
}

// Text is a text result.
func Text(format string, a ...any) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf(format, a...)}}}
}

// JSON is a result with a line of text and a JSON body.
func JSON(head string, v any) *mcp.CallToolResult {
	b, _ := json.MarshalIndent(v, "", " ")
	if head != "" {
		return Text("%s\n%s", head, b)
	}
	return Text("%s", b)
}

// MaxImage is the longest side of images sent to agents.
const MaxImage = 1280

// Fit scales an image down to MaxImage.
func Fit(img image.Image, max int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= max && h <= max {
		return img
	}
	if w >= h {
		h, w = h*max/w, max
	} else {
		w, h = w*max/h, max
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	return dst
}

// ImageBytes decodes an image file, fits it and re-encodes it (PNG stays PNG, the rest becomes JPEG).
func ImageBytes(b []byte) (*mcp.ImageContent, image.Image, error) {
	img, format, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, nil, app_errors.Invalid("The image could not be decoded (%v).", err)
	}
	fit := Fit(img, MaxImage)
	c, err := Encode(fit, format == "png")
	return c, img, err
}

// Encode makes image content.
func Encode(img image.Image, asPNG bool) (*mcp.ImageContent, error) {
	var buf bytes.Buffer
	if asPNG {
		if err := png.Encode(&buf, img); err != nil {
			return nil, err
		}
		return &mcp.ImageContent{Data: buf.Bytes(), MIMEType: "image/png"}, nil
	}
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return &mcp.ImageContent{Data: buf.Bytes(), MIMEType: "image/jpeg"}, nil
}

// WithImages is a result with text and images.
func WithImages(text string, imgs ...*mcp.ImageContent) *mcp.CallToolResult {
	r := Text("%s", text)
	for _, i := range imgs {
		if i != nil {
			r.Content = append(r.Content, i)
		}
	}
	return r
}
