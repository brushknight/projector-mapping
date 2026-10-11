package agents

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
)

func TestSettings(t *testing.T) {
	h := apitest.New(t)
	s := h.Do("GET", "/api/v1/settings", nil).Map(t)
	if s["agentMayPreview"] != false || s["agentMayGoLive"] != false {
		t.Fatalf("defaults %v", s)
	}
	s = h.Do("PATCH", "/api/v1/settings", map[string]any{"agentMayPreview": true}).Map(t)
	if s["agentMayPreview"] != true || s["agentMayGoLive"] != false {
		t.Fatalf("patch %v", s)
	}
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/settings", map[string]any{"agentMayGoLive": "yes"}), http.StatusBadRequest, "bad_request")
}

func TestSessions(t *testing.T) {
	h := apitest.New(t)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/agents/sessions", map[string]any{"agent": "gpt", "prompt": "x"}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/agents/sessions", map[string]any{"agent": "codex"}), http.StatusBadRequest, "bad_request")
	h.Runner.Missing = "codex"
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/agents/sessions", map[string]any{"agent": "codex", "prompt": "map it"}), http.StatusServiceUnavailable, "unavailable")
	ws := h.Connect("editor", "editor")
	r := h.Do("POST", "/api/v1/agents/sessions", map[string]any{"agent": "claude", "prompt": "map the zimacube"})
	apitest.Expect(t, r, http.StatusCreated)
	s := r.Map(t)
	id := s["id"].(string)
	if s["status"] != "running" || s["sceneId"] != "scn_desk" || !strings.HasPrefix(s["draftId"].(string), "drf_") {
		t.Fatalf("session %v", s)
	}
	ws.Send(apitest.Msg{T: "sub", Ch: "agent:" + id})
	ws.NextOn("snapshot", "agent:"+id)
	// the fake runner finishes at once: the session ends done
	ws.NextWhere(func(m apitest.Msg) bool {
		return m.T == "session" && m.Ch == "agent:"+id && strings.Contains(string(m.D), `"done"`)
	}, "session done")
	ev := h.Do("GET", "/api/v1/agents/sessions/"+id+"/events", nil).List(t)
	if len(ev) < 3 {
		t.Fatalf("events %v", ev)
	}
	tool := ev[2].(map[string]any)
	if tool["kind"] != "tool" || tool["tool"] != "scene_get" || tool["ok"] != true || tool["seq"] != float64(3) {
		t.Fatalf("tool event %v", tool)
	}
	spec := h.Runner.Specs[0]
	if spec.Token == "" || !strings.HasSuffix(spec.MCPURL, "/mcp") || !strings.Contains(spec.Prompt, "map the zimacube") {
		t.Fatalf("spec %+v", spec)
	}
	// the scoped token dies with the session
	time.Sleep(50 * time.Millisecond)
	apitest.ExpectErr(t, h.Remote("GET", "/api/v1/scenes", nil, spec.Token), http.StatusUnauthorized, "unauthorized")
	if len(h.Do("GET", "/api/v1/agents/sessions", nil).List(t)) != 1 {
		t.Fatal("one session")
	}
	apitest.Expect(t, h.Do("GET", "/api/v1/agents/sessions/"+id, nil), http.StatusOK)
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/agents/sessions/agt_nope", nil), http.StatusNotFound, "not_found")
}

func TestCancel(t *testing.T) {
	h := apitest.New(t)
	h.Runner.Block = true
	s := h.Do("POST", "/api/v1/agents/sessions", map[string]any{"agent": "codex", "prompt": "animate it"}).Map(t)
	c := h.Do("POST", "/api/v1/agents/sessions/"+s["id"].(string)+"/cancel", nil).Map(t)
	if c["status"] != "cancelled" {
		t.Fatalf("cancel %v", c)
	}
	time.Sleep(100 * time.Millisecond)
	if g := h.Do("GET", "/api/v1/agents/sessions/"+s["id"].(string), nil).Map(t); g["status"] != "cancelled" {
		t.Fatalf("after %v", g)
	}
}
