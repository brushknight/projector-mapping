package show

import (
	"math"
	"net/http"
	"testing"
	"time"

	"projmap/internal/apitest"
)

type transport struct {
	State     string  `json:"state"`
	StartedAt int64   `json:"startedAt"`
	Offset    float64 `json:"offset"`
	Cue       int     `json:"cue"`
}

type showState struct {
	ActiveSceneID string    `json:"activeSceneId"`
	OnAir         bool      `json:"onAir"`
	Transport     transport `json:"transport"`
	Version       int64     `json:"version"`
}

func do(t *testing.T, h *apitest.H, action string, body any) showState {
	t.Helper()
	r := h.Do("POST", "/api/v1/show/"+action, body)
	apitest.Expect(t, r, http.StatusOK)
	var s showState
	r.Into(t, &s)
	return s
}

func TestTransport(t *testing.T) {
	h := apitest.New(t)
	var s showState
	h.Do("GET", "/api/v1/show", nil).Into(t, &s)
	if s.ActiveSceneID != "scn_desk" || !s.OnAir || s.Transport.State != "stopped" {
		t.Fatalf("initial %+v", s)
	}
	before := time.Now().UnixNano()
	s = do(t, h, "go", nil)
	if s.Transport.State != "playing" || s.Transport.Cue != 0 || s.Transport.Offset != 0 || s.Transport.StartedAt < before {
		t.Fatalf("first go %+v", s)
	}
	s = do(t, h, "go", nil)
	if s.Transport.Cue != 1 || s.Transport.Offset != 4 {
		t.Fatalf("second go %+v", s)
	}
	s = do(t, h, "back", nil)
	if s.Transport.Cue != 0 || s.Transport.Offset != 0 || s.Transport.State != "playing" {
		t.Fatalf("back %+v", s)
	}
	s = do(t, h, "pause", nil)
	if s.Transport.State != "paused" || s.Transport.Offset < 0 || s.Transport.Offset > 1 {
		t.Fatalf("pause %+v", s)
	}
	s = do(t, h, "seek", map[string]any{"t": 6.5})
	if s.Transport.Offset != 6.5 || s.Transport.Cue != 2 || s.Transport.State != "paused" {
		t.Fatalf("seek %+v", s)
	}
	s = do(t, h, "play", nil)
	if s.Transport.State != "playing" || s.Transport.Offset != 6.5 {
		t.Fatalf("play %+v", s)
	}
	s = do(t, h, "stop", nil)
	if s.Transport.State != "stopped" || s.Transport.Offset != 0 || s.Transport.Cue != 0 {
		t.Fatalf("stop %+v", s)
	}
	s = do(t, h, "blackout", map[string]any{"on": true})
	if s.OnAir {
		t.Fatal("blackout takes the show off air")
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/blackout", map[string]any{}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/seek", map[string]any{}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/dance", nil), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/activate", map[string]any{"sceneId": "scn_nope"}), http.StatusNotFound, "not_found")
	// a scene without cues: GO plays, the next GO has nowhere to go
	id := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "Empty"}).Map(t)["id"].(string)
	s = do(t, h, "activate", map[string]any{"sceneId": id})
	if s.ActiveSceneID != id || s.Transport.State != "stopped" {
		t.Fatalf("activate %+v", s)
	}
	do(t, h, "go", nil)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/go", nil), http.StatusConflict, "no_cue")
}

func TestHoldAtCue(t *testing.T) {
	h := apitest.New(t)
	ws := h.Connect("remote", "phone")
	ws.Sub("show")
	do(t, h, "seek", map[string]any{"t": 3.8})
	do(t, h, "play", nil)
	m := ws.NextWhere(func(m apitest.Msg) bool {
		var s showState
		_ = jsonInto(m, &s)
		return m.T == "snapshot" && m.Ch == "show" && s.Transport.State == "paused" && s.Transport.Offset == 4
	}, "hold at cue 2")
	var s showState
	_ = jsonInto(m, &s)
	if s.Transport.Cue != 0 {
		t.Fatalf("held %+v", s)
	}
	s = do(t, h, "go", nil)
	if s.Transport.Cue != 1 || s.Transport.Offset != 4 || s.Transport.State != "playing" {
		t.Fatalf("go from hold %+v", s)
	}
	// make cue 3 auto-follow: playback runs through it and the cue index advances
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": 1, "ops": []any{
		map[string]any{"op": "replace", "path": "/timeline/cues/2/autoFollow", "value": true}}}), http.StatusOK)
	do(t, h, "seek", map[string]any{"t": 5.85})
	ws.NextWhere(func(m apitest.Msg) bool {
		var s showState
		_ = jsonInto(m, &s)
		return m.T == "snapshot" && m.Ch == "show" && s.Transport.State == "playing" && s.Transport.Cue == 2
	}, "follow through cue 3")
	var now showState
	h.Do("GET", "/api/v1/show", nil).Into(t, &now)
	ph := now.Transport.Offset + float64(time.Now().UnixNano()-now.Transport.StartedAt)/1e9
	if math.Abs(ph-6) > 0.5 {
		t.Fatalf("playhead %.2f", ph)
	}
}
