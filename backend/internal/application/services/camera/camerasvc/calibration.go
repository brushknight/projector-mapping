package camerasvc

import (
	"context"
	"fmt"
	"image"
	"log/slog"
	"os"
	"strconv"
	"sync"
	"time"

	"projmap/internal/application/app_errors"
	cameraport "projmap/internal/application/ports/out/camera"
	"projmap/internal/application/ports/out/realtime"
	camerarepo "projmap/internal/application/ports/repository/camera"
	"projmap/internal/application/services"
	assetssvc "projmap/internal/application/services/assets"
	camerasvc "projmap/internal/application/services/camera"
	setupssvc "projmap/internal/application/services/setups"
	"projmap/internal/domain/camera"
	"projmap/internal/domain/setup"
)

// CalibChannel is a calibration's progress channel.
func CalibChannel(id string) string { return "calib:" + id }

// OutputTarget is who answers output.pattern and output.outline.
var OutputTarget = realtime.Target{Role: "output"}

// PatternTimeout bounds one output.pattern answer (3 presented frames).
var PatternTimeout = 8 * time.Second

// SettleDelay waits after the output says a pattern is presented and before the phone captures it. The output's
// "presented" means the browser drew it; a wireless display (AirPlay) or a slow projector shows it 100–300 ms later,
// and a capture before that sees the previous pattern. PROJMAP_CALIB_SETTLE_MS overrides it (use 800 for AirPlay).
var SettleDelay = settleFromEnv()

func settleFromEnv() time.Duration {
	if v, err := strconv.Atoi(os.Getenv("PROJMAP_CALIB_SETTLE_MS")); err == nil && v >= 0 {
		return time.Duration(v) * time.Millisecond
	}
	return 350 * time.Millisecond
}

// Calibrations implements CalibrationService.
type Calibrations struct {
	repo   camerarepo.CalibrationRepository
	setups setupssvc.SetupService
	cam    *Camera
	assets assetssvc.AssetService
	vision cameraport.Vision
	caller realtime.Caller
	pub    realtime.Publisher
	log    *slog.Logger

	mu        sync.Mutex
	running   string
	aimUntil  time.Time // the aiming image stays up until then unless renewed (calibration.aim heartbeats)
	aimWatch  bool
	checking  bool // a light check drives the output
	lastCheck *camera.LightCheck

	// ActiveSetup names the active setup (for the aim ROI); set by the module.
	ActiveSetup func(context.Context) string
	progress    map[string]*camera.Progress
	maps        map[string]cameraport.Map
	cands       map[string][]camera.Candidate
}

var _ camerasvc.CalibrationService = (*Calibrations)(nil)

// NewCalibrations makes the calibration service.
func NewCalibrations(repo camerarepo.CalibrationRepository, setups setupssvc.SetupService, cam *Camera, as assetssvc.AssetService,
	v cameraport.Vision, caller realtime.Caller, pub realtime.Publisher, log *slog.Logger) *Calibrations {
	return &Calibrations{repo: repo, setups: setups, cam: cam, assets: as, vision: v, caller: caller, pub: pub, log: log,
		progress: map[string]*camera.Progress{}, maps: map[string]cameraport.Map{}, cands: map[string][]camera.Candidate{}}
}

// Recover marks calibrations left running by a previous server process as failed (their sequencer died with it), so
// clients that ask, or subscribe to calib:{id}, see why instead of a pass that never ends.
func (s *Calibrations) Recover(ctx context.Context) {
	l, err := s.repo.Running(ctx)
	if err != nil {
		s.log.Warn("calibration recovery", "err", err)
		return
	}
	for _, c := range l {
		c.Status, c.Message = camera.CalFailed, "Interrupted: the server restarted during calibration. Run it again."
		if err := s.repo.Save(ctx, c); err != nil {
			s.log.Warn("calibration recovery", "id", c.ID, "err", err)
			continue
		}
		s.report(c.ID, camera.Progress{Step: "failed", Message: c.Message})
		s.log.Info("calibration interrupted by a restart", "id", c.ID)
	}
}

func (s *Calibrations) report(id string, p camera.Progress) {
	s.mu.Lock()
	s.progress[id] = &p
	s.mu.Unlock()
	s.pub.Publish(CalibChannel(id), realtime.Message{T: "snapshot", Ch: CalibChannel(id), V: realtime.Ver(int64(p.Done)), D: realtime.Data(p)})
}

func (s *Calibrations) Start(ctx context.Context, setupID string) (*camera.Calibration, error) {
	return s.StartROI(ctx, setupID, camera.ROI{})
}

// StartROI starts a calibration limited to a region of interest (scene rectangle and/or camera rectangle).
func (s *Calibrations) StartROI(ctx context.Context, setupID string, roi camera.ROI) (*camera.Calibration, error) {
	set, _, err := s.setups.Get(ctx, setupID)
	if err != nil {
		return nil, err
	}
	if !s.caller.Has(OutputTarget) {
		return nil, app_errors.NoOutput(NoOutputMessage)
	}
	if !s.caller.Has(CameraTarget) {
		return nil, app_errors.NoPhone(NoPhoneMessage)
	}
	s.mu.Lock()
	if s.running != "" {
		id := s.running
		s.mu.Unlock()
		return nil, app_errors.Conflict("Calibration %s is still running.", id)
	}
	s.aimUntil = time.Time{} // the calibration takes over the output
	c := &camera.Calibration{ID: services.NewID("cal"), SetupID: setupID, Status: camera.CalRunning, Message: "starting",
		ProjW: set.Output.Width, ProjH: set.Output.Height, CreatedAt: time.Now().UTC()}
	if !roi.Scene.Empty() {
		c.ROI = roi.Scene
	}
	if !roi.Camera.Empty() {
		r := clampUnit(*roi.Camera)
		c.CameraROI = &r
	}
	c.ProjectorROI = s.projectorROI(ctx, set, c.ROI, c.CameraROI)
	s.running = c.ID
	s.mu.Unlock()
	if err := s.repo.Save(ctx, c); err != nil {
		s.mu.Lock()
		s.running = ""
		s.mu.Unlock()
		return nil, err
	}
	s.report(c.ID, camera.Progress{Step: "start", Done: 0, Total: len(s.steps(set)), Message: "Locking the camera"})
	go s.run(c, set)
	return c, nil
}

type step struct {
	name string
	args map[string]any
	// checkable: the camera should see this pattern differ clearly from the one before (stripes wide enough to
	// survive blur), so a still that does not is stale.
	checkable bool
}

// withROI adds the projector ROI to a pattern's args (the output draws the pattern inside it and black outside).
func withROI(args map[string]any, r *camera.Rect) map[string]any {
	if r.Empty() {
		return args
	}
	out := map[string]any{"roi": map[string]any{"x": r.X, "y": r.Y, "w": r.W, "h": r.H}}
	for k, v := range args {
		out[k] = v
	}
	return out
}

func (s *Calibrations) steps(set *setup.Setup) []step {
	out := []step{{"white", map[string]any{"kind": "white"}, false}, {"black", map[string]any{"kind": "black"}, false}}
	for _, ax := range []struct {
		axis string
		n    int
	}{{"x", set.Output.Width}, {"y", set.Output.Height}} {
		for bit := 0; bit < s.vision.Bits(ax.n); bit++ {
			for _, inv := range []bool{false, true} {
				out = append(out, step{fmt.Sprintf("%s%d%s", ax.axis, bit, map[bool]string{true: "i", false: ""}[inv]),
					map[string]any{"kind": "gray", "axis": ax.axis, "bit": bit, "inverse": inv}, bit >= max(4, s.vision.Bits(ax.n)-4)})
			}
		}
	}
	// white again: compared with the first white, it shows whether the phone moved during the pass
	return append(out, step{"verify", map[string]any{"kind": "white"}, true})
}

func (s *Calibrations) run(c *camera.Calibration, set *setup.Setup) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	defer func() {
		s.mu.Lock()
		s.running = ""
		s.mu.Unlock()
		pctx, pcancel := context.WithTimeout(context.Background(), PatternTimeout)
		_, _ = s.caller.Call(pctx, OutputTarget, "output.pattern", map[string]any{"kind": "off"})
		pcancel()
	}()
	fail := func(err error) {
		c.Status, c.Message = camera.CalFailed, app_errors.As(err).Message
		if e := app_errors.As(err); e.Code == "internal" {
			c.Message = err.Error()
		}
		_ = s.repo.Save(context.Background(), c)
		s.report(c.ID, camera.Progress{Step: "failed", Message: c.Message})
		s.log.Warn("calibration failed", "id", c.ID, "err", err)
	}
	steps := s.steps(set)
	shots := map[string]image.Image{}
	settle := SettleDelay
	var sc *syncCheck
	var prev *image.Gray
	// shoot waits settle and captures one still
	shoot := func(name string) (*image.Gray, string, error) {
		select {
		case <-time.After(settle):
		case <-ctx.Done():
			return nil, "", ctx.Err()
		}
		a, err := s.cam.Capture(ctx, "calibration")
		if err != nil {
			return nil, "", phoneErr(err, name, s.caller.Has(CameraTarget))
		}
		b, err := s.assets.Read(ctx, a.SHA)
		if err != nil {
			return nil, "", err
		}
		img, err := DecodeStill(b)
		if err != nil {
			return nil, "", err
		}
		return img, a.SHA, nil
	}
	restarts := 0
	for i := 0; i < len(steps); i++ {
		st := steps[i]
		s.report(c.ID, camera.Progress{Step: st.name, Done: i, Total: len(steps), Message: fmt.Sprintf("Pattern %d of %d", i+1, len(steps))})
		pctx, pcancel := context.WithTimeout(ctx, PatternTimeout)
		_, err := s.caller.Call(pctx, OutputTarget, "output.pattern", withROI(st.args, c.ProjectorROI))
		pcancel()
		if err != nil {
			fail(outputErr(err, st.name, s.caller.Has(OutputTarget)))
			return
		}
		img, sha, err := shoot(st.name)
		if err != nil {
			fail(err)
			return
		}
		// Synchronisation: a still that shows the previous pattern (the projector or the phone lags) is taken again
		// with a longer settle, and the longer settle is kept for the rest of the pass. When black needed a longer
		// settle, the white before it was taken too early as well: the pass starts over from white.
		settleBefore := settle
		for {
			stale, why := false, ""
			switch {
			case st.name == "black":
				ct := s.vision.Contrast(grayF(shots["white"].(*image.Gray)), grayF(img), img.Bounds().Dx(), img.Bounds().Dy())
				if ct.Lit < 0.01 || ct.Peak < 6 {
					stale, why = true, "black looks like white"
				}
				if !stale || settle >= MaxSettle {
					if stale {
						q := camera.Quality{Contrast: &ct}
						c.Quality = &q
						fail(app_errors.Invalid("%s", decodeFailure(&ct, fmt.Errorf("white and black look the same"))))
						return
					}
					sc = newSyncCheck(shots["white"].(*image.Gray), img, ct.Threshold/255)
				}
			case sc != nil && prev != nil && st.checkable:
				if ch := sc.changed(prev, img); ch < 0.15 {
					stale, why = true, fmt.Sprintf("only %.0f%% of the lit area changed", ch*100)
				}
			}
			if !stale || settle >= MaxSettle {
				break
			}
			settle = min(MaxSettle, max(2*settle, 250*time.Millisecond))
			c.SettleMs = int(settle / time.Millisecond)
			s.log.Info("calibration: stale capture, waiting longer", "id", c.ID, "step", st.name, "why", why, "settle", settle)
			s.report(c.ID, camera.Progress{Step: st.name, Done: i, Total: len(steps),
				Message: fmt.Sprintf("Pattern %d of %d: the projector lags, waiting %d ms per pattern", i+1, len(steps), settle/time.Millisecond)})
			if img, sha, err = shoot(st.name); err != nil {
				fail(err)
				return
			}
		}
		if st.name == "black" && settle != settleBefore && restarts < 4 {
			restarts++
			sc, prev = nil, nil
			i = -1
			continue
		}
		prev = img
		shots[st.name] = img
		if st.name == "verify" {
			if moved := Moved(shots["white"], img, shots["black"]); moved > MovedLimitPx {
				s.log.Warn("calibration: the phone moved", "id", c.ID, "shiftPx", moved)
				fail(app_errors.Invalid("The phone moved during calibration (about %.0f px). Steady it and retry.", moved))
				return
			}
		}
		if st.name == "white" {
			c.WhiteAsset = &sha
		}
	}
	s.report(c.ID, camera.Progress{Step: "decode", Done: len(steps), Total: len(steps) + 1, Message: "Decoding the patterns"})
	f := cameraport.Frames{White: shots["white"], Black: shots["black"]}
	for _, ax := range []struct {
		axis string
		n    int
		dst  *[][2]image.Image
	}{{"x", set.Output.Width, &f.X}, {"y", set.Output.Height, &f.Y}} {
		for bit := 0; bit < s.vision.Bits(ax.n); bit++ {
			*ax.dst = append(*ax.dst, [2]image.Image{shots[fmt.Sprintf("%s%d", ax.axis, bit)], shots[fmt.Sprintf("%s%di", ax.axis, bit)]})
		}
	}
	var droi cameraport.DecodeROI
	if r := c.CameraROI; !r.Empty() && f.White != nil {
		b := f.White.Bounds()
		droi.CamROI = image.Rect(int(r.X*float64(b.Dx())), int(r.Y*float64(b.Dy())), int((r.X+r.W)*float64(b.Dx())), int((r.Y+r.H)*float64(b.Dy())))
	}
	if r := c.ProjectorROI; !r.Empty() {
		droi.ProjROI = image.Rect(int(r.X), int(r.Y), int(r.X+r.W), int(r.Y+r.H))
	}
	if g0, ok := f.White.(*image.Gray); ok {
		if g1, ok := f.Black.(*image.Gray); ok {
			if png, err := DiffPNG(g0, g1); err == nil {
				if a, err := s.assets.Upload(ctx, png, "calibration"); err == nil {
					sha := a.SHA
					c.DiffAsset = &sha
				}
			}
		}
	}
	m, q, err := s.vision.Decode(f, set.Output.Width, set.Output.Height, droi)
	if err != nil {
		c.Quality = &q
		fail(app_errors.Invalid("%s", decodeFailure(q.Contrast, err)))
		return
	}
	if q.Coverage < MinCoverage && (q.ROI == nil || q.ROI.Mapped < 0.2) {
		fail(app_errors.Invalid("The camera saw only %.0f%% of the projection. Point the phone so the whole projected image is in view, dim the room and retry.", q.Coverage*100))
		return
	}
	png, err := m.Encode()
	if err != nil {
		fail(err)
		return
	}
	asset, err := s.assets.Upload(ctx, png, "calibration")
	if err != nil {
		fail(err)
		return
	}
	sha := asset.SHA
	c.MapAsset, c.Quality = &sha, &q
	if conf, err := m.Confidence(); err == nil {
		if ca, err := s.assets.Upload(ctx, conf, "calibration"); err == nil {
			csha := ca.SHA
			c.ConfidenceAsset = &csha
		}
	}
	c.CameraW, c.CameraH = m.CameraSize()
	c.Status, c.Message = camera.CalDone, fmt.Sprintf("Calibrated: %.0f%% coverage, %.2f px error", q.Coverage*100, q.ErrorPx)
	if r := q.ROI; r != nil {
		c.Message += fmt.Sprintf(". Sharp area mapped: %.0f%%", r.Sharp*100)
		if r.Sharp < 0.4 {
			c.Message += ". Most of the area is out of focus: focus the projector on the object, or draw a smaller area around it"
		}
	}
	if q.Coverage < 0.5 && c.ProjectorROI.Empty() && c.CameraROI.Empty() {
		c.Message += ". The camera saw only part of the projection: surfaces outside it cannot be mapped"
	}
	if err := s.repo.Save(ctx, c); err != nil {
		fail(err)
		return
	}
	s.mu.Lock()
	s.maps[c.ID] = m
	s.mu.Unlock()
	if _, err := s.setups.Merge(ctx, set.ID, realtime.Data(map[string]any{"calibrationId": c.ID}), "calibration"); err != nil {
		s.log.Warn("set calibrationId", "err", err)
	}
	s.report(c.ID, camera.Progress{Step: "done", Done: len(steps) + 1, Total: len(steps) + 1, Message: c.Message})
}

func (s *Calibrations) Get(ctx context.Context, id string) (*camera.Calibration, error) {
	return s.repo.Get(ctx, id)
}

func (s *Calibrations) Progress(ctx context.Context, id string) (*camera.Progress, error) {
	s.mu.Lock()
	p := s.progress[id]
	s.mu.Unlock()
	if p != nil {
		return p, nil
	}
	c, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return &camera.Progress{Step: c.Status, Done: 1, Total: 1, Message: c.Message}, nil
}

func (s *Calibrations) Current(ctx context.Context, setupID string) (*camera.Calibration, error) {
	set, _, err := s.setups.Get(ctx, setupID)
	if err != nil {
		return nil, err
	}
	if set.CalibrationID == nil || *set.CalibrationID == "" {
		return nil, app_errors.NotFound("Setup %s has no calibration yet. Run calibration_run first.", setupID)
	}
	return s.repo.Get(ctx, *set.CalibrationID)
}

// mapFor loads (and caches) the setup's current map.
func (s *Calibrations) mapFor(ctx context.Context, setupID string) (cameraport.Map, *setup.Setup, *camera.Calibration, error) {
	set, _, err := s.setups.Get(ctx, setupID)
	if err != nil {
		return nil, nil, nil, err
	}
	c, err := s.Current(ctx, setupID)
	if err != nil {
		return nil, nil, nil, err
	}
	if c.MapAsset == nil {
		return nil, nil, nil, app_errors.NotFound("Calibration %s has no map (%s).", c.ID, c.Status)
	}
	s.mu.Lock()
	m := s.maps[c.ID]
	s.mu.Unlock()
	if m == nil {
		b, err := s.assets.Read(ctx, *c.MapAsset)
		if err != nil {
			return nil, nil, nil, err
		}
		if m, err = s.vision.Load(b); err != nil {
			return nil, nil, nil, app_errors.Invalid("The calibration map is unreadable: %v", err)
		}
		s.mu.Lock()
		s.maps[c.ID] = m
		s.mu.Unlock()
	}
	return m, set, c, nil
}

func (s *Calibrations) CameraToScene(ctx context.Context, setupID string, pts []camera.Pt) ([]camera.Pt, error) {
	m, set, _, err := s.mapFor(ctx, setupID)
	if err != nil {
		return nil, err
	}
	out := make([]camera.Pt, len(pts))
	for i, p := range pts {
		if ok, near, found := m.Confident(p.X, p.Y); !ok {
			if found {
				return nil, app_errors.Invalid("Camera point %d (%.0f, %.0f) has no reliable correspondence in the calibration (out of focus, unlit or outside the mapped area). The nearest reliable camera pixel is (%.0f, %.0f): move the point there, or recalibrate with the projector focused on this spot.", i, p.X, p.Y, near.X, near.Y)
			}
			return nil, app_errors.Invalid("Camera point %d (%.0f, %.0f) has no reliable correspondence anywhere near it. Recalibrate with the projector focused on this spot, or mark it as the calibration's region of interest.", i, p.X, p.Y)
		}
		q, ok := m.CamToProj(p.X, p.Y)
		if !ok {
			return nil, app_errors.Invalid("Camera point %d (%.0f, %.0f) is not lit by the projector in the calibration.", i, p.X, p.Y)
		}
		x, y := set.Output.PhysicalToScene(q.X, q.Y)
		out[i] = camera.Pt{X: setup.Round2(x), Y: setup.Round2(y)}
	}
	return out, nil
}

func (s *Calibrations) SceneToCamera(ctx context.Context, setupID string, pts []camera.Pt) ([]camera.Pt, error) {
	m, set, _, err := s.mapFor(ctx, setupID)
	if err != nil {
		return nil, err
	}
	out := make([]camera.Pt, len(pts))
	for i, p := range pts {
		x, y := set.Output.SceneToPhysical(p.X, p.Y)
		q, ok := m.ProjToCam(x, y)
		if !ok {
			q = camera.Pt{X: -1, Y: -1}
		}
		out[i] = q
	}
	return out, nil
}

func (s *Calibrations) Detect(ctx context.Context, setupID string) ([]camera.Candidate, error) {
	m, set, c, err := s.mapFor(ctx, setupID)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	cached, ok := s.cands[c.ID]
	s.mu.Unlock()
	if ok {
		return cached, nil
	}
	cands := s.vision.Detect(m)
	for i := range cands {
		cands[i].Scene = make([]camera.Pt, len(cands[i].Projector))
		for j, p := range cands[i].Projector {
			x, y := set.Output.PhysicalToScene(p.X, p.Y)
			cands[i].Scene[j] = camera.Pt{X: setup.Round2(x), Y: setup.Round2(y)}
		}
	}
	if cands == nil {
		cands = []camera.Candidate{}
	}
	s.mu.Lock()
	s.cands[c.ID] = cands
	s.mu.Unlock()
	return cands, nil
}

// Measure projects the surfaces' outlines over black, captures them, captures the lit object and measures each edge.
func (s *Calibrations) Measure(ctx context.Context, in camerasvc.AlignInput) ([]camera.EdgeError, error) {
	m, set, _, err := s.mapFor(ctx, in.SetupID)
	if err != nil {
		return nil, err
	}
	call := func(method string, args any) error {
		pctx, cancel := context.WithTimeout(ctx, PatternTimeout)
		defer cancel()
		_, err := s.caller.Call(pctx, OutputTarget, method, args)
		return err
	}
	defer func() { _ = call("output.pattern", map[string]any{"kind": "off"}) }()
	if err := call("output.pattern", map[string]any{"kind": "black"}); err != nil {
		return nil, err
	}
	if err := call("output.outline", map[string]any{"surfaceIds": in.SurfaceIDs, "color": "#ffffff", "width": 3, "ms": 6000}); err != nil {
		return nil, err
	}
	lines, err := s.still(ctx)
	if err != nil {
		return nil, err
	}
	if err := call("output.pattern", map[string]any{"kind": "white"}); err != nil {
		return nil, err
	}
	lit, err := s.still(ctx)
	if err != nil {
		return nil, err
	}
	edges := make([][2]camera.Pt, len(in.Edges))
	for i, e := range in.Edges {
		for j := 0; j < 2; j++ {
			x, y := set.Output.SceneToPhysical(e[j].X, e[j].Y)
			edges[i][j] = camera.Pt{X: x, Y: y}
		}
	}
	return s.vision.Align(lines, lit, m, edges), nil
}

func (s *Calibrations) still(ctx context.Context) (image.Image, error) {
	a, err := s.cam.Capture(ctx, "snapshot")
	if err != nil {
		return nil, err
	}
	b, err := s.assets.Read(ctx, a.SHA)
	if err != nil {
		return nil, err
	}
	return DecodeStill(b)
}
