package mcp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/apitest"
)

// payload is the JSON after the head line of a tools.JSON result.
func payload(t *testing.T, text string) map[string]any {
	t.Helper()
	i := strings.Index(text, "\n{")
	if i < 0 {
		t.Fatalf("no JSON in %q", text)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(text[i+1:]), &m); err != nil {
		t.Fatalf("json: %v in %s", err, text)
	}
	return m
}

var dumpN int

func imageOf(t *testing.T, r *mcp.CallToolResult) image.Image {
	t.Helper()
	for _, c := range r.Content {
		if ic, ok := c.(*mcp.ImageContent); ok {
			if d := os.Getenv("PROJMAP_DUMP"); d != "" {
				dumpN++
				_ = os.WriteFile(fmt.Sprintf("%s/%s-%d.png", d, t.Name(), dumpN), ic.Data, 0o644)
			}
			img, err := png.Decode(bytes.NewReader(ic.Data))
			if err != nil {
				t.Fatalf("png: %v", err)
			}
			b := img.Bounds()
			if b.Dx() > 1280 || b.Dy() > 1280 {
				t.Fatalf("image %v is larger than 1280", b)
			}
			return img
		}
	}
	t.Fatalf("no image in %v", r.Content)
	return nil
}

func ok(t *testing.T, s *mcp.ClientSession, name string, args map[string]any) string {
	t.Helper()
	text, r := call(t, s, name, args)
	if r.IsError {
		t.Fatalf("%s: %s", name, text)
	}
	return text
}

func fails(t *testing.T, s *mcp.ClientSession, name string, args map[string]any, want string) {
	t.Helper()
	text, r := call(t, s, name, args)
	if !r.IsError || !strings.Contains(text, want) {
		t.Fatalf("%s should fail with %q, got %v %s", name, want, r.IsError, text)
	}
}

func faceByID(t *testing.T, faces []any, id string) map[string]any {
	t.Helper()
	for _, f := range faces {
		if m := f.(map[string]any); m["id"] == id {
			return m
		}
	}
	t.Fatalf("no face %s", id)
	return nil
}

func TestUnfoldAndFaceRead(t *testing.T) {
	h := apitest.New(t)
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	text := ok(t, s, "object_unfold_get", map[string]any{"object_id": "zimacube"})
	m := payload(t, text)
	atlas := m["atlas"].(map[string]any)
	if atlas["width"] != float64(618) || atlas["height"] != float64(609) || atlas["stored"] != true {
		t.Fatalf("atlas %v", atlas)
	}
	faces := m["faces"].([]any)
	if len(faces) != 3 {
		t.Fatalf("faces %d", len(faces))
	}
	right := faceByID(t, faces, "srf_right")
	if r := right["atlas"].(map[string]any); r["x"] != float64(309) || r["rotation"] != float64(0) {
		t.Fatalf("right rect %v", r)
	}
	edges := right["edges"].([]any)
	left := edges[3].(map[string]any)
	if left["side"] != "left" || left["neighbour"].(map[string]any)["surfaceId"] != "srf_left" || left["neighbour"].(map[string]any)["joinedInAtlas"] != true {
		t.Fatalf("right's left edge %v", left)
	}
	top := edges[0].(map[string]any)["neighbour"].(map[string]any)
	if top["surfaceId"] != "srf_top" || top["side"] != "bottom" || top["joinedInAtlas"] != false {
		t.Fatalf("right's top edge %v", top)
	}
	details := right["details"].([]any)
	if len(details) != 4 {
		t.Fatalf("details %v", details)
	}
	for _, d := range details {
		box := d.(map[string]any)["uvBox"].([]any)
		for _, v := range box {
			if f := v.(float64); f < 0 || f > 1 {
				t.Fatalf("bay box %v outside the face", box)
			}
		}
	}
	corners := right["corners"].([]any)
	if c := corners[0].(map[string]any); c["pointId"] != "p_c" || c["uv"].([]any)[0] != float64(0) {
		t.Fatalf("corner 1 %v", c)
	}
	if !strings.Contains(m["conventions"].(string), "FIRST point") {
		t.Fatal("conventions are spelled out")
	}
	leftFace := faceByID(t, faces, "srf_left")
	dl := leftFace["drawingLayers"].([]any)[0].(map[string]any)
	if dl["layerName"] != "sketch" || dl["strokeCount"] != float64(5) || dl["strokes"] != nil {
		t.Fatalf("left drawing %v", dl)
	}
	notIn := m["notInAtlas"].([]any)
	if len(notIn) != 1 || notIn[0].(map[string]any)["id"] != "srf_edges" {
		t.Fatalf("not in atlas %v", notIn)
	}
	fails(t, s, "object_unfold_get", map[string]any{"object_id": "nope"}, "obj_cube")

	text = ok(t, s, "face_get", map[string]any{"surface_id": "zimacube/left"})
	f := payload(t, text)["face"].(map[string]any)
	if f["id"] != "srf_left" || len(f["drawingLayers"].([]any)[0].(map[string]any)["strokes"].([]any)) != 5 {
		t.Fatalf("face_get %v", f)
	}
	if len(f["details"].([]any)) != 1 || f["details"].([]any)[0].(map[string]any)["radiusPx"] == nil {
		t.Fatalf("the fan is a circle detail %v", f["details"])
	}
	fails(t, s, "face_get", map[string]any{"surface_id": "nope"}, "does not exist")

	// templates are drawn by the server
	_, r := call(t, s, "face_template_get", map[string]any{"surface_id": "srf_right"})
	if r.IsError {
		t.Fatal("face template")
	}
	img := imageOf(t, r)
	if b := img.Bounds(); b.Dx() < 600 || b.Dy() < 600 {
		t.Fatalf("face template %v", b)
	}
	_, r = call(t, s, "face_template_get", map[string]any{"object_id": "obj_cube"})
	if r.IsError {
		t.Fatal("object template")
	}
	if b := imageOf(t, r).Bounds(); b.Dx() != 1280 || b.Dy() < 1200 {
		t.Fatalf("unfold template %v", b)
	}
	fails(t, s, "face_template_get", map[string]any{}, "surface_id")
	if pr, err := s.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: "dress-object", Arguments: map[string]string{"objectId": "obj_cube", "device": "ZimaCube"}}); err != nil ||
		!strings.Contains(pr.Messages[0].Content.(*mcp.TextContent).Text, "object_unfold_get(object_id: \"obj_cube\")") {
		t.Fatalf("prompt %v %v", pr, err)
	}
	rr, err := s.ReadResource(context.Background(), &mcp.ReadResourceParams{URI: "docs://drawing"})
	if err != nil || !strings.Contains(rr.Contents[0].Text, "four drive bays") {
		t.Fatalf("docs://drawing %v", err)
	}
}

func TestFaceDrawAndRender(t *testing.T) {
	h := apitest.New(t)
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	bay := func(u0 float64) map[string]any {
		return map[string]any{"tool": "rect", "points": [][]float64{{u0, 0.2}, {u0 + 0.18, 0.95}}, "color": "#d8d8d8", "width": 3}
	}
	// validation
	for want, st := range map[string]map[string]any{
		"is not one of":        {"tool": "spray", "points": [][]float64{{0.1, 0.1}, {0.2, 0.2}}},
		"use pen":              {"tool": "line", "points": [][]float64{{0.1, 0.1}, {0.2, 0.2}, {0.3, 0.3}}},
		"divide by":            {"tool": "rect", "points": [][]float64{{30, 40}, {120, 200}}},
		"#rrggbb":              {"tool": "pen", "points": [][]float64{{0.1, 0.1}, {0.2, 0.2}}, "color": "reddish"},
		"[centre, a point":     {"tool": "circle", "points": [][]float64{{0.1, 0.1}}},
		"without text":         {"tool": "text", "points": [][]float64{{0.1, 0.1}}},
		"would draw nothing":   {"tool": "rect", "points": [][]float64{{0.1, 0.1}, {0.2, 0.2}}, "width": 0},
		"scene px of the face": {"tool": "pen", "points": [][]float64{{0.1, 0.1}, {0.2, 0.2}}, "width": 900},
	} {
		fails(t, s, "face_draw", map[string]any{"surface_id": "srf_right", "strokes": []any{st}}, want)
	}
	fails(t, s, "face_draw", map[string]any{"surface_id": "srf_right", "strokes": []any{bay(0.05)}, "mode": "merge"}, "append or replace")
	fails(t, s, "face_draw", map[string]any{"surface_id": "srf_nope", "strokes": []any{bay(0.05)}}, "does not exist")

	text := ok(t, s, "face_draw", map[string]any{"surface_id": "srf_right", "layer_name": "bays", "strokes": []any{bay(0.05), bay(0.28)}})
	if !strings.Contains(text, `layer "bays" now has 2 strokes`) {
		t.Fatalf("draw %s", text)
	}
	text = ok(t, s, "face_draw", map[string]any{"surface_id": "right", "layer_name": "bays", "strokes": []any{bay(0.51), bay(0.74),
		map[string]any{"tool": "circle", "points": [][]float64{{0.14, 0.9}, {0.15, 0.9}}, "color": "#34C759", "width": 0, "fill": true}}})
	if !strings.Contains(text, "now has 5 strokes") {
		t.Fatalf("append %s", text)
	}
	ok(t, s, "face_draw", map[string]any{"surface_id": "srf_right", "layer_name": "logo", "strokes": []any{
		map[string]any{"tool": "text", "points": [][]float64{{0.3, 0.05}}, "text": "ZIMA", "size": 30, "color": "#fff"},
		map[string]any{"tool": "polygon", "points": [][]float64{{0.1, 0.05}, {0.2, 0.05}, {0.15, 0.13}}, "fill": true, "width": 0}}})
	f := payload(t, ok(t, s, "face_get", map[string]any{"surface_id": "srf_right"}))["face"].(map[string]any)
	layers := f["drawingLayers"].([]any)
	if len(layers) != 2 || layers[0].(map[string]any)["layerName"] != "bays" || layers[1].(map[string]any)["strokeCount"] != float64(2) {
		t.Fatalf("layers %v", layers)
	}
	if c := layers[0].(map[string]any)["strokes"].([]any)[4].(map[string]any)["color"]; c != "#34c759" {
		t.Fatalf("colour normalized %v", c)
	}
	text = ok(t, s, "face_draw", map[string]any{"surface_id": "srf_right", "layer_name": "logo", "mode": "replace", "strokes": []any{
		map[string]any{"tool": "text", "points": [][]float64{{0.3, 0.05}}, "text": "ZIMACUBE", "size": 24}}})
	if !strings.Contains(text, "now has 1 strokes") {
		t.Fatalf("replace %s", text)
	}
	if strings.Contains(string(h.Do("GET", "/api/v1/scenes/scn_desk", nil).Body), `"name":"bays"`) {
		t.Fatal("drawing goes to the draft, never live")
	}

	// no browser: the built-in rasterizer answers and says so
	text, r := call(t, s, "face_render", map[string]any{"surface_id": "srf_right", "with_outline": true})
	if r.IsError || !strings.Contains(text, "built-in") || !strings.Contains(text, "/editor") {
		t.Fatalf("fallback render %s", text)
	}
	img := imageOf(t, r)
	if b := img.Bounds(); b.Dx() != 1024 && b.Dy() != 1024 {
		t.Fatalf("size %v", b)
	}
	// the first bay's outline is drawn in its grey over the fixture's flowers
	b := img.Bounds()
	cr, cg, cb, _ := img.At(int(0.05*float64(b.Dx())), int(0.6*float64(b.Dy()))).RGBA()
	if d := func(v uint32) bool { return v>>8 < 196 || v>>8 > 236 }; d(cr) || d(cg) || d(cb) {
		t.Fatalf("the fallback draws the bays: %d %d %d", cr>>8, cg>>8, cb>>8)
	}
	_, r = call(t, s, "object_unfold_render", map[string]any{"object_id": "obj_cube"})
	if r.IsError {
		t.Fatal("fallback unfold")
	}
	imageOf(t, r)

	// with a browser: render.face goes to it, for the draft, at the face's aspect
	ed := h.Connect("editor", "editor", "render")
	var mu sync.Mutex
	var got []map[string]any
	ed.OnRPC(func(m apitest.Msg) *apitest.Msg {
		var rpc struct {
			Method string         `json:"method"`
			Args   map[string]any `json:"args"`
		}
		_ = json.Unmarshal(m.D, &rpc)
		mu.Lock()
		got = append(got, map[string]any{"method": rpc.Method, "args": rpc.Args})
		mu.Unlock()
		w, hh := int(rpc.Args["width"].(float64)), int(rpc.Args["height"].(float64))
		sha := h.Do("POST", "/api/v1/assets", apitest.File("f.png", apitest.PNG(w, hh), map[string]string{"kind": "snapshot"})).Map(t)["sha"]
		return &apitest.Msg{T: "rpc.result", D: apitest.Data(map[string]any{"sha": sha, "width": w, "height": hh})}
	})
	text = ok(t, s, "face_render", map[string]any{"surface_id": "srf_right", "t": 2})
	if !strings.Contains(text, "browser renderer") || !strings.Contains(text, "your draft") {
		t.Fatalf("client render %s", text)
	}
	ok(t, s, "object_unfold_render", map[string]any{"object_id": "obj_cube"})
	mu.Lock()
	if len(got) != 2 || got[0]["method"] != "render.face" || got[1]["method"] != "render.unfold" {
		t.Fatalf("rpcs %v", got)
	}
	a := got[0]["args"].(map[string]any)
	if a["surfaceId"] != "srf_right" || !strings.HasPrefix(a["draftId"].(string), "drf_") || a["t"] != float64(2) || a["width"] != float64(1024) || a["height"] != float64(994) {
		t.Fatalf("render.face args %v", a)
	}
	if u := got[1]["args"].(map[string]any); u["objectId"] != "obj_cube" || u["width"] != float64(1280) {
		t.Fatalf("render.unfold args %v", u)
	}
	mu.Unlock()

	// clearing
	ok(t, s, "face_drawing_clear", map[string]any{"surface_id": "srf_right", "layer_name": "logo"})
	f = payload(t, ok(t, s, "face_get", map[string]any{"surface_id": "srf_right"}))["face"].(map[string]any)
	if len(f["drawingLayers"].([]any)) != 1 {
		t.Fatalf("after clear %v", f["drawingLayers"])
	}
	if text := ok(t, s, "face_drawing_clear", map[string]any{"surface_id": "srf_right", "layer_name": "logo"}); !strings.Contains(text, "has no drawing layer") {
		t.Fatalf("clear twice %s", text)
	}

	// object_draw: a line across the left and right faces (atlas y 450, x 100 → 500) lands on both
	text = ok(t, s, "object_draw", map[string]any{"object_id": "obj_cube", "layer_name": "seam", "strokes": []any{
		map[string]any{"tool": "line", "points": [][]float64{{100, 450}, {500, 450}}, "color": "#ff3b30", "width": 4}}})
	if !strings.Contains(text, "left: 1") || !strings.Contains(text, "right: 1") || strings.Contains(text, "top: 1") {
		t.Fatalf("object_draw %s", text)
	}
	f = payload(t, ok(t, s, "face_get", map[string]any{"surface_id": "srf_left"}))["face"].(map[string]any)
	var seam map[string]any
	for _, l := range f["drawingLayers"].([]any) {
		if l.(map[string]any)["layerName"] == "seam" {
			seam = l.(map[string]any)
		}
	}
	pts := seam["strokes"].([]any)[0].(map[string]any)["points"].([]any)
	if p0, p1 := pts[0].([]any), pts[1].([]any); p0[0].(float64) > 0.33 || p1[0].(float64) < 1.0 || p0[1].(float64) < 0.46 || p0[1].(float64) > 0.48 {
		t.Fatalf("seam on the left face %v", pts)
	}
	fails(t, s, "object_draw", map[string]any{"object_id": "obj_cube", "strokes": []any{
		map[string]any{"tool": "line", "points": [][]float64{{1000, 1000}, {1100, 1000}}}}}, "No stroke lands")
	ok(t, s, "object_draw", map[string]any{"object_id": "obj_cube", "layer_name": "seam", "mode": "replace", "strokes": []any{
		map[string]any{"tool": "circle", "points": [][]float64{{450, 450}, {460, 450}}, "fill": true, "width": 0}}})
	f = payload(t, ok(t, s, "face_get", map[string]any{"surface_id": "srf_left"}))["face"].(map[string]any)
	for _, l := range f["drawingLayers"].([]any) {
		if l.(map[string]any)["layerName"] == "seam" {
			t.Fatal("replace cleared the seam on the left face, where the circle does not land")
		}
	}

	// draft_apply needs the toggle
	fails(t, s, "draft_apply", map[string]any{"summary": "bays"}, "agent may apply")
	if st := h.Do("GET", "/api/v1/settings", nil).Map(t); st["agentMayApply"] != false {
		t.Fatalf("settings %v", st)
	}
	h.Do("PATCH", "/api/v1/settings", map[string]any{"agentMayApply": true})
	text = ok(t, s, "draft_apply", map[string]any{"summary": "zimacube bays"})
	if !strings.Contains(text, "Applied draft") {
		t.Fatalf("apply %s", text)
	}
	if !strings.Contains(string(h.Do("GET", "/api/v1/scenes/scn_desk", nil).Body), `"name":"bays"`) {
		t.Fatal("the drawing is live")
	}
	// the next write starts a new draft
	ok(t, s, "face_draw", map[string]any{"surface_id": "srf_top", "strokes": []any{bay(0.1)}})
	drafts := h.Do("GET", "/api/v1/drafts", nil).List(t)
	open := 0
	for _, d := range drafts {
		if d.(map[string]any)["status"] == "open" {
			open++
		}
	}
	if open != 1 {
		t.Fatalf("drafts %v", drafts)
	}
	sessions := h.Do("GET", "/api/v1/agents/sessions", nil).List(t)
	if len(sessions) != 2 {
		t.Fatalf("sessions %v", sessions)
	}
	apitest.Expect(t, h.Do("PATCH", "/api/v1/settings", map[string]any{"agentMayApply": "yes"}), http.StatusBadRequest)
}

func TestLayersAndAssets(t *testing.T) {
	h := apitest.New(t)
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	fails(t, s, "asset_upload", map[string]any{}, "data_base64")
	fails(t, s, "asset_upload", map[string]any{"data_base64": "!!!"}, "base64")
	fails(t, s, "asset_upload", map[string]any{"data_base64": base64.StdEncoding.EncodeToString([]byte("hello there"))}, "PNG, JPEG or SVG")
	fails(t, s, "asset_upload", map[string]any{"path": "/etc/hosts"}, "outside your home")
	fails(t, s, "asset_upload", map[string]any{"data_base64": base64.StdEncoding.EncodeToString([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`))}, "viewBox")
	text := ok(t, s, "asset_upload", map[string]any{"data_base64": "data:image/png;base64," + base64.StdEncoding.EncodeToString(apitest.PNG(64, 32))})
	png := payload(t, text)
	if png["mime"] != "image/png" || png["width"] != float64(64) {
		t.Fatalf("png %v", png)
	}
	svg := `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><circle cx="50" cy="50" r="40" stroke-width="3"/></svg>`
	sv := payload(t, ok(t, s, "asset_upload", map[string]any{"data_base64": base64.StdEncoding.EncodeToString([]byte(svg))}))
	if sv["mime"] != "image/svg+xml" || sv["width"] != float64(200) || sv["height"] != float64(100) {
		t.Fatalf("svg %v", sv)
	}
	raw := h.Do("GET", "/a/"+sv["sha"].(string), nil)
	if raw.Header.Get("Content-Type") != "image/svg+xml" || !strings.Contains(raw.Header.Get("Content-Security-Policy"), "sandbox") ||
		!strings.Contains(string(raw.Body), `<svg width="200" height="100"`) || !strings.Contains(string(raw.Body), `stroke-width="3"`) {
		t.Fatalf("served svg %v %s", raw.Header, raw.Body)
	}

	fails(t, s, "layer_add", map[string]any{"target_kind": "surface", "target_id": "srf_right", "kind": "media"}, "needs src")
	fails(t, s, "layer_add", map[string]any{"target_kind": "surface", "target_id": "srf_right", "kind": "media", "src": "asset:" + strings.Repeat("0", 64)}, "asset_upload")
	fails(t, s, "layer_add", map[string]any{"target_kind": "surface", "target_id": "srf_right", "kind": "gradient"}, "needs stops")
	fails(t, s, "layer_add", map[string]any{"target_kind": "surface", "target_id": "srf_edges", "kind": "gradient"}, "lines and masks")
	fails(t, s, "layer_add", map[string]any{"target_kind": "wall", "target_id": "x", "kind": "gradient"}, "surface or object")
	fails(t, s, "layer_add", map[string]any{"target_kind": "surface", "target_id": "srf_right", "kind": "gradient", "opacity": 3,
		"stops": []any{map[string]any{"color": "#000000", "pos": 0}}}, "opacity")
	text = ok(t, s, "layer_add", map[string]any{"target_kind": "surface", "target_id": "srf_right", "kind": "media", "src": sv["sha"], "fit": "fit", "name": "logo"})
	if !strings.Contains(text, "Added media layer cl_") {
		t.Fatalf("layer_add %s", text)
	}
	ok(t, s, "layer_add", map[string]any{"target_kind": "surface", "target_id": "srf_right", "kind": "gradient", "name": "tint",
		"stops": []any{map[string]any{"color": "#101820", "pos": 0}, map[string]any{"color": "#202830", "pos": 1}}, "angle": 90})
	// an object layer on an object without a stored atlas pins the auto layout
	ok(t, s, "layer_add", map[string]any{"target_kind": "object", "target_id": "obj_lamp", "kind": "media", "src": png["src"]})
	f := payload(t, ok(t, s, "face_get", map[string]any{"surface_id": "srf_right"}))["face"].(map[string]any)
	ls := f["layers"].([]any)
	// the fixture's flowers come first
	if len(ls) != 3 || ls[1].(map[string]any)["src"] != "asset:"+sv["sha"].(string) || ls[1].(map[string]any)["fit"] != "fit" {
		t.Fatalf("layers %v", ls)
	}
	id := ls[2].(map[string]any)["id"].(string)
	ok(t, s, "layer_update", map[string]any{"layer_id": id, "opacity": 0.5, "blend": "screen"})
	f = payload(t, ok(t, s, "face_get", map[string]any{"surface_id": "srf_right"}))["face"].(map[string]any)
	if l := f["layers"].([]any)[2].(map[string]any); l["opacity"] != 0.5 || l["blend"] != "screen" || l["name"] != "tint" {
		t.Fatalf("updated %v", l)
	}
	fails(t, s, "layer_update", map[string]any{"layer_id": id, "blend": "glow"}, "blend")
	ok(t, s, "layer_remove", map[string]any{"layer_id": id})
	fails(t, s, "layer_remove", map[string]any{"layer_id": id}, "does not exist")
	// the fallback render draws the gradient-free face with the PNG object layer elsewhere; it still renders
	_, r := call(t, s, "face_render", map[string]any{"surface_id": "srf_lamp"})
	if r.IsError {
		t.Fatal("lamp render")
	}
	d := payload(t, ok(t, s, "object_unfold_get", map[string]any{"object_id": "obj_lamp"}))
	if d["atlas"].(map[string]any)["stored"] != true || len(d["objectLayers"].([]any)) != 1 {
		t.Fatalf("lamp %v", d)
	}
}
