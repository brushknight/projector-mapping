package scenes

import (
	"net/http"
	"testing"

	"projmap/internal/apitest"
)

// Content layers, atlases and layer tracks (protocol §12): valid ones go in, each kind of mistake is refused.
func TestContentLayers(t *testing.T) {
	h := apitest.New(t)
	ver := 1
	patch := func(ops ...map[string]any) *apitest.Resp {
		t.Helper()
		r := h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": ver, "ops": ops})
		if r.Status == http.StatusOK {
			ver = int(r.Map(t)["version"].(float64))
		}
		return r
	}
	ok := func(what string, ops ...map[string]any) {
		t.Helper()
		if r := patch(ops...); r.Status != http.StatusOK {
			t.Fatalf("%s: status %d: %s", what, r.Status, r.Body)
		}
	}
	bad := func(what string, ops ...map[string]any) {
		t.Helper()
		if r := patch(ops...); r.Status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: status %d, want 422: %s", what, r.Status, r.Body)
		}
	}

	// the seeded scene (the fixture) already has a surface layer, an object layer, an atlas and a layer track
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	cube := sc["objects"].([]any)[0].(map[string]any)
	if cube["atlas"] == nil || len(cube["layers"].([]any)) != 1 {
		t.Fatalf("seeded cube %v", cube)
	}
	if _, has := sc["objects"].([]any)[2].(map[string]any)["layers"]; has {
		t.Fatal("an object without layers carries no layers key")
	}

	// a media surface layer on the shelf; missing common fields take their defaults
	ok("first surface layer", op("add", "/objects/2/surfaces/0/layers", []any{map[string]any{
		"id": "cl_shelf", "kind": "media", "name": "forest", "src": "forest", "media": "image", "fit": "fit"}}))
	ok("second surface layer", op("add", "/objects/2/surfaces/0/layers/-", map[string]any{
		"id": "cl_shelf_video", "kind": "media", "name": "clip", "src": "asset:0123abcd", "media": "video", "fit": "stretch",
		"blend": "add", "opacity": 0.5, "x": -0.5, "y": 0.25, "scale": 2, "rotation": 45, "reveal": 0.3, "revealAngle": 90,
		"crop": map[string]any{"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.8}}))
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	shelf := sc["objects"].([]any)[2].(map[string]any)
	l0 := shelf["surfaces"].([]any)[0].(map[string]any)["layers"].([]any)[0].(map[string]any)
	if l0["visible"] != true || l0["opacity"] != 1.0 || l0["blend"] != "normal" || l0["scale"] != 1.0 || l0["reveal"] != 1.0 ||
		l0["x"] != 0.0 || l0["rotation"] != 0.0 || l0["revealAngle"] != 0.0 {
		t.Fatalf("defaults %v", l0)
	}
	if _, has := l0["stops"]; has {
		t.Fatalf("a media layer carries no gradient fields: %v", l0)
	}

	// an object gradient layer with an atlas
	ok("object layer and atlas",
		op("add", "/objects/2/atlas", map[string]any{"width": 360, "height": 290, "faces": map[string]any{
			"srf_shelf": map[string]any{"x": 0, "y": 0, "w": 360, "h": 290, "rotation": 0}}}),
		op("add", "/objects/2/layers", []any{map[string]any{
			"id": "cl_shelf_grad", "kind": "gradient", "name": "band", "blend": "screen",
			"stops": []any{map[string]any{"color": "#000000", "pos": 0}, map[string]any{"color": "#ff3b30", "pos": 1}},
			"angle": 0, "offset": 0, "repeat": false}}))
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	g := sc["objects"].([]any)[2].(map[string]any)["layers"].([]any)[0].(map[string]any)
	if g["angle"] != 0.0 || g["offset"] != 0.0 || g["repeat"] != false {
		t.Fatalf("explicit zero gradient fields are kept: %v", g)
	}

	// a layer track with reveal and sweep clips
	ok("layer track", op("add", "/timeline/tracks/-", map[string]any{"id": "trk_shelf_grad", "name": "band",
		"target": map[string]any{"kind": "layer", "id": "cl_shelf_grad"}}),
		op("add", "/timeline/clips/-", map[string]any{"id": "clp_band", "trackId": "trk_shelf_grad", "effect": "sweep",
			"start": 0, "end": 2, "fadeIn": 0, "fadeOut": 0, "params": map[string]any{"from": -1, "to": 1}}),
		op("add", "/timeline/clips/-", map[string]any{"id": "clp_band_in", "trackId": "trk_shelf_grad", "effect": "reveal",
			"start": 2, "end": 3, "fadeIn": 0, "fadeOut": 0, "params": map[string]any{}}))

	media := func(id string, over map[string]any) map[string]any {
		l := map[string]any{"id": id, "kind": "media", "name": "x", "src": "forest", "media": "image", "fit": "fill"}
		for k, v := range over {
			l[k] = v
		}
		return l
	}
	const shelfLayers = "/objects/2/surfaces/0/layers/-"
	bad("bad fit", op("add", shelfLayers, media("cl_x", map[string]any{"fit": "cover"})))
	bad("bad blend", op("add", shelfLayers, media("cl_x", map[string]any{"blend": "overlay"})))
	bad("bad media", op("add", shelfLayers, media("cl_x", map[string]any{"media": "gif"})))
	bad("unknown scenery", op("add", shelfLayers, media("cl_x", map[string]any{"src": "moonbase"})))
	bad("no src", op("add", shelfLayers, media("cl_x", map[string]any{"src": ""})))
	bad("empty asset", op("add", shelfLayers, media("cl_x", map[string]any{"src": "asset:"})))
	bad("bad crop", op("add", shelfLayers, media("cl_x", map[string]any{"crop": map[string]any{"x": 0, "y": 0, "w": 0, "h": 1}})))
	bad("bad kind", op("add", shelfLayers, media("cl_x", map[string]any{"kind": "video"})))
	bad("opacity", op("add", shelfLayers, media("cl_x", map[string]any{"opacity": 1.5})))
	bad("scale", op("add", shelfLayers, media("cl_x", map[string]any{"scale": 0})))
	bad("x", op("add", shelfLayers, media("cl_x", map[string]any{"x": 11})))
	bad("reveal", op("add", shelfLayers, media("cl_x", map[string]any{"reveal": -0.1})))
	bad("duplicate content layer id", op("add", shelfLayers, media("cl_flowers", nil)))
	bad("duplicate across object and surface", op("add", shelfLayers, media("cl_sweep", nil)))
	bad("gradient without stops", op("add", "/objects/2/layers/-", map[string]any{"id": "cl_g", "kind": "gradient", "name": "g"}))
	bad("gradient bad colour", op("add", "/objects/2/layers/-", map[string]any{"id": "cl_g", "kind": "gradient", "name": "g",
		"stops": []any{map[string]any{"color": "red", "pos": 0}}}))
	bad("gradient offset", op("add", "/objects/2/layers/-", map[string]any{"id": "cl_g", "kind": "gradient", "name": "g",
		"stops": []any{map[string]any{"color": "#ffffff", "pos": 0}}, "offset": 12}))
	bad("atlas rotation", op("replace", "/objects/2/atlas/faces/srf_shelf/rotation", 45))
	bad("atlas face of another object", op("add", "/objects/2/atlas/faces/srf_top", map[string]any{"x": 0, "y": 0, "w": 10, "h": 10, "rotation": 0}))
	bad("atlas zero rect", op("replace", "/objects/2/atlas/faces/srf_shelf/w", 0))
	bad("atlas size", op("replace", "/objects/2/atlas/width", 20000))
	bad("layer track to a missing layer", op("add", "/timeline/tracks/-", map[string]any{"id": "trk_x", "name": "x",
		"target": map[string]any{"kind": "layer", "id": "cl_nope"}}))
	bad("removing a layer a track targets", op("remove", "/objects/2/layers/0", nil))
	clip := func(id, track, effect string, params map[string]any) map[string]any {
		return map[string]any{"id": id, "trackId": track, "effect": effect, "start": 4, "end": 5, "fadeIn": 0, "fadeOut": 0, "params": params}
	}
	bad("sweep on a surface track", op("add", "/timeline/clips/-", clip("clp_x", "trk_edges", "sweep", map[string]any{})))
	bad("trace on a layer track", op("add", "/timeline/clips/-", clip("clp_x", "trk_shelf_grad", "trace", map[string]any{})))
	bad("unknown layer clip param", op("add", "/timeline/clips/-", clip("clp_x", "trk_shelf_grad", "sweep", map[string]any{"speed": 1})))
	bad("non-number layer clip param", op("add", "/timeline/clips/-", clip("clp_x", "trk_shelf_grad", "reveal", map[string]any{"from": "0"})))
	bad("reveal out of range", op("add", "/timeline/clips/-", clip("clp_x", "trk_shelf_grad", "reveal", map[string]any{"to": 2})))

	// removing the last layer leaves no layers key behind
	ok("remove track", op("remove", "/timeline/clips/12", nil), op("remove", "/timeline/clips/11", nil), op("remove", "/timeline/tracks/9", nil))
	ok("remove object layer", op("remove", "/objects/2/layers/0", nil))
	sc = h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if _, has := sc["objects"].([]any)[2].(map[string]any)["layers"]; has {
		t.Fatal("an emptied layers list is omitted")
	}
}
