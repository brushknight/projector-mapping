package camerasvc

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"math"
	"time"

	"projmap/internal/application/app_errors"
	cameraport "projmap/internal/application/ports/out/camera"
	"projmap/internal/domain/camera"
	"projmap/internal/domain/setup"
)

// Messages the phone and the editor show as they are.
const (
	NoOutputMessage = "No projector output is connected. Open the output on the projector: in the editor, Set up → put on projector, or run `projmap open --out --display 2`."
	NoPhoneMessage  = "No phone camera is connected. Open projmap on the phone and keep auto map open."
)

// MinCoverage fails a calibration whose camera saw less than this share of the projection.
var MinCoverage = 0.05

// MovedLimitPx fails a calibration whose closing white still is shifted more than this (camera pixels at
// MaxStillWidth) against the first one.
var MovedLimitPx = 6.0

// AimTTL keeps the aiming image up without a renewal (the phone sends calibration.aim {on:true} every few seconds).
var AimTTL = 15 * time.Second

// outputErr turns an output.pattern failure into something a person can act on.
func outputErr(err error, step string, connected bool) error {
	if !connected {
		return app_errors.NoOutput("The projector output disconnected during calibration (pattern %s). %s", step, NoOutputMessage)
	}
	if app_errors.As(err).Code == "timeout" {
		return app_errors.Timeout("The projector output did not show pattern %s in time. Keep the output window in front and full screen, then retry.", step)
	}
	return app_errors.Unavailable("The projector output could not show pattern %s: %s", step, app_errors.As(err).Message)
}

// phoneErr turns a capture failure into something a person can act on.
func phoneErr(err error, step string, connected bool) error {
	if !connected {
		return app_errors.NoPhone("The phone disconnected during calibration (pattern %s). Keep projmap open on the phone, with the screen on, and retry.", step)
	}
	if app_errors.As(err).Code == "timeout" {
		return app_errors.Timeout("The phone did not send the photo of pattern %s in time. Keep projmap open on the phone, on the same Wi-Fi as the Mac, and retry.", step)
	}
	return app_errors.Unavailable("The phone could not take the photo of pattern %s: %s", step, app_errors.As(err).Message)
}

// Aim projects the aiming image (full white) on the output while the phone is being pointed, or takes it down.
// While on, it stays up for AimTTL after the last call, so a phone that goes away does not leave the projector white.
func (s *Calibrations) Aim(ctx context.Context, on bool, cameraROI *camera.Rect) error {
	s.mu.Lock()
	running := s.running
	s.mu.Unlock()
	if running != "" {
		if on {
			return app_errors.Conflict("Calibration %s is running; it drives the projector now.", running)
		}
		return nil
	}
	if !s.caller.Has(OutputTarget) {
		s.mu.Lock()
		s.aimUntil = time.Time{}
		s.mu.Unlock()
		if on {
			return app_errors.NoOutput(NoOutputMessage)
		}
		return nil
	}
	s.mu.Lock()
	checking := s.checking
	s.mu.Unlock()
	if checking && on {
		return nil // the light check drives the output for a moment and ends on white
	}
	args := map[string]any{"kind": "off"}
	if on {
		args["kind"] = "white"
		// with a camera ROI and an earlier calibration, light only that area so the person sees where it lands
		if !cameraROI.Empty() && s.ActiveSetup != nil {
			if set, _, err := s.setups.Get(ctx, s.ActiveSetup(ctx)); err == nil {
				r := clampUnit(*cameraROI)
				args = withROI(args, s.projectorROI(ctx, set, nil, &r))
			}
		}
	}
	pctx, cancel := context.WithTimeout(ctx, PatternTimeout)
	defer cancel()
	if _, err := s.caller.Call(pctx, OutputTarget, "output.pattern", args); err != nil {
		return outputErr(err, "aim", s.caller.Has(OutputTarget))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !on {
		s.aimUntil = time.Time{}
		return nil
	}
	s.aimUntil = time.Now().Add(AimTTL)
	if !s.aimWatch {
		s.aimWatch = true
		go s.watchAim()
	}
	return nil
}

// watchAim takes the aiming image down once nobody renews it.
func (s *Calibrations) watchAim() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for range t.C {
		s.mu.Lock()
		until, running := s.aimUntil, s.running
		if until.IsZero() || running != "" {
			s.aimWatch = false
			s.mu.Unlock()
			return
		}
		if time.Now().Before(until) {
			s.mu.Unlock()
			continue
		}
		s.aimUntil, s.aimWatch = time.Time{}, false
		s.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), PatternTimeout)
		_, _ = s.caller.Call(ctx, OutputTarget, "output.pattern", map[string]any{"kind": "off"})
		cancel()
		return
	}
}

// Aiming tells whether the aiming image is up.
func (s *Calibrations) Aiming() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.aimUntil.IsZero() && time.Now().Before(s.aimUntil)
}

// Preflight checks what auto map needs: a projector output with telemetry and a phone whose preview reaches the server.
func (s *Calibrations) Preflight(ctx context.Context, setupID string) camera.Preflight {
	p := camera.Preflight{Server: camera.Check{OK: true, Detail: "server answers"}, Aiming: s.Aiming()}
	s.mu.Lock()
	p.Running = s.running
	if s.lastCheck != nil && time.Since(s.lastCheck.At) < 10*time.Minute {
		p.Light = s.lastCheck
	}
	s.mu.Unlock()

	o := &p.Output
	if set, _, err := s.setups.Get(ctx, setupID); err == nil && set != nil {
		o.SetupWidth, o.SetupHeight = set.Output.Width, set.Output.Height
	}
	if out, ok := s.cam.feed.ProjectorOutput(); ok && s.caller.Has(OutputTarget) {
		o.Connected, o.Name, o.Width, o.Height, o.FPS = true, out.Name, out.Width, out.Height, out.FPS
		o.OK = true
		if out.Width > 0 {
			o.Detail = fmt.Sprintf("%s · %d×%d · %.0f fps", out.Name, out.Width, out.Height, out.FPS)
			if o.SetupWidth > 0 {
				o.Detail = fmt.Sprintf("%s · window %d×%d, setup %d×%d · %.0f fps", out.Name, out.Width, out.Height, o.SetupWidth, o.SetupHeight, out.FPS)
			}
		} else {
			o.Detail = out.Name + " · waiting for its first report"
		}
		if out.Width > 0 && o.SetupWidth > 0 && (absDiff(out.Width, o.SetupWidth) > o.SetupWidth/20 || absDiff(out.Height, o.SetupHeight) > o.SetupHeight/20) {
			o.Warning = fmt.Sprintf("The output window is %d×%d but the projector setup is %d×%d. Make the output full screen on the projector (double-click it or press F).",
				out.Width, out.Height, o.SetupWidth, o.SetupHeight)
		}
	} else {
		o.Detail = "no projector output connected"
		o.Fix = "Open the output on the projector: in the editor, Set up → put on projector, or run `projmap open --out --display 2`."
	}

	st := s.cam.Status(ctx)
	cm := &p.Camera
	cm.Connected, cm.Streaming, cm.FPS, cm.Width, cm.Height, cm.Steady, cm.LastFrame = st.Connected, st.Streaming, st.FPS, st.Width, st.Height, st.Steady, st.LastFrameMs
	switch {
	case !st.Connected:
		cm.Detail = "no phone camera connected"
		cm.Fix = "Open projmap on the phone and pair it with this server."
	case !st.Streaming && st.LastFrameMs < 0:
		cm.Detail = "no camera preview has reached the server"
		cm.Fix = "Keep auto map open on the phone and allow the camera. If it stays like this, check the phone and the Mac are on the same Wi-Fi."
	case !st.Streaming:
		cm.Detail = fmt.Sprintf("the last camera frame arrived %.1f s ago", float64(st.LastFrameMs)/1000)
		cm.Fix = "Keep auto map open on the phone with the screen on. A weak Wi-Fi signal also stalls the preview."
	default:
		cm.OK = true
		cm.Detail = fmt.Sprintf("%d×%d · %.1f fps", st.Width, st.Height, st.FPS)
	}

	p.Ready = o.OK && cm.OK && p.Running == ""
	switch {
	case !o.OK:
		p.Reason = "Open the projector output first."
	case !cm.OK:
		p.Reason = "Waiting for the phone camera preview."
	case p.Running != "":
		p.Reason = "A calibration is already running."
	}
	return p
}

func absDiff(a, b int) int {
	if a > b {
		return a - b
	}
	return b - a
}

// Moved estimates how far (camera pixels) the projected area moved between two white stills, using the black still
// to find what the projector lights. It compares the lit masks on 4×4 blocks: a shift of d pixels along an edge of
// length L changes about d·L block pixels, so the mismatch divided by the mask's perimeter is the mean edge shift.
func Moved(white0, white1, black image.Image) float64 {
	g0, ok0 := white0.(*image.Gray)
	g1, ok1 := white1.(*image.Gray)
	gb, okb := black.(*image.Gray)
	if !ok0 || !ok1 || !okb || g0.Bounds() != g1.Bounds() || g0.Bounds() != gb.Bounds() {
		return 0
	}
	const blk = 4
	r := g0.Bounds()
	bw, bh := r.Dx()/blk, r.Dy()/blk
	if bw < 4 || bh < 4 {
		return 0
	}
	avg := func(g *image.Gray, bx, by int) float64 {
		sum := 0
		for y := 0; y < blk; y++ {
			row := g.Pix[(by*blk+y)*g.Stride+bx*blk:]
			for x := 0; x < blk; x++ {
				sum += int(row[x])
			}
		}
		return float64(sum) / (blk * blk)
	}
	d0 := make([]float64, bw*bh)
	d1 := make([]float64, bw*bh)
	maxd := 0.0
	for by := 0; by < bh; by++ {
		for bx := 0; bx < bw; bx++ {
			b := avg(gb, bx, by)
			i := by*bw + bx
			d0[i], d1[i] = avg(g0, bx, by)-b, avg(g1, bx, by)-b
			maxd = math.Max(maxd, d0[i])
		}
	}
	if maxd < 20 {
		return 0 // nothing lit: decoding will report it
	}
	th := maxd * 0.4
	mask := func(d []float64, i int) bool { return d[i] > th }
	mismatch, perim := 0, 0
	for by := 0; by < bh; by++ {
		for bx := 0; bx < bw; bx++ {
			i := by*bw + bx
			a := mask(d0, i)
			if a != mask(d1, i) {
				mismatch++
			}
			if a && (bx == 0 || by == 0 || bx == bw-1 || by == bh-1 || !mask(d0, i-1) || !mask(d0, i+1) || !mask(d0, i-bw) || !mask(d0, i+bw)) {
				perim++
			}
		}
	}
	if perim == 0 {
		return 0
	}
	return float64(mismatch) / float64(perim) * blk
}

func clampUnit(r camera.Rect) camera.Rect {
	x0, y0 := math.Max(0, r.X), math.Max(0, r.Y)
	x1, y1 := math.Min(1, r.X+r.W), math.Min(1, r.Y+r.H)
	return camera.Rect{X: x0, Y: y0, W: math.Max(0, x1-x0), H: math.Max(0, y1-y0)}
}

// projectorROI is the physical projector rectangle (with a 6 % margin, at least 24 px) a calibration draws its
// patterns in: from the scene ROI, else from the camera ROI through the setup's current calibration. nil = the whole
// output (a first calibration with only a camera ROI cannot know where that is on the projector yet).
func (s *Calibrations) projectorROI(ctx context.Context, set *setup.Setup, scene, cam *camera.Rect) *camera.Rect {
	var pts []camera.Pt
	switch {
	case !scene.Empty():
		for _, p := range [][2]float64{{scene.X, scene.Y}, {scene.X + scene.W, scene.Y}, {scene.X + scene.W, scene.Y + scene.H}, {scene.X, scene.Y + scene.H}} {
			x, y := set.Output.SceneToPhysical(p[0], p[1])
			pts = append(pts, camera.Pt{X: x, Y: y})
		}
	case !cam.Empty():
		m, _, cal, err := s.mapFor(ctx, set.ID)
		if err != nil || cal == nil {
			return nil
		}
		cw, ch := m.CameraSize()
		for i := 0; i <= 4; i++ {
			for j := 0; j <= 4; j++ {
				u := (cam.X + cam.W*float64(i)/4) * float64(cw)
				v := (cam.Y + cam.H*float64(j)/4) * float64(ch)
				if q, ok := m.CamToProj(u, v); ok {
					pts = append(pts, q)
				}
			}
		}
	}
	if len(pts) < 2 {
		return nil
	}
	x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range pts {
		x0, y0, x1, y1 = math.Min(x0, p.X), math.Min(y0, p.Y), math.Max(x1, p.X), math.Max(y1, p.Y)
	}
	mx := math.Max(24, 0.06*(x1-x0))
	my := math.Max(24, 0.06*(y1-y0))
	W, H := float64(set.Output.Width), float64(set.Output.Height)
	x0, y0 = math.Max(0, math.Floor(x0-mx)), math.Max(0, math.Floor(y0-my))
	x1, y1 = math.Min(W, math.Ceil(x1+mx)), math.Min(H, math.Ceil(y1+my))
	if x1-x0 < 8 || y1-y0 < 8 {
		return nil
	}
	return &camera.Rect{X: x0, Y: y0, W: x1 - x0, H: y1 - y0}
}

// LightCheckSettle is how long the light check waits after each pattern before it reads the preview (the phone's
// frames arrive 100–400 ms after the light changes).
var LightCheckSettle = 700 * time.Millisecond

// LightCheck projects white, black and white again and compares the phone's preview frames: how much of the view the
// projector lights and how strongly. It needs an output and a streaming phone.
func (s *Calibrations) LightCheck(ctx context.Context) (*camera.LightCheck, error) {
	s.mu.Lock()
	if s.running != "" {
		s.mu.Unlock()
		return nil, app_errors.Conflict("Calibration %s is running.", s.running)
	}
	if s.checking {
		s.mu.Unlock()
		return nil, app_errors.Conflict("A light check is already running.")
	}
	s.checking = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.checking = false
		s.mu.Unlock()
	}()
	if !s.caller.Has(OutputTarget) {
		return nil, app_errors.NoOutput(NoOutputMessage)
	}
	if st := s.cam.Status(ctx); !st.Streaming {
		return nil, app_errors.NoPhone("The phone camera preview is not reaching the server. Keep auto map open on the phone.")
	}
	grab := func(kind string) (*image.Gray, error) {
		pctx, cancel := context.WithTimeout(ctx, PatternTimeout)
		_, err := s.caller.Call(pctx, OutputTarget, "output.pattern", map[string]any{"kind": kind})
		cancel()
		if err != nil {
			return nil, outputErr(err, "light check", s.caller.Has(OutputTarget))
		}
		select {
		case <-time.After(LightCheckSettle):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		f, ok := s.cam.feed.LatestFrame()
		if !ok {
			return nil, app_errors.NoPhone("No camera frame arrived.")
		}
		return DecodeStill(f.JPEG)
	}
	w1, err := grab("white")
	if err != nil {
		return nil, err
	}
	b, err := grab("black")
	if err != nil {
		return nil, err
	}
	w2, err := grab("white")
	if err != nil {
		return nil, err
	}
	if w1.Bounds() != b.Bounds() || w2.Bounds() != b.Bounds() {
		return nil, app_errors.Invalid("The preview changed size during the light check. Try again.")
	}
	lc := lightCheck(w1, b, w2, s.vision)
	s.mu.Lock()
	s.lastCheck = lc
	s.mu.Unlock()
	return lc, nil
}

func lightCheck(w1, b, w2 *image.Gray, v cameraport.Vision) *camera.LightCheck {
	n := len(b.Pix)
	wf, bf := make([]float32, n), make([]float32, n)
	r := b.Bounds()
	for y := 0; y < r.Dy(); y++ {
		for x := 0; x < r.Dx(); x++ {
			i := y*r.Dx() + x
			// the darker white of the two: a flicker or the auto exposure catching up does not count as light
			wv := min(w1.Pix[y*w1.Stride+x], w2.Pix[y*w2.Stride+x])
			wf[i], bf[i] = float32(wv)/255, float32(b.Pix[y*b.Stride+x])/255
		}
	}
	c := v.Contrast(wf, bf, r.Dx(), r.Dy())
	lc := &camera.LightCheck{Contrast: c, At: time.Now().UTC()}
	switch {
	case c.Lit < 0.01 || c.Peak < 6:
		lc.Level = "none"
		lc.Message = "The camera does not see the projector. Point the phone at the projected area, turn off the room lights and check the output is on the projector."
	case c.Peak < 25 || c.Lit < 0.05:
		lc.Level = "weak"
		lc.Message = fmt.Sprintf("The projector is only %.0f%% brighter than the room here. Turn off the lights or close the blinds; calibration may map only part of it.", c.BrighterPct)
	default:
		lc.Level = "strong"
		lc.Message = fmt.Sprintf("Projector clearly visible over %.0f%% of the view.", c.Lit*100)
	}
	return lc
}

// decodeFailure says why nothing decoded, in terms of what the camera saw.
func decodeFailure(c *camera.Contrast, err error) string {
	if c == nil {
		return fmt.Sprintf("Decoding failed: %v. Dim the room, check the phone sees the projection and run it again.", err)
	}
	switch {
	case c.Lit < 0.01 || c.Peak < 6:
		return fmt.Sprintf("The camera barely saw the projector: its light is only %.0f%% brighter than the room (at most %.0f of 255 levels). Turn off the lights or close the blinds, point the phone at the projected area and retry.", c.BrighterPct, c.Peak)
	case c.Peak < 25:
		return fmt.Sprintf("The projector light is only %.0f%% brighter than the room, too faint to read the stripes. Turn off the lights or close the blinds and retry, or mark the object so the phone meters on it.", c.BrighterPct)
	default:
		return fmt.Sprintf("The camera saw the projector on %.0f%% of the view but could not read the stripes (%v). Keep the phone still, focus the projector on the object, or mark a smaller area around it, and retry.", c.Lit*100, err)
	}
}

// DiffPNG is what the camera saw of the projector: |white − black| ×4, at most 640 px wide, 8-bit gray PNG.
func DiffPNG(white, black *image.Gray) ([]byte, error) {
	r := white.Bounds()
	if black.Bounds() != r {
		return nil, fmt.Errorf("sizes differ")
	}
	step := max(1, (r.Dx()+639)/640)
	w, h := r.Dx()/step, r.Dy()/step
	out := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			sum := 0
			for dy := 0; dy < step; dy++ {
				for dx := 0; dx < step; dx++ {
					xx, yy := x*step+dx, y*step+dy
					sum += int(white.Pix[yy*white.Stride+xx]) - int(black.Pix[yy*black.Stride+xx])
				}
			}
			v := sum * 4 / (step * step)
			out.Pix[y*out.Stride+x] = uint8(min(255, max(0, v)))
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
