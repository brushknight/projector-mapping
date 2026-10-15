package scenes

import (
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
)

type fpoint struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

type fscene struct {
	Version int64    `json:"version"`
	Points  []fpoint `json:"points"`
}

func getScene(t *testing.T, h *apitest.H, id string) fscene {
	t.Helper()
	var s fscene
	h.Do("GET", "/api/v1/scenes/"+id, nil).Into(t, &s)
	return s
}

func (s fscene) at(id string) (int, fpoint) {
	for i, p := range s.Points {
		if p.ID == id {
			return i, p
		}
	}
	return -1, fpoint{}
}

// addCube adds a face (fa..fd, 100 px square at x0,y0) with a bay detail (ba..bd) inside it and a second face that
// shares nothing, to scene id.
func addCube(t *testing.T, h *apitest.H, id, pre string, x0, y0 float64) {
	t.Helper()
	pt := func(n string, x, y float64) map[string]any {
		return map[string]any{"op": "add", "path": "/points/-", "value": map[string]any{"id": pre + n, "x": x, "y": y}}
	}
	parent := pre + "face"
	surface := func(sid, role string, ids []string, par any) map[string]any {
		return map[string]any{"id": sid, "name": sid, "kind": "quad", "role": role, "pointIds": ids, "parentId": par, "visible": true,
			"mesh": nil, "effects": []any{}, "opacity": 1, "softEdge": 0}
	}
	ids := func(ns ...string) []string {
		for i := range ns {
			ns[i] = pre + ns[i]
		}
		return ns
	}
	ops := []any{
		pt("fa", x0, y0), pt("fb", x0+100, y0), pt("fc", x0+100, y0+100), pt("fd", x0, y0+100),
		pt("ba", x0+20, y0+20), pt("bb", x0+40, y0+20), pt("bc", x0+40, y0+40), pt("bd", x0+20, y0+40),
		map[string]any{"op": "add", "path": "/objects/-", "value": map[string]any{"id": pre + "obj", "name": pre + "cube", "tags": []any{}, "visible": true,
			"surfaces": []any{
				surface(parent, "face", ids("fa", "fb", "fc", "fd"), nil),
				surface(pre+"bay", "detail", ids("ba", "bb", "bc", "bd"), parent),
			}}},
	}
	v := getScene(t, h, id).Version
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/"+id+"/patch", map[string]any{"base": v, "ops": ops}), 200)
}

func near(a, b float64) bool { return math.Abs(a-b) < 0.02 }

// Bug: detail surfaces stayed put when their face was remapped. A patch that moves a face's corners moves its bay's
// points by the face's homography, in the same commit.
func TestDetailFollowsFaceOnPatch(t *testing.T) {
	h := apitest.New(t)
	addCube(t, h, "scn_desk", "t_", 1000, 500)
	s := getScene(t, h, "scn_desk")
	var ops []any
	// the whole face doubles in size from its top-left corner
	for n, xy := range map[string][2]float64{"t_fb": {1200, 500}, "t_fc": {1200, 700}, "t_fd": {1000, 700}} {
		i, _ := s.at(n)
		ops = append(ops, map[string]any{"op": "replace", "path": fmt.Sprintf("/points/%d/x", i), "value": xy[0]},
			map[string]any{"op": "replace", "path": fmt.Sprintf("/points/%d/y", i), "value": xy[1]})
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": s.Version, "ops": ops}), 200)
	after := getScene(t, h, "scn_desk")
	if after.Version != s.Version+1 {
		t.Fatalf("one commit, got v%d after v%d", after.Version, s.Version)
	}
	for n, w := range map[string][2]float64{"t_ba": {1040, 540}, "t_bb": {1080, 540}, "t_bc": {1080, 580}, "t_bd": {1040, 580}} {
		if _, p := after.at(n); !near(p.X, w[0]) || !near(p.Y, w[1]) {
			t.Fatalf("%s at (%v, %v), want %v", n, p.X, p.Y, w)
		}
	}
	// undo puts the face and the bay back in one step
	apitest.Expect(t, h.Do("POST", "/api/v1/scenes/scn_desk/undo", nil), 200)
	back := getScene(t, h, "scn_desk")
	if _, p := back.at("t_ba"); p.X != 1020 || p.Y != 520 {
		t.Fatalf("undo left the bay at %+v", p)
	}
	if _, p := back.at("t_fc"); p.X != 1100 || p.Y != 600 {
		t.Fatalf("undo left the face at %+v", p)
	}
}

// Dragging a corner sends params; the bay follows live (derived params to everyone, the sender too) and the commit
// stores the followed bay.
func TestDetailFollowsFaceWhileDragging(t *testing.T) {
	h := apitest.New(t)
	addCube(t, h, "scn_desk", "t_", 1000, 500)
	ed := h.Connect("editor", "editor")
	ph := h.Connect("remote", "phone")
	ed.Sub("scene:scn_desk")
	ph.Sub("scene:scn_desk")
	s := getScene(t, h, "scn_desk")
	// move every corner by +30 x one after another, as a whole-face drag does
	for _, n := range []string{"t_fa", "t_fb", "t_fc", "t_fd"} {
		i, p := s.at(n)
		ed.Send(apitest.Msg{T: "param", Ch: "scene:scn_desk", D: apitest.Data(map[string]any{"path": fmt.Sprintf("/points/%d/x", i), "value": p.X + 30, "pointId": n})})
	}
	bi, _ := s.at("t_ba")
	want := fmt.Sprintf("/points/%d/x", bi)
	live := func(m apitest.Msg) bool {
		return m.T == "param" && strings.Contains(string(m.D), `"path":"`+want+`"`) && strings.Contains(string(m.D), `"value":1050`)
	}
	ph.NextWhere(live, "the bay's live x on the phone")
	ed.NextWhere(live, "the bay's live x back on the sender")
	time.Sleep(450 * time.Millisecond)
	after := getScene(t, h, "scn_desk")
	for n, w := range map[string]float64{"t_ba": 1050, "t_bb": 1070, "t_bc": 1070, "t_bd": 1050, "t_fa": 1030, "t_fc": 1130} {
		if _, p := after.at(n); !near(p.X, w) {
			t.Fatalf("%s x %v, want %v", n, p.X, w)
		}
	}
	if _, p := after.at("t_bc"); !near(p.Y, 540) {
		t.Fatalf("t_bc y %v", p.Y)
	}
}

// Bug: editing one scene moved corners in another. Two scenes with the same ids (a duplicate): drags in A, then in
// B, change only the points that were dragged, in the scene they were sent to.
func TestTwoScenesDragOnlyWhereIntended(t *testing.T) {
	h := apitest.New(t)
	addCube(t, h, "scn_desk", "t_", 1000, 500)
	dup := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "desk copy", "duplicate": "scn_desk"}).Map(t)
	b := dup["id"].(string)
	ed := h.Connect("editor", "editor")
	a0, b0 := getScene(t, h, "scn_desk"), getScene(t, h, b)
	drag := func(sc string, s fscene, n string, dx float64) {
		i, p := s.at(n)
		ed.Send(apitest.Msg{T: "param", Ch: "scene:" + sc, D: apitest.Data(map[string]any{"path": fmt.Sprintf("/points/%d/x", i), "value": p.X + dx, "pointId": n})})
	}
	ed.Sub("scene:scn_desk")
	drag("scn_desk", a0, "t_fb", 10)
	ed.Send(apitest.Msg{T: "unsub", Ch: "scene:scn_desk"})
	ed.Sub("scene:" + b)
	drag(b, b0, "t_fd", -7)
	time.Sleep(450 * time.Millisecond)
	a1, b1 := getScene(t, h, "scn_desk"), getScene(t, h, b)
	changed := func(x, y fscene) map[string]bool {
		out := map[string]bool{}
		for _, p := range y.Points {
			if _, q := x.at(p.ID); q.X != p.X || q.Y != p.Y {
				out[p.ID] = true
			}
		}
		return out
	}
	ca, cb := changed(a0, a1), changed(b0, b1)
	if !ca["t_fb"] || ca["t_fd"] || !cb["t_fd"] || cb["t_fb"] {
		t.Fatalf("A changed %v, B changed %v", ca, cb)
	}
	for id := range ca {
		if id != "t_fb" && !strings.HasPrefix(id, "t_b") {
			t.Fatalf("A: %s moved", id)
		}
	}
	for id := range cb {
		if id != "t_fd" && !strings.HasPrefix(id, "t_b") {
			t.Fatalf("B: %s moved", id)
		}
	}
}

// A param whose index names another point than the sender expected is refused, and nothing moves.
func TestPointParamMismatchIsRefused(t *testing.T) {
	h := apitest.New(t)
	addCube(t, h, "scn_desk", "t_", 1000, 500)
	ed := h.Connect("editor", "editor")
	ed.Sub("scene:scn_desk")
	s := getScene(t, h, "scn_desk")
	i, _ := s.at("t_fa")
	ed.Send(apitest.Msg{T: "param", Ch: "scene:scn_desk", ID: "p1", D: apitest.Data(map[string]any{"path": fmt.Sprintf("/points/%d/x", i), "value": 5, "pointId": "t_fb"})})
	e, _ := ed.Both(func(m apitest.Msg) bool { return m.T == "error" }, apitest.Is("snapshot", "scene:scn_desk"), "the refusal and a fresh snapshot")
	if !strings.Contains(string(e.D), "mismatch") {
		t.Fatalf("error %s", e.D)
	}
	time.Sleep(300 * time.Millisecond)
	if after := getScene(t, h, "scn_desk"); after.Version != s.Version {
		t.Fatalf("the scene changed: v%d → v%d", s.Version, after.Version)
	}
	// a patch guarded by a test of the point id is stale when the id does not match
	one := s.Version
	ed.Send(apitest.Msg{T: "patch", Ch: "scene:scn_desk", ID: "c-1", Base: &one, D: apitest.Data([]any{
		map[string]any{"op": "test", "path": fmt.Sprintf("/points/%d/id", i), "value": "t_fb"},
		map[string]any{"op": "replace", "path": fmt.Sprintf("/points/%d/x", i), "value": 5},
	})})
	if r := ed.Next("reject"); r.Re != "c-1" {
		t.Fatalf("reject %+v", r)
	}
}

// A drag's last value lands before a structural patch that follows it at once (the magnet weld removes a point):
// it must not shift onto the next point in the list.
func TestPendingParamLandsBeforeAWeld(t *testing.T) {
	h := apitest.New(t)
	addCube(t, h, "scn_desk", "t_", 1000, 500)
	ed := h.Connect("editor", "editor")
	ed.Sub("scene:scn_desk")
	s := getScene(t, h, "scn_desk")
	ia, _ := s.at("t_fa")
	ib, pb := s.at("t_fb")
	// drag fb, then remove fa (lower index) before the 200 ms commit
	ed.Send(apitest.Msg{T: "param", Ch: "scene:scn_desk", D: apitest.Data(map[string]any{"path": fmt.Sprintf("/points/%d/x", ib), "value": pb.X + 9, "pointId": "t_fb"})})
	v := s.Version
	ed.Send(apitest.Msg{T: "patch", Ch: "scene:scn_desk", ID: "c-2", Base: &v, D: apitest.Data([]any{
		map[string]any{"op": "replace", "path": "/objects/" + fmt.Sprint(len(objectsOf(t, h))-1) + "/surfaces/0/pointIds/0", "value": "t_fb"},
		map[string]any{"op": "remove", "path": fmt.Sprintf("/points/%d", ia)},
	})})
	ed.NextWhere(func(m apitest.Msg) bool { return m.T == "patched" && m.Re == "c-2" }, "the weld")
	time.Sleep(350 * time.Millisecond)
	after := getScene(t, h, "scn_desk")
	if _, p := after.at("t_fb"); p.X != pb.X+9 {
		t.Fatalf("t_fb x %v, want %v", p.X, pb.X+9)
	}
	if _, p := after.at("t_fc"); p.X != 1100 {
		t.Fatalf("t_fc moved to %v", p.X)
	}
}

func objectsOf(t *testing.T, h *apitest.H) []any {
	t.Helper()
	return h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["objects"].([]any)
}
