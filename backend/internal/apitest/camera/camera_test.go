package camera

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"projmap/internal/apitest"
	"projmap/internal/sim"
)

func TestStillsAndStatus(t *testing.T) {
	h := apitest.New(t)
	st := h.Do("GET", "/api/v1/camera/status", nil).Map(t)
	if st["connected"] != false {
		t.Fatalf("status %v", st)
	}
	r := h.Do("POST", "/api/v1/camera/stills?request=cap_none", apitest.File("s.jpg", apitest.JPEG(64, 48), nil))
	apitest.Expect(t, r, http.StatusCreated)
	if r.Map(t)["kind"] != "snapshot" {
		t.Fatalf("still %s", r.Body)
	}
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/camera/preview.jpg", nil), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/calibrations", map[string]any{}), http.StatusServiceUnavailable, "unavailable")
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/calibrations/cal_nope", nil), http.StatusNotFound, "not_found")
}

// TestCalibrationWithSim runs the whole Gray-code pass against the fake phone and output.
func TestCalibrationWithSim(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	h := apitest.New(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = sim.Run(ctx, sim.Options{URL: h.URL, Output: true, FPS: 4, CamW: 800, CamH: 600, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	}()
	for i := 0; i < 50 && h.Do("GET", "/api/v1/camera/status", nil).Map(t)["streaming"] != true; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	r := h.Do("GET", "/api/v1/camera/preview.jpg", nil)
	apitest.Expect(t, r, http.StatusOK)
	ws := h.Connect("editor", "editor")
	r = h.Do("POST", "/api/v1/calibrations", map[string]any{"setupId": "set_desk"})
	apitest.Expect(t, r, http.StatusCreated)
	id := r.Map(t)["id"].(string)
	ws.Sub("calib:" + id)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/calibrations", map[string]any{}), http.StatusConflict, "conflict")
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
	q := cal["quality"].(map[string]any)
	if q["coverage"].(float64) < 0.9 || q["errorPx"].(float64) > 1.5 {
		t.Fatalf("quality %v", q)
	}
	if h.Do("GET", "/api/v1/setups/set_desk", nil).Map(t)["calibrationId"] != id {
		t.Fatal("the setup points at the new calibration")
	}
	ws.NextWhere(func(m apitest.Msg) bool { return m.Ch == "calib:"+id && m.T == "snapshot" }, "progress")
	cands := h.Do("GET", "/api/v1/calibrations/"+id+"/candidates", nil).List(t)
	if len(cands) < 3 {
		t.Fatalf("%d candidates", len(cands))
	}
}
