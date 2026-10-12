package show

import (
	"net/http"
	"testing"
	"time"

	"projmap/internal/apitest"
)

type solo struct {
	SurfaceIDs []string `json:"surfaceIds"`
	Fill       string   `json:"fill"`
	Until      int64    `json:"until"`
}

type soloState struct {
	Solo    *solo `json:"solo"`
	Version int64 `json:"version"`
	Preview *struct {
		DraftID string `json:"draftId"`
	} `json:"preview"`
	Transport transport `json:"transport"`
}

func soloDo(t *testing.T, h *apitest.H, body any) soloState {
	t.Helper()
	r := h.Do("POST", "/api/v1/show/solo", body)
	apitest.Expect(t, r, http.StatusOK)
	var s soloState
	r.Into(t, &s)
	return s
}

func near(t *testing.T, what string, until int64, want time.Duration) {
	t.Helper()
	if d := time.Duration(until - time.Now().UnixNano()); d < want-2*time.Second || d > want+time.Second {
		t.Fatalf("%s: until is %v away, want %v", what, d, want)
	}
}

// show.solo sets, renews and clears solo; the server clears it by itself at until and broadcasts the show.
func TestSolo(t *testing.T) {
	h := apitest.New(t)
	s := soloDo(t, h, map[string]any{"surfaceIds": []string{"srf_top", "srf_left"}})
	if s.Solo == nil || s.Solo.Fill != "content" || len(s.Solo.SurfaceIDs) != 2 || s.Solo.SurfaceIDs[0] != "srf_top" {
		t.Fatalf("solo %+v", s.Solo)
	}
	near(t, "default", s.Solo.Until, 60*time.Second)
	s = soloDo(t, h, map[string]any{"surfaceIds": []string{"srf_right"}, "fill": "grid", "seconds": 120})
	if s.Solo == nil || s.Solo.Fill != "grid" || len(s.Solo.SurfaceIDs) != 1 {
		t.Fatalf("renewed %+v", s.Solo)
	}
	near(t, "renewed", s.Solo.Until, 120*time.Second)
	if s = soloDo(t, h, map[string]any{"surfaceIds": []string{}}); s.Solo != nil {
		t.Fatalf("[] clears solo: %+v", s.Solo)
	}
	if r := h.Do("GET", "/api/v1/show", nil); r.Map(t)["solo"] != nil {
		t.Fatalf("cleared show %s", r.Body)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/solo", map[string]any{"surfaceIds": []string{"srf_top"}, "fill": "red"}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/solo", map[string]any{"surfaceIds": []string{"srf_top"}, "seconds": 0}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/solo", map[string]any{"surfaceIds": []string{"srf_top"}, "seconds": 601}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/solo", map[string]any{}), http.StatusBadRequest, "bad_request")

	// over the WebSocket, with a short time: the server turns it off and broadcasts
	ws := h.Connect("remote", "phone")
	ws.Sub("show")
	ws.Send(apitest.Msg{T: "cmd", ID: "s1", D: apitest.Data(map[string]any{"name": "show.solo",
		"args": map[string]any{"surfaceIds": []string{"srf_top"}, "fill": "white", "seconds": 1}})})
	var on soloState
	ws.NextWhere(func(m apitest.Msg) bool {
		var st soloState
		_ = jsonInto(m, &st)
		return m.T == "snapshot" && m.Ch == "show" && st.Solo != nil && st.Solo.Fill == "white"
	}, "solo on").Into(t, &on)
	near(t, "1 s", on.Solo.Until, time.Second)
	ws.NextWhere(func(m apitest.Msg) bool {
		var st soloState
		_ = jsonInto(m, &st)
		return m.T == "snapshot" && m.Ch == "show" && st.Solo == nil && st.Version > on.Version
	}, "solo expiring")
	var got soloState
	h.Do("GET", "/api/v1/show", nil).Into(t, &got)
	if got.Solo != nil {
		t.Fatalf("after expiry %+v", got.Solo)
	}

	// a renewed solo outlives the old deadline
	soloDo(t, h, map[string]any{"surfaceIds": []string{"srf_top"}, "seconds": 1})
	soloDo(t, h, map[string]any{"surfaceIds": []string{"srf_top"}, "seconds": 30})
	time.Sleep(1300 * time.Millisecond)
	var renewed soloState
	h.Do("GET", "/api/v1/show", nil).Into(t, &renewed)
	if renewed.Solo == nil {
		t.Fatal("the old timer cleared a renewed solo")
	}
	near(t, "after renewal", renewed.Solo.Until, 29*time.Second)

	// transport keeps working next to a solo
	do(t, h, "seek", map[string]any{"t": 3.8})
	do(t, h, "play", nil)
	ws.NextWhere(func(m apitest.Msg) bool {
		var st soloState
		_ = jsonInto(m, &st)
		return m.T == "snapshot" && m.Ch == "show" && st.Transport.State == "paused" && st.Transport.Offset == 4 && st.Solo != nil
	}, "hold at cue 2 with solo on")
}

// A restart keeps a running solo and drops one that ran out.
func TestSoloRestart(t *testing.T) {
	h := apitest.New(t)
	s := soloDo(t, h, map[string]any{"surfaceIds": []string{"srf_top"}, "seconds": 30})
	h.Restart(nil)
	var got soloState
	h.Do("GET", "/api/v1/show", nil).Into(t, &got)
	if got.Solo == nil || got.Solo.Until != s.Solo.Until {
		t.Fatalf("kept solo %+v", got.Solo)
	}
	soloDo(t, h, map[string]any{"surfaceIds": []string{"srf_top"}, "seconds": 1})
	h.Restart(func(string) { time.Sleep(1200 * time.Millisecond) })
	var after soloState
	h.Do("GET", "/api/v1/show", nil).Into(t, &after)
	if after.Solo != nil {
		t.Fatalf("an expired solo survives a restart: %+v", after.Solo)
	}
}

// show.preview plays a draft on the wall from t; an empty draftId ends it.
func TestPreviewCommand(t *testing.T) {
	h := apitest.New(t)
	r := h.Do("POST", "/api/v1/drafts", map[string]any{"sceneId": "scn_desk"})
	apitest.Expect(t, r, http.StatusCreated)
	id := r.Map(t)["id"].(string)
	ws := h.Connect("editor", "editor")
	ws.Sub("show")
	ws.Send(apitest.Msg{T: "cmd", ID: "p1", D: apitest.Data(map[string]any{"name": "show.preview",
		"args": map[string]any{"draftId": id, "t": 2.5, "play": false}})})
	var st soloState
	ws.NextWhere(func(m apitest.Msg) bool {
		var s soloState
		_ = jsonInto(m, &s)
		return m.T == "snapshot" && m.Ch == "show" && s.Preview != nil
	}, "preview on").Into(t, &st)
	if st.Preview.DraftID != id || st.Transport.State != "paused" || st.Transport.Offset != 2.5 {
		t.Fatalf("preview %+v", st)
	}
	r = h.Do("POST", "/api/v1/show/preview", map[string]any{"draftId": id, "t": 1, "play": true})
	apitest.Expect(t, r, http.StatusOK)
	r.Into(t, &st)
	if st.Preview == nil || st.Transport.State != "playing" || st.Transport.Offset != 1 {
		t.Fatalf("preview playing %+v", st)
	}
	ws.Send(apitest.Msg{T: "cmd", ID: "p2", D: apitest.Data(map[string]any{"name": "show.preview", "args": map[string]any{"draftId": ""}})})
	ws.NextWhere(func(m apitest.Msg) bool {
		var s soloState
		_ = jsonInto(m, &s)
		return m.T == "snapshot" && m.Ch == "show" && s.Preview == nil && s.Transport.State == "stopped"
	}, "preview off")
}
