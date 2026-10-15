package mcp

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/apitest"
)

type headerRT struct{ h map[string]string }

func (r headerRT) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	for k, v := range r.h {
		req.Header.Set(k, v)
	}
	return http.DefaultTransport.RoundTrip(req)
}

func connect(t *testing.T, h *apitest.H, headers map[string]string) (*mcp.ClientSession, error) {
	t.Helper()
	c := mcp.NewClient(&mcp.Implementation{Name: "claude-code", Version: "test"}, nil)
	return c.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: h.URL + "/mcp",
		HTTPClient: &http.Client{Transport: headerRT{headers}}}, nil)
}

func call(t *testing.T, s *mcp.ClientSession, name string, args map[string]any) (string, *mcp.CallToolResult) {
	t.Helper()
	r, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	text := ""
	if len(r.Content) > 0 {
		if tc, ok := r.Content[0].(*mcp.TextContent); ok {
			text = tc.Text
		}
	}
	return text, r
}

func TestTools(t *testing.T) {
	h := apitest.New(t)
	if _, err := connect(t, h, map[string]string{"X-Forwarded-For": "192.168.1.20"}); err == nil {
		t.Fatal("a LAN client without a token cannot use MCP")
	}
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	tl, err := s.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"scene_get", "surface_get", "reference_photo_get", "effects_list", "effect_source_get", "timeline_get",
		"camera_stream_status", "output_render", "output_render_strip", "camera_snapshot", "camera_capture", "camera_compare",
		"calibration_run", "calibration_get", "detect_surfaces", "surface_create", "surface_update", "surface_nudge",
		"surface_create_from_camera", "effect_create", "effect_update", "clip_add", "clip_update", "clip_remove", "cue_add",
		"cue_update", "draft_diff", "proposal_submit", "preview_on_projector", "transport", "projector_show", "alignment_error"}
	have := map[string]bool{}
	for _, x := range tl.Tools {
		have[x.Name] = true
	}
	for _, n := range want {
		if !have[n] {
			t.Errorf("missing tool %s", n)
		}
	}
	res, err := s.ListResources(context.Background(), nil)
	if err != nil || len(res.Resources) != 5 {
		t.Fatalf("resources %v %v", res, err)
	}
	pr, err := s.ListPrompts(context.Background(), nil)
	if err != nil || len(pr.Prompts) != 3 {
		t.Fatalf("prompts %v %v", pr, err)
	}
	rr, err := s.ReadResource(context.Background(), &mcp.ReadResourceParams{URI: "docs://effect-api"})
	if err != nil || !strings.Contains(rr.Contents[0].Text, "vec4 effect") {
		t.Fatalf("effect api %v", err)
	}

	text, _ := call(t, s, "scene_get", nil)
	if !strings.Contains(text, "Scene Desk") || !strings.Contains(text, "srf_top") {
		t.Fatalf("scene_get %s", text[:200])
	}
	text, _ = call(t, s, "surface_get", map[string]any{"id": "top"})
	if !strings.Contains(text, `"touches"`) || !strings.Contains(text, "srf_left") {
		t.Fatalf("surface_get %s", text)
	}
	// writes go to a draft
	text, r := call(t, s, "surface_create", map[string]any{"object": "zimacube", "name": "bay 5", "kind": "quad", "parent_id": "srf_right",
		"points": []any{map[string]any{"x": 1000, "y": 650}, map[string]any{"x": 1030, "y": 640}, map[string]any{"x": 1030, "y": 700}, map[string]any{"x": 1000, "y": 710}}})
	if r.IsError {
		t.Fatalf("surface_create %s", text)
	}
	text, r = call(t, s, "clip_add", map[string]any{"target": map[string]any{"kind": "surface", "id": "bay 5"}, "effect": "pulse", "start": 2, "end": 5, "params": map[string]any{"bpm": 90}})
	if r.IsError {
		t.Fatalf("clip_add %s", text)
	}
	_, r = call(t, s, "clip_add", map[string]any{"target": map[string]any{"kind": "all"}, "effect": "nope", "start": 0, "end": 1})
	if !r.IsError {
		t.Fatal("an unknown effect is refused")
	}
	call(t, s, "cue_add", map[string]any{"at": 2, "label": "bay"})
	call(t, s, "surface_nudge", map[string]any{"id": "srf_top", "dx": 1.5, "dy": -1})
	text, _ = call(t, s, "draft_diff", nil)
	if !strings.Contains(text, "adds surface") || !strings.Contains(text, "adds clip") || !strings.Contains(text, "moves 26 points") {
		// the 4 corners of top, and the bays of the faces that share them follow (protocol §1, details follow)
		t.Fatalf("diff %s", text)
	}
	if h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["version"] != float64(1) {
		t.Fatal("MCP writes never touch the live scene")
	}
	// act tools need the toggles
	text, r = call(t, s, "projector_show", map[string]any{"kind": "pattern", "pattern": "white"})
	if !r.IsError || !strings.Contains(text, "agent may preview") {
		t.Fatalf("projector_show %s", text)
	}
	_, r = call(t, s, "transport", map[string]any{"action": "go"})
	if !r.IsError {
		t.Fatal("transport needs agent may go live")
	}
	h.Do("PATCH", "/api/v1/settings", map[string]any{"agentMayGoLive": true})
	text, r = call(t, s, "transport", map[string]any{"action": "go"})
	if r.IsError || !strings.Contains(text, "playing") {
		t.Fatalf("transport %s", text)
	}
	// rendering goes through a render client
	_, r = call(t, s, "output_render", map[string]any{"t": 1})
	if !r.IsError {
		t.Fatal("no render client yet")
	}
	ed := h.Connect("editor", "editor", "render")
	sha := h.Do("POST", "/api/v1/assets", apitest.File("f.png", apitest.PNG(320, 180), map[string]string{"kind": "snapshot"})).Map(t)["sha"]
	ed.OnRPC(func(m apitest.Msg) *apitest.Msg {
		if !strings.Contains(string(m.D), `"draftId":"drf_`) {
			return &apitest.Msg{T: "rpc.error", D: apitest.Data(map[string]string{"message": "expected a draft"})}
		}
		return &apitest.Msg{T: "rpc.result", D: apitest.Data(map[string]any{"sha": sha})}
	})
	text, r = call(t, s, "output_render", map[string]any{"t": 1})
	if r.IsError || len(r.Content) != 2 {
		t.Fatalf("render %s", text)
	}
	if img, ok := r.Content[1].(*mcp.ImageContent); !ok || img.MIMEType != "image/png" || len(img.Data) == 0 {
		t.Fatalf("image %v", r.Content[1])
	}
	_, r = call(t, s, "output_render_strip", map[string]any{"from": 0, "to": 1, "fps": 2})
	if r.IsError {
		t.Fatal("strip")
	}
	text, _ = call(t, s, "proposal_submit", map[string]any{"summary": "a pulsing fifth bay"})
	if !strings.Contains(text, "Proposed") {
		t.Fatalf("proposal %s", text)
	}
	drafts := h.Do("GET", "/api/v1/drafts", nil).List(t)
	d := drafts[0].(map[string]any)
	if d["status"] != "proposed" || d["summary"] != "a pulsing fifth bay" || !strings.HasPrefix(d["author"].(string), "agent:claude#") {
		t.Fatalf("draft %v", d)
	}
	sess := h.Do("GET", "/api/v1/agents/sessions", nil).List(t)[0].(map[string]any)
	if sess["status"] != "done" || sess["draftId"] != d["id"] {
		t.Fatalf("session %v", sess)
	}
	ev := h.Do("GET", "/api/v1/agents/sessions/"+sess["id"].(string)+"/events", nil).List(t)
	if len(ev) < 5 || ev[0].(map[string]any)["tool"] != "surface_create" {
		t.Fatalf("events %v", ev)
	}
	// the draft applies
	apitest.Expect(t, h.Do("POST", "/api/v1/drafts/"+d["id"].(string)+"/apply", nil), http.StatusOK)
	if !strings.Contains(string(h.Do("GET", "/api/v1/scenes/scn_desk", nil).Body), "bay 5") {
		t.Fatal("applied")
	}
}
