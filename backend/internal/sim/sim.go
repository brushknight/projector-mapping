// Package sim is `projmap sim`: a fake projector output and a fake phone that connect to the server like /out and the
// iPhone app do. The fake camera looks at a synthetic desk with a cube (vision.DeskWorld) lit by whatever the fake
// output shows (scene surfaces, Gray-code patterns, outlines), so calibration and auto map run without hardware.
package sim

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"math"
	"math/rand"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"projmap/internal/domain/scene"
	"projmap/internal/domain/setup"
	"projmap/internal/infrastructure/vision"
)

// Options configure a run.
type Options struct {
	URL   string
	Token string
	// Output makes the sim act as the projector output too.
	Output bool
	// FPS of the camera preview.
	FPS float64
	// CamW, CamH are the still size (default 1280x960).
	CamW, CamH int
	Log        *slog.Logger
}

// Sim holds the shared state: what the projector shows.
type Sim struct {
	o   Options
	log *slog.Logger

	mu       sync.Mutex
	set      setup.Setup
	sc       *scene.Scene
	pattern  map[string]any
	outline  []string
	outUntil time.Time
	dirty    bool
	world    *vision.World
	rng      *rand.Rand
}

// Run connects and serves until ctx ends.
func Run(ctx context.Context, o Options) error {
	if o.FPS <= 0 {
		o.FPS = 6
	}
	if o.CamW == 0 {
		o.CamW, o.CamH = 1280, 960
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
	s := &Sim{o: o, log: o.Log, set: setup.Default("", ""), pattern: map[string]any{"kind": "off"}, dirty: true, rng: rand.New(rand.NewSource(1))}
	s.world = vision.DeskWorld(o.CamW, o.CamH, s.set.Output.Width, s.set.Output.Height)
	errc := make(chan error, 2)
	if o.Output {
		go func() { errc <- s.runOutput(ctx) }()
	}
	go func() { errc <- s.runPhone(ctx) }()
	s.log.Info("sim running", "url", o.URL, "output", o.Output)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

type msg struct {
	T  string          `json:"t"`
	Ch string          `json:"ch,omitempty"`
	ID string          `json:"id,omitempty"`
	Re string          `json:"re,omitempty"`
	V  *int64          `json:"v,omitempty"`
	D  json.RawMessage `json:"d,omitempty"`
}

func data(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

type client struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func (c *client) send(ctx context.Context, m msg) error {
	b, _ := json.Marshal(m)
	c.mu.Lock()
	defer c.mu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return c.ws.Write(wctx, websocket.MessageText, b)
}

func (s *Sim) dial(ctx context.Context, role, name string, caps []string) (*client, error) {
	u := strings.Replace(strings.Replace(s.o.URL, "https://", "wss://", 1), "http://", "ws://", 1) + "/ws"
	ws, _, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		return nil, fmt.Errorf("connect %s: %w", u, err)
	}
	ws.SetReadLimit(32 << 20)
	c := &client{ws: ws}
	if err := c.send(ctx, msg{T: "hello", D: data(map[string]any{"token": s.o.Token, "role": role, "name": name, "caps": caps, "build": "sim"})}); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *client) read(ctx context.Context) (msg, error) {
	_, b, err := c.ws.Read(ctx)
	if err != nil {
		return msg{}, err
	}
	var m msg
	err = json.Unmarshal(b, &m)
	return m, err
}

// runOutput is the fake /out: it follows the show, scene and setup, and answers output.pattern and output.outline.
func (s *Sim) runOutput(ctx context.Context) error {
	c, err := s.dial(ctx, "output", "sim output", nil)
	if err != nil {
		return err
	}
	defer c.ws.CloseNow()
	_ = c.send(ctx, msg{T: "sub", Ch: "show"})
	scene, setupCh := "", ""
	for {
		m, err := c.read(ctx)
		if err != nil {
			return err
		}
		switch m.T {
		case "error":
			s.log.Warn("output error", "d", string(m.D))
		case "snapshot":
			switch {
			case m.Ch == "show":
				var sh struct {
					ActiveSceneID string `json:"activeSceneId"`
					ActiveSetupID string `json:"activeSetupId"`
				}
				_ = json.Unmarshal(m.D, &sh)
				if ch := "scene:" + sh.ActiveSceneID; sh.ActiveSceneID != "" && ch != scene {
					if scene != "" {
						_ = c.send(ctx, msg{T: "unsub", Ch: scene})
					}
					scene = ch
					_ = c.send(ctx, msg{T: "sub", Ch: scene})
				}
				if ch := "setup:" + sh.ActiveSetupID; sh.ActiveSetupID != "" && ch != setupCh {
					if setupCh != "" {
						_ = c.send(ctx, msg{T: "unsub", Ch: setupCh})
					}
					setupCh = ch
					_ = c.send(ctx, msg{T: "sub", Ch: setupCh})
				}
			case strings.HasPrefix(m.Ch, "scene:"):
				if sc, err := sceneDecode(m.D); err == nil {
					s.mu.Lock()
					s.sc, s.dirty = sc, true
					s.mu.Unlock()
				}
			case strings.HasPrefix(m.Ch, "setup:"):
				var st setup.Setup
				if json.Unmarshal(m.D, &st) == nil {
					s.mu.Lock()
					if st.Output.Width != s.set.Output.Width || st.Output.Height != s.set.Output.Height {
						s.world = vision.DeskWorld(s.o.CamW, s.o.CamH, st.Output.Width, st.Output.Height)
					}
					s.set, s.dirty = st, true
					s.mu.Unlock()
				}
			}
		case "patched":
			// refetch the whole document: simplest way to stay exact
			_ = c.send(ctx, msg{T: "sub", Ch: m.Ch})
		case "rpc":
			var r struct {
				Method string          `json:"method"`
				Args   json.RawMessage `json:"args"`
			}
			_ = json.Unmarshal(m.D, &r)
			switch r.Method {
			case "output.pattern":
				var p map[string]any
				_ = json.Unmarshal(r.Args, &p)
				s.mu.Lock()
				s.pattern, s.dirty = p, true
				w, h := s.set.Output.Width, s.set.Output.Height
				s.mu.Unlock()
				time.Sleep(50 * time.Millisecond) // "3 presented frames"
				_ = c.send(ctx, msg{T: "rpc.result", Re: m.ID, D: data(map[string]any{"presented": true, "width": w, "height": h})})
			case "output.outline":
				var a struct {
					SurfaceIDs []string `json:"surfaceIds"`
					Ms         int      `json:"ms"`
				}
				_ = json.Unmarshal(r.Args, &a)
				if a.Ms <= 0 {
					a.Ms = 3000
				}
				s.mu.Lock()
				s.outline, s.outUntil, s.dirty = a.SurfaceIDs, time.Now().Add(time.Duration(a.Ms)*time.Millisecond), true
				s.mu.Unlock()
				_ = c.send(ctx, msg{T: "rpc.result", Re: m.ID, D: data(map[string]any{"presented": true})})
			default:
				_ = c.send(ctx, msg{T: "rpc.error", Re: m.ID, D: data(map[string]string{"code": "unsupported", "message": "the sim output does not do " + r.Method})})
			}
		}
	}
}

func sceneDecode(b []byte) (*scene.Scene, error) { return scene.Decode(b) }

// runPhone is the fake iPhone: camera.capture stills and a preview stream.
func (s *Sim) runPhone(ctx context.Context) error {
	c, err := s.dial(ctx, "remote", "sim phone", []string{"camera", "haptics"})
	if err != nil {
		return err
	}
	defer c.ws.CloseNow()
	go s.stream(ctx, c)
	for {
		m, err := c.read(ctx)
		if err != nil {
			return err
		}
		if m.T == "error" {
			s.log.Warn("phone error", "d", string(m.D))
		}
		if m.T != "rpc" {
			continue
		}
		var r struct {
			Method string `json:"method"`
			Args   struct {
				RequestID string `json:"requestId"`
			} `json:"args"`
		}
		_ = json.Unmarshal(m.D, &r)
		if r.Method != "camera.capture" {
			_ = c.send(ctx, msg{T: "rpc.error", Re: m.ID, D: data(map[string]string{"code": "unsupported", "message": r.Method})})
			continue
		}
		go func(id, req string) {
			sha, err := s.capture(ctx, req)
			if err != nil {
				_ = c.send(ctx, msg{T: "rpc.error", Re: id, D: data(map[string]string{"code": "capture_failed", "message": err.Error()})})
				return
			}
			_ = c.send(ctx, msg{T: "rpc.result", Re: id, D: data(map[string]string{"sha": sha})})
		}(m.ID, r.Args.RequestID)
	}
}

// projector is the intensity function of what the output shows now.
func (s *Sim) projector() func(px, py float64) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	kind, _ := s.pattern["kind"].(string)
	w, h := s.set.Output.Width, s.set.Output.Height
	if kind == "gray" || kind == "white" || kind == "black" {
		axis, _ := s.pattern["axis"].(string)
		bit, _ := s.pattern["bit"].(float64)
		inv, _ := s.pattern["inverse"].(bool)
		base := vision.PatternFunc(kind, axis, int(bit), inv, w, h)
		if len(s.outline) == 0 || time.Now().After(s.outUntil) {
			return base
		}
		r := s.rasterLocked(false)
		return func(px, py float64) float64 { return math.Max(base(px, py), sample(r, px, py)) }
	}
	r := s.rasterLocked(true)
	return func(px, py float64) float64 { return sample(r, px, py) }
}

func sample(r *image.Gray, px, py float64) float64 {
	x, y := int(px), int(py)
	if !image.Pt(x, y).In(r.Bounds()) {
		return 0
	}
	return float64(r.GrayAt(x, y).Y) / 255
}

// rasterLocked draws the scene (faces dim, backdrop dark) and any outlines in physical pixels.
func (s *Sim) rasterLocked(withScene bool) *image.Gray {
	w, h := s.set.Output.Width, s.set.Output.Height
	r := image.NewGray(image.Rect(0, 0, w, h))
	outlining := len(s.outline) > 0 && time.Now().Before(s.outUntil)
	if withScene {
		for i := range r.Pix {
			r.Pix[i] = 30
		}
	}
	if s.sc == nil {
		return r
	}
	phys := func(p scene.Point) vision.Pt {
		x, y := s.set.Output.SceneToPhysical(p.X, p.Y)
		return vision.Pt{X: x, Y: y}
	}
	for _, o := range s.sc.Objects {
		for k := range o.Surfaces {
			sf := &o.Surfaces[k]
			pts := s.sc.SurfacePoints(sf)
			var poly []vision.Pt
			for _, p := range pts {
				poly = append(poly, phys(p))
			}
			if withScene && sf.Visible && (sf.Kind == "quad" || sf.Kind == "tri" || sf.Kind == "poly") && sf.Role == "face" {
				fillPoly(r, poly, 140)
			}
			if outlining && contains(s.outline, sf.ID) {
				for i := range poly {
					if i+1 == len(poly) && sf.Kind == "line" {
						break
					}
					drawLine(r, poly[i], poly[(i+1)%len(poly)], 3)
				}
			}
		}
	}
	return r
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

func fillPoly(r *image.Gray, poly []vision.Pt, v uint8) {
	if len(poly) < 3 {
		return
	}
	minY, maxY := math.Inf(1), math.Inf(-1)
	for _, p := range poly {
		minY, maxY = math.Min(minY, p.Y), math.Max(maxY, p.Y)
	}
	b := r.Bounds()
	for y := max(int(minY), 0); y <= min(int(maxY), b.Dy()-1); y++ {
		fy := float64(y) + 0.5
		var xs []float64
		for i := range poly {
			a, c := poly[i], poly[(i+1)%len(poly)]
			if (a.Y <= fy && c.Y > fy) || (c.Y <= fy && a.Y > fy) {
				xs = append(xs, a.X+(fy-a.Y)/(c.Y-a.Y)*(c.X-a.X))
			}
		}
		for i := 1; i < len(xs); i++ {
			for j := i; j > 0 && xs[j] < xs[j-1]; j-- {
				xs[j], xs[j-1] = xs[j-1], xs[j]
			}
		}
		for i := 0; i+1 < len(xs); i += 2 {
			for x := max(int(xs[i]+0.5), 0); x < min(int(xs[i+1]+0.5), b.Dx()); x++ {
				r.Pix[y*r.Stride+x] = v
			}
		}
	}
}

func drawLine(r *image.Gray, a, b vision.Pt, width float64) {
	n := int(math.Max(math.Abs(b.X-a.X), math.Abs(b.Y-a.Y))) + 1
	half := int(width / 2)
	for i := 0; i <= n; i++ {
		t := float64(i) / float64(n)
		x, y := int(a.X+(b.X-a.X)*t), int(a.Y+(b.Y-a.Y)*t)
		for dx := -half; dx <= half; dx++ {
			for dy := -half; dy <= half; dy++ {
				if image.Pt(x+dx, y+dy).In(r.Bounds()) {
					r.SetGray(x+dx, y+dy, struct{ Y uint8 }{255})
				}
			}
		}
	}
}

// Frame renders what the camera sees now at the still size.
func (s *Sim) Frame() image.Image {
	f := s.projector()
	s.mu.Lock()
	w := s.world
	seed := s.rng.Int63()
	s.mu.Unlock()
	return w.Render(f, 0.01, rand.New(rand.NewSource(seed)))
}

func (s *Sim) capture(ctx context.Context, requestID string) (string, error) {
	img := s.Frame()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 92}); err != nil {
		return "", err
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "still.jpg")
	_, _ = fw.Write(buf.Bytes())
	_ = mw.Close()
	req, _ := http.NewRequestWithContext(ctx, "POST", s.o.URL+"/api/v1/camera/stills?request="+requestID, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if s.o.Token != "" {
		req.Header.Set("Authorization", "Bearer "+s.o.Token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var a struct {
		SHA     string `json:"sha"`
		Message string `json:"message"`
	}
	_ = json.NewDecoder(res.Body).Decode(&a)
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("upload: %d %s", res.StatusCode, a.Message)
	}
	return a.SHA, nil
}

// stream sends camera.frame at FPS and camera.status every second.
func (s *Sim) stream(ctx context.Context, c *client) {
	tick := time.NewTicker(time.Duration(float64(time.Second) / s.o.FPS))
	defer tick.Stop()
	var seq int64
	last := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		img := s.Frame()
		small := downscale(img, 640)
		var buf bytes.Buffer
		_ = jpeg.Encode(&buf, small, &jpeg.Options{Quality: 60})
		seq++
		b := small.Bounds()
		if err := c.send(ctx, msg{T: "camera.frame", Ch: "camera", D: data(map[string]any{"seq": seq, "width": b.Dx(), "height": b.Dy(),
			"jpeg": base64.StdEncoding.EncodeToString(buf.Bytes())})}); err != nil {
			return
		}
		if time.Since(last) >= time.Second {
			last = time.Now()
			_ = c.send(ctx, msg{T: "camera.status", Ch: "camera", D: data(map[string]any{"streaming": true, "fps": s.o.FPS,
				"width": b.Dx(), "height": b.Dy(), "steady": true, "level": 0.2})})
		}
	}
}

func downscale(img image.Image, w int) *image.Gray {
	b := img.Bounds()
	h := b.Dy() * w / b.Dx()
	out := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			sx, sy := b.Min.X+x*b.Dx()/w, b.Min.Y+y*b.Dy()/h
			r, _, _, _ := img.At(sx, sy).RGBA()
			out.Pix[y*out.Stride+x] = uint8(r >> 8)
		}
	}
	return out
}
