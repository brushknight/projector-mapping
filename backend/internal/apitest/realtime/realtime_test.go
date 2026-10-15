package realtime

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
)

func TestHello(t *testing.T) {
	h := apitest.New(t)
	before := time.Now().UnixNano()
	ws := h.Connect("output", "projector")
	var w struct {
		Device struct {
			ID, Role string
			Online   bool
		}
		ServerTime     int64
		Show           struct{ ActiveSceneID string }
		CatalogVersion int
	}
	ws.Hello.Into(t, &w)
	if w.Device.Role != "output" || !w.Device.Online || w.ServerTime < before || w.Show.ActiveSceneID != "scn_desk" || w.CatalogVersion != 9 {
		t.Fatalf("welcome %s", ws.Hello.D)
	}
	// a LAN client without a token is refused
	lan := http.Header{"X-Forwarded-For": {"192.168.1.20"}}
	r := h.Dial(lan)
	r.Send(apitest.Msg{T: "hello", D: apitest.Data(map[string]any{"role": "remote", "name": "phone"})})
	e := r.Next("error")
	if !strings.Contains(string(e.D), "unauthorized") {
		t.Fatalf("error %s", e.D)
	}
	// with a paired token it works, and the role comes from the device
	code := h.Do("GET", "/api/v1/pair/code", nil).Map(t)["code"]
	tok := h.Remote("POST", "/api/v1/pair", map[string]any{"code": code, "name": "phone", "role": "remote"}, "").Map(t)["token"].(string)
	p := h.Dial(lan)
	p.Send(apitest.Msg{T: "hello", D: apitest.Data(map[string]any{"token": tok, "role": "editor", "name": "phone", "caps": []string{"camera"}})})
	if !strings.Contains(string(p.Next("welcome").D), `"role":"remote"`) {
		t.Fatal("role comes from the paired device")
	}
	// anything before hello is an error
	q := h.Dial(nil)
	q.Send(apitest.Msg{T: "sub", Ch: "show"})
	q.Next("error")
}

func TestPingSubAndErrors(t *testing.T) {
	h := apitest.New(t)
	ws := h.Connect("editor", "editor")
	ws.Send(apitest.Msg{T: "ping", D: apitest.Data(map[string]any{"t0": 1791700000123.5})})
	var pong struct {
		T0 float64 `json:"t0"`
		TS int64   `json:"ts"`
	}
	ws.Next("pong").Into(t, &pong)
	if pong.T0 != 1791700000123.5 || pong.TS < time.Now().Add(-time.Minute).UnixNano() {
		t.Fatalf("pong %+v", pong)
	}
	for _, ch := range []string{"show", "scene:scn_desk", "setup:set_desk", "presets", "devices"} {
		s := ws.Sub(ch)
		if s.V == nil || len(s.D) < 2 {
			t.Fatalf("snapshot %s %+v", ch, s)
		}
	}
	ws.Send(apitest.Msg{T: "sub", Ch: "scene:scn_nope", ID: "x1"})
	if e := ws.Next("error"); e.Re != "x1" || !strings.Contains(string(e.D), "not_found") {
		t.Fatalf("error %+v %s", e, e.D)
	}
	ws.Send(apitest.Msg{T: "dance", ID: "x2"})
	if e := ws.Next("error"); e.Re != "x2" {
		t.Fatalf("error %+v", e)
	}
	out := h.Connect("output", "projector")
	out.Send(apitest.Msg{T: "sub", Ch: "devices", ID: "x3"})
	if e := out.Next("error"); !strings.Contains(string(e.D), "forbidden") {
		t.Fatalf("output sees devices: %s", e.D)
	}
	out.Send(apitest.Msg{T: "cmd", ID: "x4", D: apitest.Data(map[string]any{"name": "show.go"})})
	if e := out.Next("error"); !strings.Contains(string(e.D), "forbidden") {
		t.Fatalf("output sends commands: %s", e.D)
	}
}

func TestParamCoalescing(t *testing.T) {
	h := apitest.New(t)
	ed := h.Connect("editor", "editor")
	ph := h.Connect("remote", "phone")
	ed.Sub("scene:scn_desk")
	ph.Sub("scene:scn_desk")
	path := "/backdrop/static/light/intensity"
	for _, v := range []float64{0.5, 0.55, 0.6, 0.62} {
		ph.Send(apitest.Msg{T: "param", Ch: "scene:scn_desk", D: apitest.Data(map[string]any{"path": path, "value": v})})
	}
	var p struct {
		Path  string  `json:"path"`
		Value float64 `json:"value"`
		By    string  `json:"by"`
	}
	ed.Next("param").Into(t, &p)
	if p.Path != path || p.Value < 0.5 || p.By == "" {
		t.Fatalf("forwarded %+v", p)
	}
	got := ed.NextOn("patched", "scene:scn_desk")
	if *got.V != 2 || !strings.Contains(string(got.D), `"value":0.62`) {
		t.Fatalf("patched v%d %s", *got.V, got.D)
	}
	ed.None(func(m apitest.Msg) bool { return m.T == "patched" }, 400*time.Millisecond, "a second commit")
	ph.None(func(m apitest.Msg) bool { return m.T == "param" }, 50*time.Millisecond, "own param echoed back")
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if sc["version"] != float64(2) {
		t.Fatalf("version %v", sc["version"])
	}
}

func TestPatchAndStale(t *testing.T) {
	h := apitest.New(t)
	ed := h.Connect("editor", "editor")
	ph := h.Connect("remote", "phone")
	ed.Sub("scene:scn_desk")
	ph.Sub("scene:scn_desk")
	add := []any{map[string]any{"op": "add", "path": "/points/-", "value": map[string]any{"id": "p_new", "x": 1, "y": 2}}}
	one := int64(1)
	ed.Send(apitest.Msg{T: "patch", Ch: "scene:scn_desk", ID: "c-77", Base: &one, D: apitest.Data(add)})
	mine := ed.Next("patched")
	if mine.Re != "c-77" || *mine.V != 2 {
		t.Fatalf("patched %+v", mine)
	}
	if theirs := ph.Next("patched"); theirs.Re != "c-77" || !strings.Contains(string(theirs.D), "p_new") {
		t.Fatalf("broadcast %s", theirs.D)
	}
	// the phone is still on version 1: a structural patch is stale
	ph.Send(apitest.Msg{T: "patch", Ch: "scene:scn_desk", ID: "c-78", Base: &one, D: apitest.Data(add)})
	rej := ph.Next("reject")
	if rej.Re != "c-78" || *rej.V != 2 || !strings.Contains(string(rej.D), `"stale"`) {
		t.Fatalf("reject %+v %s", rej, rej.D)
	}
	// a leaf replace on the old base goes through
	ph.Send(apitest.Msg{T: "patch", Ch: "scene:scn_desk", ID: "c-79", Base: &one, D: apitest.Data([]any{map[string]any{"op": "replace", "path": "/name", "value": "Desk 2"}})})
	if p := ph.Next("patched"); p.Re != "c-79" || *p.V != 3 {
		t.Fatalf("leaf %+v", p)
	}
	// an invalid patch is an error, not a reject
	ph.Send(apitest.Msg{T: "patch", Ch: "scene:scn_desk", ID: "c-80", Base: realtime.Ver(3), D: apitest.Data([]any{map[string]any{"op": "remove", "path": "/points/0"}})})
	if e := ph.Next("error"); e.Re != "c-80" || !strings.Contains(string(e.D), "invalid") {
		t.Fatalf("error %s", e.D)
	}
	// setups take patches and params too
	ph.Sub("setup:set_desk")
	ph.Send(apitest.Msg{T: "patch", Ch: "setup:set_desk", ID: "c-81", Base: realtime.Ver(1), D: apitest.Data([]any{map[string]any{"op": "replace", "path": "/testPattern", "value": "grid"}})})
	if p := ph.NextOn("patched", "setup:set_desk"); p.Re != "c-81" || *p.V != 2 {
		t.Fatalf("setup patched %+v", p)
	}
}

func TestCommands(t *testing.T) {
	h := apitest.New(t)
	ph := h.Connect("remote", "phone")
	ph.Sub("show")
	ph.Send(apitest.Msg{T: "cmd", ID: "c-1", D: apitest.Data(map[string]any{"name": "show.go", "args": map[string]any{}})})
	a, s := ph.Both(apitest.Is("ack", ""), func(m apitest.Msg) bool { return m.T == "snapshot" && strings.Contains(string(m.D), `"playing"`) }, "ack and show")
	if a.Re != "c-1" || s.Ch != "show" {
		t.Fatalf("ack %+v", a)
	}
	ph.Send(apitest.Msg{T: "cmd", ID: "c-2", D: apitest.Data(map[string]any{"name": "show.blackout", "args": map[string]any{"on": true}})})
	ph.Both(apitest.Is("ack", ""), func(m apitest.Msg) bool { return m.T == "snapshot" && strings.Contains(string(m.D), `"onAir":false`) }, "blackout")
	ph.Send(apitest.Msg{T: "cmd", ID: "c-3", D: apitest.Data(map[string]any{"name": "setup.testPattern", "args": map[string]any{"pattern": "crosshair"}})})
	ph.Next("ack")
	if h.Do("GET", "/api/v1/setups/set_desk", nil).Map(t)["testPattern"] != "crosshair" {
		t.Fatal("test pattern")
	}
	ph.Send(apitest.Msg{T: "cmd", ID: "c-4", D: apitest.Data(map[string]any{"name": "show.seek", "args": map[string]any{}})})
	if e := ph.Next("error"); e.Re != "c-4" || !strings.Contains(string(e.D), "bad_request") {
		t.Fatalf("error %s", e.D)
	}
	ph.Send(apitest.Msg{T: "cmd", ID: "c-5", D: apitest.Data(map[string]any{"name": "camera.capture", "args": map[string]any{"purpose": "scene"}})})
	if e := ph.Next("error"); e.Re != "c-5" || !strings.Contains(string(e.D), "no_phone") {
		t.Fatalf("no phone %s", e.D)
	}
}

func TestRPC(t *testing.T) {
	h := apitest.New(t)
	ctx := context.Background()
	if _, err := h.App.Hub.Call(ctx, realtime.Target{Role: "output"}, "output.pattern", map[string]any{"kind": "white"}); app_errors.As(err).Code != "unavailable" {
		t.Fatalf("no output: %v", err)
	}
	out := h.Connect("output", "projector")
	out.OnRPC(func(m apitest.Msg) *apitest.Msg {
		if strings.Contains(string(m.D), "output.pattern") {
			return &apitest.Msg{T: "rpc.result", D: apitest.Data(map[string]any{"presented": true, "width": 1920, "height": 1080})}
		}
		if strings.Contains(string(m.D), "render.frame") {
			return &apitest.Msg{T: "rpc.error", D: apitest.Data(map[string]any{"code": "no_gl", "message": "WebGL2 is off"})}
		}
		return nil // output.outline: never answers
	})
	res, err := h.App.Hub.Call(ctx, realtime.Target{Role: "output"}, "output.pattern", map[string]any{"kind": "gray", "axis": "x", "bit": 3, "inverse": false})
	if err != nil || !strings.Contains(string(res), `"presented":true`) {
		t.Fatalf("result %s %v", res, err)
	}
	tctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if _, err := h.App.Hub.Call(tctx, realtime.Target{Role: "output"}, "output.outline", map[string]any{}); app_errors.As(err).Code != "timeout" {
		t.Fatalf("timeout: %v", err)
	}
	if _, err := h.App.Hub.Call(ctx, realtime.Target{Role: "output"}, "render.frame", map[string]any{}); err == nil || !strings.Contains(err.Error(), "WebGL2 is off") {
		t.Fatalf("rpc.error: %v", err)
	}
	if h.App.Hub.Has(realtime.Target{Cap: "render"}) {
		t.Fatal("no client has render")
	}
}

func TestCameraRelayAndTelemetry(t *testing.T) {
	h := apitest.New(t)
	ed := h.Connect("editor", "editor")
	ed.Send(apitest.Msg{T: "sub", Ch: "camera"})
	ed.Sub("devices")
	ph := h.Connect("remote", "phone", "camera")
	jpg := base64.StdEncoding.EncodeToString(apitest.JPEG(64, 48))
	ph.Send(apitest.Msg{T: "camera.status", Ch: "camera", D: apitest.Data(map[string]any{"streaming": true, "fps": 8, "width": 64, "height": 48, "steady": true, "level": 0.5})})
	for i := 1; i <= 3; i++ {
		ph.Send(apitest.Msg{T: "camera.frame", Ch: "camera", D: apitest.Data(map[string]any{"seq": i, "width": 64, "height": 48, "jpeg": jpg})})
	}
	ed.Next("camera.status")
	ed.Next("camera.frame")
	time.Sleep(100 * time.Millisecond)
	st := h.Do("GET", "/api/v1/camera/status", nil).Map(t)
	if st["connected"] != true || st["streaming"] != true || st["width"] != float64(64) {
		t.Fatalf("status %v", st)
	}
	apitest.Expect(t, h.Do("GET", "/api/v1/camera/preview.jpg", nil), http.StatusOK)
	out := h.Connect("output", "projector")
	out.Send(apitest.Msg{T: "telemetry", D: apitest.Data(map[string]any{"fps": 59, "dropped": 2, "width": 1920, "height": 1080, "refresh": 60})})
	ed.NextWhere(func(m apitest.Msg) bool {
		return m.T == "snapshot" && m.Ch == "devices" && strings.Contains(string(m.D), `"telemetry":{"fps":59`)
	}, "telemetry on devices")
}
