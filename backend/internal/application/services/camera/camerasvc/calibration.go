package camerasvc

import (
	"context"
	"fmt"
	"image"
	"log/slog"
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

	mu       sync.Mutex
	running  string
	progress map[string]*camera.Progress
	maps     map[string]cameraport.Map
	cands    map[string][]camera.Candidate
}

var _ camerasvc.CalibrationService = (*Calibrations)(nil)

// NewCalibrations makes the calibration service.
func NewCalibrations(repo camerarepo.CalibrationRepository, setups setupssvc.SetupService, cam *Camera, as assetssvc.AssetService,
	v cameraport.Vision, caller realtime.Caller, pub realtime.Publisher, log *slog.Logger) *Calibrations {
	return &Calibrations{repo: repo, setups: setups, cam: cam, assets: as, vision: v, caller: caller, pub: pub, log: log,
		progress: map[string]*camera.Progress{}, maps: map[string]cameraport.Map{}, cands: map[string][]camera.Candidate{}}
}

func (s *Calibrations) report(id string, p camera.Progress) {
	s.mu.Lock()
	s.progress[id] = &p
	s.mu.Unlock()
	s.pub.Publish(CalibChannel(id), realtime.Message{T: "snapshot", Ch: CalibChannel(id), V: realtime.Ver(int64(p.Done)), D: realtime.Data(p)})
}

func (s *Calibrations) Start(ctx context.Context, setupID string) (*camera.Calibration, error) {
	set, _, err := s.setups.Get(ctx, setupID)
	if err != nil {
		return nil, err
	}
	if !s.caller.Has(OutputTarget) {
		return nil, app_errors.Unavailable("No projector output is connected. Open /out on the projector first.")
	}
	if !s.caller.Has(CameraTarget) {
		return nil, app_errors.Unavailable("No phone with a camera is connected. Put the phone on its stand and open auto map.")
	}
	s.mu.Lock()
	if s.running != "" {
		id := s.running
		s.mu.Unlock()
		return nil, app_errors.Conflict("Calibration %s is still running.", id)
	}
	c := &camera.Calibration{ID: services.NewID("cal"), SetupID: setupID, Status: camera.CalRunning, Message: "starting",
		ProjW: set.Output.Width, ProjH: set.Output.Height, CreatedAt: time.Now().UTC()}
	s.running = c.ID
	s.mu.Unlock()
	if err := s.repo.Save(ctx, c); err != nil {
		s.mu.Lock()
		s.running = ""
		s.mu.Unlock()
		return nil, err
	}
	bx, by := s.vision.Bits(set.Output.Width), s.vision.Bits(set.Output.Height)
	s.report(c.ID, camera.Progress{Step: "start", Done: 0, Total: 2 + 2*(bx+by), Message: "Locking the camera"})
	go s.run(c, set)
	return c, nil
}

type step struct {
	name string
	args map[string]any
}

func (s *Calibrations) steps(set *setup.Setup) []step {
	out := []step{{"white", map[string]any{"kind": "white"}}, {"black", map[string]any{"kind": "black"}}}
	for _, ax := range []struct {
		axis string
		n    int
	}{{"x", set.Output.Width}, {"y", set.Output.Height}} {
		for bit := 0; bit < s.vision.Bits(ax.n); bit++ {
			for _, inv := range []bool{false, true} {
				out = append(out, step{fmt.Sprintf("%s%d%s", ax.axis, bit, map[bool]string{true: "i", false: ""}[inv]),
					map[string]any{"kind": "gray", "axis": ax.axis, "bit": bit, "inverse": inv}})
			}
		}
	}
	return out
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
	for i, st := range steps {
		s.report(c.ID, camera.Progress{Step: st.name, Done: i, Total: len(steps), Message: fmt.Sprintf("Pattern %d of %d", i+1, len(steps))})
		pctx, pcancel := context.WithTimeout(ctx, PatternTimeout)
		_, err := s.caller.Call(pctx, OutputTarget, "output.pattern", st.args)
		pcancel()
		if err != nil {
			fail(err)
			return
		}
		a, err := s.cam.Capture(ctx, "calibration")
		if err != nil {
			fail(err)
			return
		}
		b, err := s.assets.Read(ctx, a.SHA)
		if err != nil {
			fail(err)
			return
		}
		img, err := DecodeStill(b)
		if err != nil {
			fail(err)
			return
		}
		shots[st.name] = img
		if st.name == "white" {
			sha := a.SHA
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
	m, q, err := s.vision.Decode(f, set.Output.Width, set.Output.Height)
	if err != nil {
		fail(app_errors.Invalid("Decoding failed: %v. Dim the room, check the phone sees the whole projection and run it again.", err))
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
	c.CameraW, c.CameraH = m.CameraSize()
	c.Status, c.Message = camera.CalDone, fmt.Sprintf("Calibrated: %.0f%% coverage, %.2f px error", q.Coverage*100, q.ErrorPx)
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
