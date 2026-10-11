// Package camera holds the MCP tools over the phone camera and calibration: the agent's eyes, the Gray-code pass,
// surface detection, camera-space surface creation and alignment checks.
package camera

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	camerasvc "projmap/internal/application/services/camera"
	"projmap/internal/domain/camera"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/mcp/tools"
	scenetools "projmap/internal/infrastructure/mcp/tools/scenes"
)

// Register adds the camera tools.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "camera_stream_status", Title: "Camera status",
		Description: "Whether the phone camera is connected and streaming: resolution, fps, how old the last frame is, whether the phone is steady and level."}, status)
	tools.Add(s, env, &mcp.Tool{Name: "camera_snapshot", Title: "See through the camera",
		Description: "The latest camera frame as an image: the agent's eyes on the real wall. still=true asks the phone for a full-resolution still with locked exposure instead (slower, better for decisions). Camera pixels in other tools refer to the calibration's camera frame (calibration_get gives its size)."}, snapshot)
	tools.Add(s, env, &mcp.Tool{Name: "camera_capture", Title: "Take a photo",
		Description: "Asks the phone for a full-resolution still with locked exposure and returns it."}, capture)
	tools.Add(s, env, &mcp.Tool{Name: "camera_compare", Title: "Compare draft and wall",
		Description: "Puts your draft's frame t on the projector, photographs the wall, and returns the render, the photo and, when calibrated, the photo with your surfaces' outlines drawn where the projector puts them. Needs \"agent may preview\"."}, compare)
	tools.Add(s, env, &mcp.Tool{Name: "calibration_run", Title: "Calibrate camera and projector",
		Description: "Projects Gray-code stripes, captures each with the phone and decodes a dense camera to projector map (about 20 s). Needs the phone on a stand, the output open and \"agent may preview\". Returns coverage and error."}, calibrationRun)
	tools.Add(s, env, &mcp.Tool{Name: "calibration_get", Title: "Read the calibration",
		Description: "The current calibration of the scene's setup: status, coverage, error in projector px, camera frame size."}, calibrationGet)
	tools.Add(s, env, &mcp.Tool{Name: "detect_surfaces", Title: "Find candidate surfaces",
		Description: "Planar regions found in the calibration map (wall, cube faces…) as polygons in camera, projector and scene pixels with confidence, plus the white calibration photo with the candidates outlined."}, detect)
	tools.Add(s, env, &mcp.Tool{Name: "surface_create_from_camera", Title: "Create a surface from camera points",
		Description: "Like surface_create, but the points are camera pixels you picked on a camera image; the calibration map turns them into scene pixels (subpixel)."}, fromCamera)
	tools.Add(s, env, &mcp.Tool{Name: "alignment_error", Title: "Measure alignment",
		Description: "Projects a surface's outline, photographs it and the lit object, and returns per edge how far the projected line is from the real edge in projector px. Fix with surface_nudge and measure again until under about 1 px. Needs \"agent may preview\" and a calibration."}, alignment)
}

type noIn struct{}

func status(ctx context.Context, e *tools.Env, _ noIn) (*mcp.CallToolResult, error) {
	st := e.D.Camera.Status(ctx)
	head := "No phone camera is connected."
	if st.Connected {
		head = fmt.Sprintf("Phone camera connected, %dx%d at %.0f fps, steady: %v.", st.Width, st.Height, st.FPS, st.Steady)
	}
	return tools.JSON(head, st), nil
}

type snapIn struct {
	Still bool `json:"still,omitempty" jsonschema:"ask for a full-resolution locked still instead of the latest preview frame"`
}

func still(ctx context.Context, e *tools.Env) ([]byte, string, error) {
	a, err := e.D.Camera.Capture(ctx, "snapshot")
	if err != nil {
		return nil, "", err
	}
	b, err := e.D.Assets.Read(ctx, a.SHA)
	return b, a.SHA, err
}

func snapshot(ctx context.Context, e *tools.Env, in snapIn) (*mcp.CallToolResult, error) {
	var b []byte
	src := "preview frame"
	if !in.Still {
		b, _ = e.D.Camera.Preview(ctx)
	}
	if b == nil {
		var sha string
		var err error
		if b, sha, err = still(ctx, e); err != nil {
			return nil, err
		}
		src = "still " + sha
	}
	img, orig, err := tools.ImageBytes(b)
	if err != nil {
		return nil, err
	}
	return tools.WithImages(fmt.Sprintf("Camera %s, %dx%d.", src, orig.Bounds().Dx(), orig.Bounds().Dy()), img), nil
}

func capture(ctx context.Context, e *tools.Env, _ noIn) (*mcp.CallToolResult, error) {
	b, sha, err := still(ctx, e)
	if err != nil {
		return nil, err
	}
	img, orig, err := tools.ImageBytes(b)
	if err != nil {
		return nil, err
	}
	return tools.WithImages(fmt.Sprintf("Still %s, %dx%d.", sha, orig.Bounds().Dx(), orig.Bounds().Dy()), img), nil
}

func setupID(ctx context.Context, e *tools.Env) (string, *scene.Scene, error) {
	sc, _, err := e.View(ctx)
	if err != nil {
		return "", nil, err
	}
	return sc.SetupID, sc, nil
}

// line draws a 2 px line.
func line(img *image.RGBA, a, b camera.Pt, c color.RGBA) {
	n := int(math.Max(math.Abs(b.X-a.X), math.Abs(b.Y-a.Y))) + 1
	for i := 0; i <= n; i++ {
		t := float64(i) / float64(n)
		x, y := int(a.X+(b.X-a.X)*t), int(a.Y+(b.Y-a.Y)*t)
		for dx := 0; dx < 2; dx++ {
			for dy := 0; dy < 2; dy++ {
				if image.Pt(x+dx, y+dy).In(img.Bounds()) {
					img.SetRGBA(x+dx, y+dy, c)
				}
			}
		}
	}
}

var palette = []color.RGBA{{255, 59, 48, 255}, {52, 199, 89, 255}, {0, 122, 255, 255}, {255, 204, 0, 255}, {175, 82, 222, 255}, {90, 200, 250, 255}}

func compare(ctx context.Context, e *tools.Env, in struct {
	T float64 `json:"t" jsonschema:"seconds"`
}) (*mcp.CallToolResult, error) {
	if err := e.NeedPreview(ctx); err != nil {
		return nil, err
	}
	draftID, err := e.DraftID(ctx)
	if err != nil {
		return nil, err
	}
	sid, _, err := setupID(ctx, e)
	if err != nil {
		return nil, err
	}
	if _, err := e.D.Show.Preview(ctx, draftID, in.T, in.T, false); err != nil {
		return nil, err
	}
	defer func() { _, _ = e.D.Show.Preview(context.WithoutCancel(ctx), "", 0, 0, false) }()
	time.Sleep(400 * time.Millisecond)
	b, sha, err := still(ctx, e)
	if err != nil {
		return nil, err
	}
	photo, _, err := tools.ImageBytes(b)
	if err != nil {
		return nil, err
	}
	text := fmt.Sprintf("Draft frame %.2f s on the wall, photo %s.", in.T, sha)
	var overlay *mcp.ImageContent
	if _, err := e.D.Calibrations.Current(ctx, sid); err == nil {
		sc, _, _ := e.View(ctx)
		cam, err := calibratedStill(b)
		if err == nil {
			i := 0
			for _, o := range sc.Objects {
				for k := range o.Surfaces {
					sf := &o.Surfaces[k]
					pts := sc.SurfacePoints(sf)
					in := make([]camera.Pt, len(pts))
					for j, p := range pts {
						in[j] = camera.Pt{X: p.X, Y: p.Y}
					}
					cp, err := e.D.Calibrations.SceneToCamera(ctx, sid, in)
					if err != nil {
						continue
					}
					for _, ed := range scenetools.Edges(sf) {
						a, b := idx(sf, ed[0]), idx(sf, ed[1])
						if a < 0 || b < 0 || cp[a].X < 0 || cp[b].X < 0 {
							continue
						}
						line(cam, cp[a], cp[b], palette[i%len(palette)])
					}
					i++
				}
			}
			overlay, _ = tools.Encode(tools.Fit(cam, tools.MaxImage), false)
			text += " The third image is the photo with your surfaces outlined where the projector puts them."
		}
	}
	var render *mcp.ImageContent
	if img, _, err := renderFrame(ctx, e, in.T); err == nil {
		render, _ = tools.Encode(tools.Fit(img, tools.MaxImage), true)
		text = "First image: the render. " + text
	} else {
		text += " (No render: " + app_errors.As(err).Message + ")"
	}
	return tools.WithImages(text, render, photo, overlay), nil
}

func idx(sf *scene.Surface, id string) int {
	for i, p := range sf.PointIDs {
		if p == id {
			return i
		}
	}
	return -1
}

// calibratedStill decodes a still at the calibration's camera frame size (at most 1280 wide), in colour.
func calibratedStill(b []byte) (*image.RGBA, error) {
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	fit := tools.Fit(img, camerasvcMax(img))
	out := image.NewRGBA(fit.Bounds())
	draw.Draw(out, out.Bounds(), fit, fit.Bounds().Min, draw.Src)
	return out, nil
}

// camerasvcMax keeps the width at the calibration frame (MaxStillWidth) in Fit's longest-side terms.
func camerasvcMax(img image.Image) int {
	b := img.Bounds()
	if b.Dx() <= camerasvc.MaxStillWidth {
		return max(b.Dx(), b.Dy())
	}
	h := b.Dy() * camerasvc.MaxStillWidth / b.Dx()
	return max(camerasvc.MaxStillWidth, h)
}

func calibrationRun(ctx context.Context, e *tools.Env, in struct {
	SetupID string `json:"setup_id,omitempty" jsonschema:"default: the scene's setup"`
}) (*mcp.CallToolResult, error) {
	if err := e.NeedPreview(ctx); err != nil {
		return nil, err
	}
	if in.SetupID == "" {
		sid, _, err := setupID(ctx, e)
		if err != nil {
			return nil, err
		}
		in.SetupID = sid
	}
	c, err := e.D.Calibrations.Start(ctx, in.SetupID)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
		cur, err := e.D.Calibrations.Get(ctx, c.ID)
		if err != nil {
			return nil, err
		}
		if cur.Status != camera.CalRunning {
			return tools.JSON(cur.Message, cur), nil
		}
	}
	return tools.Text("Calibration %s is still running; check it with calibration_get.", c.ID), nil
}

func calibrationGet(ctx context.Context, e *tools.Env, in struct {
	ID string `json:"id,omitempty" jsonschema:"calibration id; default the scene's setup's current one"`
}) (*mcp.CallToolResult, error) {
	var c *camera.Calibration
	var err error
	if in.ID != "" {
		c, err = e.D.Calibrations.Get(ctx, in.ID)
	} else {
		sid, _, serr := setupID(ctx, e)
		if serr != nil {
			return nil, serr
		}
		c, err = e.D.Calibrations.Current(ctx, sid)
	}
	if err != nil {
		return nil, err
	}
	return tools.JSON(c.Message, c), nil
}

func detect(ctx context.Context, e *tools.Env, in struct {
	Hint string `json:"hint,omitempty" jsonschema:"what you are looking for (not used for matching yet)"`
}) (*mcp.CallToolResult, error) {
	sid, _, err := setupID(ctx, e)
	if err != nil {
		return nil, err
	}
	cands, err := e.D.Calibrations.Detect(ctx, sid)
	if err != nil {
		return nil, err
	}
	res := tools.JSON(fmt.Sprintf("%d candidate surfaces, largest first. Colours in the image follow the list order (red, green, blue, yellow, purple, cyan).", len(cands)), cands)
	if c, err := e.D.Calibrations.Current(ctx, sid); err == nil && c.WhiteAsset != nil {
		if b, err := e.D.Assets.Read(ctx, *c.WhiteAsset); err == nil {
			if img, err := calibratedStill(b); err == nil {
				for i, cd := range cands {
					for j := range cd.Camera {
						line(img, cd.Camera[j], cd.Camera[(j+1)%len(cd.Camera)], palette[i%len(palette)])
					}
				}
				if enc, err := tools.Encode(tools.Fit(img, tools.MaxImage), false); err == nil {
					res.Content = append(res.Content, enc)
				}
			}
		}
	}
	return res, nil
}

type fromCameraIn struct {
	Object   string      `json:"object"`
	Name     string      `json:"name"`
	Kind     string      `json:"kind,omitempty"`
	Role     string      `json:"role,omitempty"`
	ParentID string      `json:"parent_id,omitempty"`
	Points   []camera.Pt `json:"points_cam" jsonschema:"camera pixels [{x, y}] in the calibration's camera frame, in surface order"`
}

func fromCamera(ctx context.Context, e *tools.Env, in fromCameraIn) (*mcp.CallToolResult, error) {
	sid, _, err := setupID(ctx, e)
	if err != nil {
		return nil, err
	}
	pts, err := e.D.Calibrations.CameraToScene(ctx, sid, in.Points)
	if err != nil {
		return nil, err
	}
	sp := make([]scenetools.PointIn, len(pts))
	for i, p := range pts {
		sp[i] = scenetools.PointIn{X: p.X, Y: p.Y}
	}
	id, ids, err := scenetools.CreateSurface(ctx, e, scenetools.SurfaceIn{Object: in.Object, Name: in.Name, Kind: in.Kind, Role: in.Role, ParentID: in.ParentID, Points: sp})
	if err != nil {
		return nil, err
	}
	return tools.JSON(fmt.Sprintf("Created surface %s from camera points.", id), map[string]any{"surface": id, "pointIds": ids, "scenePoints": pts}), nil
}

func alignment(ctx context.Context, e *tools.Env, in struct {
	Surface string `json:"surface" jsonschema:"surface id or name"`
}) (*mcp.CallToolResult, error) {
	if err := e.NeedPreview(ctx); err != nil {
		return nil, err
	}
	sc, draftID, err := e.View(ctx)
	if err != nil {
		return nil, err
	}
	var sf *scene.Surface
	for oi := range sc.Objects {
		for si := range sc.Objects[oi].Surfaces {
			if s := &sc.Objects[oi].Surfaces[si]; s.ID == in.Surface || s.Name == in.Surface {
				sf = s
			}
		}
	}
	if sf == nil {
		return nil, app_errors.NotFound("Surface %s does not exist.", in.Surface)
	}
	edges := scenetools.Edges(sf)
	var pairs [][2]camera.Pt
	for _, ed := range edges {
		a, b := sc.Point(ed[0]), sc.Point(ed[1])
		if a == nil || b == nil {
			continue
		}
		pairs = append(pairs, [2]camera.Pt{{X: a.X, Y: a.Y}, {X: b.X, Y: b.Y}})
	}
	if draftID != "" {
		if _, err := e.D.Show.Preview(ctx, draftID, 0, 0, false); err != nil {
			return nil, err
		}
		defer func() { _, _ = e.D.Show.Preview(context.WithoutCancel(ctx), "", 0, 0, false) }()
	}
	res, err := e.D.Calibrations.Measure(ctx, camerasvc.AlignInput{SetupID: sc.SetupID, SurfaceIDs: []string{sf.ID}, Edges: pairs})
	if err != nil {
		return nil, err
	}
	worst := 0.0
	for i := range res {
		if i < len(edges) {
			res[i].From, res[i].To = edges[i][0], edges[i][1]
		}
		worst = math.Max(worst, res[i].ErrorPx)
	}
	head := fmt.Sprintf("Worst edge of %s is %.2f projector px off.", sf.ID, worst)
	if worst < 1 {
		head += " Under 1 px: aligned."
	}
	return tools.JSON(head, res), nil
}

// renderFrame renders t of the draft when a render client is connected.
var renderFrame = func(ctx context.Context, e *tools.Env, t float64) (image.Image, string, error) {
	return nil, "", app_errors.Unavailable("no renderer")
}

// UseRenderer connects the render tools (set by the server).
func UseRenderer(f func(ctx context.Context, e *tools.Env, t float64) (image.Image, string, error)) {
	renderFrame = f
}
