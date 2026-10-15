package camera

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"projmap/internal/apitest"
	"projmap/internal/application/services/camera/camerasvc"
	"projmap/internal/sim"
)

// fakeOutput is a /out that records output.pattern and reports a 1920×1080 canvas.
type fakeOutput struct {
	mu       sync.Mutex
	patterns []string
}

func (f *fakeOutput) last() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.patterns) == 0 {
		return ""
	}
	return f.patterns[len(f.patterns)-1]
}

func connectOutput(t *testing.T, h *apitest.H) (*fakeOutput, *apitest.WS) {
	f := &fakeOutput{}
	ws := h.Connect("output", "projector output")
	ws.OnRPC(func(m apitest.Msg) *apitest.Msg {
		var rq struct {
			Method string         `json:"method"`
			Args   map[string]any `json:"args"`
		}
		_ = json.Unmarshal(m.D, &rq)
		if rq.Method == "output.pattern" {
			k, _ := rq.Args["kind"].(string)
			f.mu.Lock()
			f.patterns = append(f.patterns, k)
			f.mu.Unlock()
		}
		return &apitest.Msg{T: "rpc.result", D: apitest.Data(map[string]any{"presented": true, "width": 1920, "height": 1080})}
	})
	ws.Send(apitest.Msg{T: "telemetry", D: apitest.Data(map[string]any{"fps": 60, "dropped": 0, "width": 1920, "height": 1080, "refresh": 60})})
	return f, ws
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if ok() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// TestPreflightAimAndStreaming walks the auto map setup screen against the real hub: the pre-flight blocks without an
// output and a preview, the sim phone's frames make the server report streaming (measured, not taken from the phone's
// word), calibration.aim projects white on a fake output and takes it down, and POST /calibrations is a 409 with a
// fix-it message while no output is connected.
func TestPreflightAimAndStreaming(t *testing.T) {
	h := apitest.New(t)

	pf := h.Do("GET", "/api/v1/camera/preflight", nil).Map(t)
	if pf["ready"] != false || pf["server"].(map[string]any)["ok"] != true {
		t.Fatalf("preflight %v", pf)
	}
	out := pf["output"].(map[string]any)
	if out["ok"] != false || !strings.Contains(out["fix"].(string), "projmap open --out") {
		t.Fatalf("output check %v", out)
	}

	// the phone: the sim camera only (no sim output)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = sim.Run(ctx, sim.Options{URL: h.URL, Output: false, FPS: 8, CamW: 640, CamH: 480, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	}()
	waitFor(t, "streaming", func() bool {
		st := h.Do("GET", "/api/v1/camera/status", nil).Map(t)
		return st["streaming"] == true && st["fps"].(float64) >= 2
	})
	st := h.Do("GET", "/api/v1/camera/status", nil).Map(t)
	if st["fps"].(float64) < 2 || st["width"].(float64) == 0 {
		t.Fatalf("status %v", st)
	}

	// no output yet: calibration and aim answer 409 no_output
	e := apitest.ExpectErr(t, h.Do("POST", "/api/v1/calibrations", map[string]any{"setupId": "set_desk"}), http.StatusConflict, "no_output")
	if !strings.Contains(e["message"].(string), "No projector output") {
		t.Fatalf("message %v", e)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/calibrations/aim", map[string]any{"on": true}), http.StatusConflict, "no_output")
	pf = h.Do("GET", "/api/v1/camera/preflight", nil).Map(t)
	if pf["ready"] != false || pf["camera"].(map[string]any)["ok"] != true || pf["reason"] == "" {
		t.Fatalf("preflight with phone only %v", pf)
	}

	// the output connects: ready, and calibration.aim (WebSocket cmd) projects white
	f, _ := connectOutput(t, h)
	waitFor(t, "ready", func() bool { return h.Do("GET", "/api/v1/camera/preflight", nil).Map(t)["ready"] == true })
	pf = h.Do("GET", "/api/v1/camera/preflight", nil).Map(t)
	out = pf["output"].(map[string]any)
	if out["width"].(float64) != 1920 || out["height"].(float64) != 1080 || out["connected"] != true {
		t.Fatalf("output %v", out)
	}
	ed := h.Connect("remote", "phone ui")
	ed.Send(apitest.Msg{T: "cmd", ID: "c1", D: apitest.Data(map[string]any{"name": "calibration.aim", "args": map[string]any{"on": true}})})
	ack := ed.NextWhere(func(m apitest.Msg) bool { return m.Re == "c1" }, "aim ack")
	if ack.T != "ack" {
		t.Fatalf("aim answered %s %s", ack.T, ack.D)
	}
	if f.last() != "white" {
		t.Fatalf("patterns %v", f.patterns)
	}
	if h.Do("GET", "/api/v1/camera/preflight", nil).Map(t)["aiming"] != true {
		t.Fatal("preflight says aiming")
	}
	ed.Send(apitest.Msg{T: "cmd", ID: "c2", D: apitest.Data(map[string]any{"name": "calibration.aim", "args": map[string]any{"on": false}})})
	ed.NextWhere(func(m apitest.Msg) bool { return m.Re == "c2" && m.T == "ack" }, "aim off ack")
	if f.last() != "off" {
		t.Fatalf("patterns %v", f.patterns)
	}

	// the light check flashes white, black, white; the sim camera does not see this fake output: "none"
	camerasvc.LightCheckSettle = 200 * time.Millisecond
	n := len(f.patterns)
	lc := h.Do("POST", "/api/v1/calibrations/lightcheck", nil).Map(t)
	if lc["level"] != "none" || !strings.Contains(lc["message"].(string), "does not see the projector") {
		t.Fatalf("light check %v", lc)
	}
	f.mu.Lock()
	got := strings.Join(f.patterns[n:], ",")
	f.mu.Unlock()
	if got != "white,black,white" {
		t.Fatalf("light check patterns %s", got)
	}
	if pf := h.Do("GET", "/api/v1/camera/preflight", nil).Map(t); pf["light"] == nil {
		t.Fatal("preflight carries the last light check")
	}

	// the phone stops streaming: the server notices from the frames, whatever the phone said
	cancel()
	waitFor(t, "not streaming", func() bool { return h.Do("GET", "/api/v1/camera/status", nil).Map(t)["streaming"] == false })
}

// TestAvailableAgents lists the agent CLIs.
func TestAvailableAgents(t *testing.T) {
	h := apitest.New(t)
	l := h.Do("GET", "/api/v1/agents/available", nil).List(t)
	if len(l) != 2 {
		t.Fatalf("available %v", l)
	}
}

// TestCalibrationROIWithSim limits a calibration to the middle of the scene: the server keeps the ROI, sends it to the
// output with every pattern and reports the quality inside it plus a confidence and a difference image.
func TestCalibrationROIWithSim(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	h := apitest.New(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = sim.Run(ctx, sim.Options{URL: h.URL, Output: true, FPS: 4, CamW: 800, CamH: 600, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	}()
	waitFor(t, "ready", func() bool { return h.Do("GET", "/api/v1/camera/preflight", nil).Map(t)["ready"] == true })
	set := h.Do("GET", "/api/v1/setups/set_desk", nil).Map(t)
	sw, sh := set["output"].(map[string]any)["width"].(float64), set["output"].(map[string]any)["height"].(float64)
	roi := map[string]any{"x": sw * 0.25, "y": sh * 0.25, "w": sw * 0.5, "h": sh * 0.5}
	r := h.Do("POST", "/api/v1/calibrations", map[string]any{"setupId": "set_desk", "roi": roi, "cameraRoi": map[string]any{"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8}})
	apitest.Expect(t, r, http.StatusCreated)
	id := r.Map(t)["id"].(string)
	var cal map[string]any
	for i := 0; i < 1500; i++ {
		cal = h.Do("GET", "/api/v1/calibrations/"+id, nil).Map(t)
		if cal["status"] != "running" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if cal["status"] != "done" {
		t.Fatalf("calibration %v", cal)
	}
	if cal["projectorRoi"] == nil || cal["roi"] == nil || cal["cameraRoi"] == nil || cal["confidenceAsset"] == nil || cal["diffAsset"] == nil {
		t.Fatalf("calibration %v", cal)
	}
	q := cal["quality"].(map[string]any)
	rq := q["roi"].(map[string]any)
	if rq["sharp"].(float64) < 0.7 || rq["errorPx"].(float64) > 1.5 || q["contrast"] == nil {
		t.Fatalf("quality %v", q)
	}
	if !strings.Contains(cal["message"].(string), "Sharp area mapped") {
		t.Fatalf("message %v", cal["message"])
	}
}

// TestCalibrationLearnsTheProjectorLag: the projector shows each pattern 400 ms after the output says "presented"
// and the server starts with no settle delay, so every still would show the previous pattern. The server notices
// (black looks like white, stripes that do not change), waits longer, and the pass decodes.
func TestCalibrationLearnsTheProjectorLag(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	h := apitest.New(t) // SettleDelay = 0
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = sim.Run(ctx, sim.Options{URL: h.URL, Output: true, FPS: 4, CamW: 800, CamH: 600, ShowDelay: 400 * time.Millisecond,
			Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	}()
	waitFor(t, "ready", func() bool { return h.Do("GET", "/api/v1/camera/preflight", nil).Map(t)["ready"] == true })
	r := h.Do("POST", "/api/v1/calibrations", map[string]any{"setupId": "set_desk"})
	apitest.Expect(t, r, http.StatusCreated)
	id := r.Map(t)["id"].(string)
	var cal map[string]any
	for i := 0; i < 1500; i++ {
		cal = h.Do("GET", "/api/v1/calibrations/"+id, nil).Map(t)
		if cal["status"] != "running" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if cal["status"] != "done" {
		t.Fatalf("calibration %v", cal)
	}
	if ms, _ := cal["settleMs"].(float64); ms < 400 {
		t.Fatalf("learned settle %v ms", cal["settleMs"])
	}
	q := cal["quality"].(map[string]any)
	if q["coverage"].(float64) < 0.9 || q["errorPx"].(float64) > 1.5 {
		t.Fatalf("quality %v", q)
	}
}
