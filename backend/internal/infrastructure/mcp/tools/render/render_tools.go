// Package render holds the look tools that render frames through a connected render client (render.frame RPC).
package render

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	"projmap/internal/infrastructure/mcp/tools"
)

// Register adds the render tools.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "output_render", Title: "Render a frame",
		Description: "A PNG of exactly what the projector would show at time t (seconds) for your draft (draft=false renders the live scene). Needs the editor or /out open in a browser on this Mac (it renders for you)."}, outputRender)
	tools.Add(s, env, &mcp.Tool{Name: "output_render_strip", Title: "Render a contact sheet",
		Description: "Frames from..to at fps (at most 16 frames) side by side, to judge motion without video."}, outputStrip)
}

// RenderTarget is who answers render.frame.
var RenderTarget = realtime.Target{Cap: "render"}

// Frame renders one frame and returns the decoded image.
func Frame(ctx context.Context, e *tools.Env, t float64, draft bool, width int) (image.Image, string, error) {
	sc, draftID, err := e.View(ctx)
	if err != nil {
		return nil, "", err
	}
	if !e.D.Caller.Has(RenderTarget) {
		return nil, "", app_errors.Unavailable("No client can render right now. Ask the user to open the editor (or /out) in Chrome on this Mac; it renders frames for agents.")
	}
	// agents look at their mapping: render objects mode whatever is on the wall (protocol §9 render.frame)
	args := map[string]any{"sceneId": sc.ID, "t": t, "width": width, "mode": "objects"}
	if draft && draftID != "" {
		args["draftId"] = draftID
	}
	timeout := e.D.RenderTimeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res, err := e.D.Caller.Call(ctx, RenderTarget, "render.frame", args)
	if err != nil {
		return nil, "", err
	}
	var r struct {
		SHA string `json:"sha"`
	}
	if json.Unmarshal(res, &r) != nil || r.SHA == "" {
		return nil, "", app_errors.Unavailable("The render client answered without a sha.")
	}
	b, err := e.D.Assets.Read(ctx, r.SHA)
	if err != nil {
		return nil, "", err
	}
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, "", app_errors.Invalid("The rendered frame is not an image: %v", err)
	}
	return img, r.SHA, nil
}

type renderIn struct {
	T     float64 `json:"t" jsonschema:"seconds on the timeline"`
	Draft *bool   `json:"draft,omitempty" jsonschema:"render your draft (default true) or the live scene"`
	Width int     `json:"width,omitempty" jsonschema:"pixels, default 1280"`
}

func outputRender(ctx context.Context, e *tools.Env, in renderIn) (*mcp.CallToolResult, error) {
	draft := in.Draft == nil || *in.Draft
	if in.Width <= 0 || in.Width > tools.MaxImage {
		in.Width = tools.MaxImage
	}
	img, sha, err := Frame(ctx, e, in.T, draft, in.Width)
	if err != nil {
		return nil, err
	}
	c, err := tools.Encode(tools.Fit(img, tools.MaxImage), true)
	if err != nil {
		return nil, err
	}
	return tools.WithImages(fmt.Sprintf("Frame at %.2f s (%s), asset %s.", in.T, map[bool]string{true: "draft", false: "live"}[draft], sha), c), nil
}

type stripIn struct {
	From  float64 `json:"from"`
	To    float64 `json:"to"`
	FPS   float64 `json:"fps,omitempty" jsonschema:"frames per second, default 2"`
	Draft *bool   `json:"draft,omitempty"`
}

func outputStrip(ctx context.Context, e *tools.Env, in stripIn) (*mcp.CallToolResult, error) {
	if in.FPS <= 0 {
		in.FPS = 2
	}
	if in.To <= in.From {
		return nil, app_errors.BadRequest("to must be after from.")
	}
	n := int(math.Floor((in.To-in.From)*in.FPS)) + 1
	if n > 16 {
		n = 16
	}
	draft := in.Draft == nil || *in.Draft
	const w = 320
	var frames []image.Image
	for i := 0; i < n; i++ {
		t := in.From + float64(i)/in.FPS
		img, _, err := Frame(ctx, e, t, draft, w)
		if err != nil {
			return nil, err
		}
		frames = append(frames, tools.Fit(img, w))
	}
	cols := int(math.Ceil(math.Sqrt(float64(n))))
	rows := (n + cols - 1) / cols
	fb := frames[0].Bounds()
	cw, ch := fb.Dx()+4, fb.Dy()+4
	sheet := image.NewRGBA(image.Rect(0, 0, cols*cw, rows*ch))
	draw.Draw(sheet, sheet.Bounds(), &image.Uniform{color.RGBA{40, 40, 40, 255}}, image.Point{}, draw.Src)
	for i, f := range frames {
		x, y := (i%cols)*cw+2, (i/cols)*ch+2
		draw.Draw(sheet, image.Rect(x, y, x+f.Bounds().Dx(), y+f.Bounds().Dy()), f, f.Bounds().Min, draw.Src)
	}
	c, err := tools.Encode(tools.Fit(sheet, tools.MaxImage), true)
	if err != nil {
		return nil, err
	}
	return tools.WithImages(fmt.Sprintf("%d frames from %.2f s at %.1f fps, left to right, top to bottom.", n, in.From, in.FPS), c), nil
}
