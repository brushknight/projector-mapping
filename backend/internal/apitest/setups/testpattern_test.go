package setups

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
)

// A test pattern turns itself off after its time (60 s by default, `seconds` in the command), and sending it again
// renews it.
func TestTestPatternExpires(t *testing.T) {
	h := apitest.New(t)
	ph := h.Connect("remote", "phone")
	ph.Sub("setup:set_desk")
	before := time.Now().UnixNano()
	ph.Send(apitest.Msg{T: "cmd", ID: "p1", D: apitest.Data(map[string]any{"name": "setup.testPattern", "args": map[string]any{"pattern": "grid"}})})
	var s struct {
		TestPattern      string `json:"testPattern"`
		TestPatternUntil *int64 `json:"testPatternUntil"`
	}
	ph.NextOn("snapshot", "setup:set_desk").Into(t, &s)
	if s.TestPattern != "grid" || s.TestPatternUntil == nil {
		t.Fatalf("grid on: %+v", s)
	}
	if d := time.Duration(*s.TestPatternUntil - before); d < 59*time.Second || d > 61*time.Second {
		t.Fatalf("default deadline is %v away, want 60 s", d)
	}
	// renew with a short time, then watch it turn off by itself
	ph.Send(apitest.Msg{T: "cmd", ID: "p2", D: apitest.Data(map[string]any{"name": "setup.testPattern", "args": map[string]any{"pattern": "grid", "seconds": 1}})})
	ph.NextOn("snapshot", "setup:set_desk").Into(t, &s)
	if s.TestPatternUntil == nil || time.Duration(*s.TestPatternUntil-time.Now().UnixNano()) > 2*time.Second {
		t.Fatalf("renewed for 1 s: %+v", s)
	}
	off := ph.NextWhere(func(m apitest.Msg) bool { return m.T == "patched" && m.Ch == "setup:set_desk" }, "the pattern turning off")
	if !strings.Contains(string(off.D), `"/testPattern"`) || !strings.Contains(string(off.D), `"off"`) || !strings.Contains(string(off.D), `"by":"server"`) {
		t.Fatalf("expiry %s", off.D)
	}
	g := h.Do("GET", "/api/v1/setups/set_desk", nil).Map(t)
	if g["testPattern"] != "off" || g["testPatternUntil"] != nil {
		t.Fatalf("after expiry %v", g)
	}
	// PATCH sets the deadline too; clients cannot set it themselves
	p := h.Do("PATCH", "/api/v1/setups/set_desk", map[string]any{"testPattern": "corners", "testPatternUntil": 1}).Map(t)
	if u, _ := p["testPatternUntil"].(float64); p["testPattern"] != "corners" || u < float64(time.Now().Add(50*time.Second).UnixNano()) {
		t.Fatalf("patch %v", p)
	}
	// a JSON Patch broadcast carries the server's deadline
	ph.Send(apitest.Msg{T: "patch", Ch: "setup:set_desk", ID: "p3", Base: nil, D: apitest.Data([]any{map[string]any{"op": "replace", "path": "/testPattern", "value": "white"}})})
	got := ph.NextWhere(func(m apitest.Msg) bool { return m.T == "patched" && m.Re == "p3" }, "patched p3")
	var pd struct {
		Ops []struct {
			Path  string          `json:"path"`
			Value json.RawMessage `json:"value"`
		} `json:"ops"`
	}
	got.Into(t, &pd)
	if len(pd.Ops) != 2 || pd.Ops[1].Path != "/testPatternUntil" || string(pd.Ops[1].Value) == "null" {
		t.Fatalf("patched ops %s", got.D)
	}
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/setups/set_desk", map[string]any{"testPattern": "plaid"}), http.StatusUnprocessableEntity, "invalid")
}
