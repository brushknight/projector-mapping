// Package contract checks the wire format: every contract fixture decodes into the Go types and encodes back to the
// same JSON (compared as values), so a drifting struct tag or a renamed field fails here.
package contract

import (
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"testing"

	"projmap/internal/application/ports/out/realtime"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/catalog"
	"projmap/internal/domain/agents"
	"projmap/internal/domain/assets"
	domcatalog "projmap/internal/domain/catalog"
	"projmap/internal/domain/devices"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/setup"
	"projmap/internal/domain/show"
	"projmap/internal/domain/videos"
	"projmap/internal/infrastructure/realtime/hub"
)

func roundTrip(t *testing.T, name string, raw []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("%s: decode: %v", name, err)
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("%s: encode: %v", name, err)
	}
	var a, b any
	_ = json.Unmarshal(raw, &a)
	_ = json.Unmarshal(out, &b)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("%s drifted:\nfixture: %s\nencoded: %s", name, compact(raw), out)
	}
}

func compact(b []byte) string {
	var v any
	_ = json.Unmarshal(b, &v)
	o, _ := json.Marshal(v)
	return string(o)
}

func TestFixtures(t *testing.T) {
	types := map[string]func() any{
		"setup":         func() any { return &setup.Setup{} },
		"scene":         func() any { return &scene.Scene{} },
		"preset":        func() any { return &scene.Preset{} },
		"draft":         func() any { return &scene.Draft{} },
		"device":        func() any { return &devices.Device{} },
		"asset":         func() any { return &assets.Asset{} },
		"agent-session": func() any { return &agents.Session{} },
		"agent-event":   func() any { return &agents.Event{} },
		"effect-glsl":   func() any { return &domcatalog.Effect{} },
		"show":          func() any { return &show.Show{} },
		"sound":         func() any { return &assets.Asset{} },
		"video":         func() any { return &videos.Video{} },
		"import":        func() any { return &videos.ImportJob{} },
		"scene-summary": func() any { return &[]scene.Summary{} },
		"settings":      func() any { return &agents.Settings{} },
	}
	seen := 0
	for _, name := range catalog.Fixtures() {
		raw, err := catalog.Fixture(name)
		if err != nil {
			t.Fatal(err)
		}
		if name == "ws-messages" {
			continue
		}
		mk, ok := types[name]
		if !ok {
			t.Errorf("fixture %s has no Go type in the contract test", name)
			continue
		}
		roundTrip(t, name, raw, mk())
		seen++
	}
	if seen != len(types) {
		t.Fatalf("checked %d of %d fixtures (run make catalog)", seen, len(types))
	}
}

func TestSceneFixtureIsValid(t *testing.T) {
	raw, _ := catalog.Fixture("scene")
	sc, err := scene.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	cat, err := domcatalog.Parse(catalog.JSON)
	if err != nil {
		t.Fatal(err)
	}
	if err := sc.Validate(refs{cat}); err != nil {
		t.Fatalf("the fixture scene fails validation: %v", err)
	}
}

type refs struct{ c *domcatalog.Catalog }

func (r refs) LayerSchema(kind, ref string) (domcatalog.Schema, bool) {
	return r.c.LayerSchema(kind, ref)
}
func (r refs) EffectSchema(id string) (domcatalog.Schema, bool) {
	e := r.c.Effect(id)
	if e == nil {
		return nil, false
	}
	var s domcatalog.Schema
	_ = json.Unmarshal(e.Params, &s)
	return s, true
}

type welcome struct {
	Device         devices.Device `json:"device"`
	ServerTime     int64          `json:"serverTime"`
	Show           show.Show      `json:"show"`
	CatalogVersion int            `json:"catalogVersion"`
}

type ping struct {
	T0 float64 `json:"t0"`
}

type pong struct {
	T0 float64 `json:"t0"`
	TS int64   `json:"ts"`
}

type param struct {
	Path  string `json:"path"`
	Value any    `json:"value"`
	By    string `json:"by,omitempty"`
}

type patched struct {
	Ops []docpatch.Op `json:"ops"`
	By  string        `json:"by"`
}

type codeMsg struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type cmd struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

type rpc struct {
	Method string         `json:"method"`
	Args   map[string]any `json:"args"`
}

func TestWSMessages(t *testing.T) {
	raw, _ := catalog.Fixture("ws-messages")
	var list []json.RawMessage
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	payload := map[string]func() any{
		"hello":      func() any { return &hub.Hello{} },
		"welcome":    func() any { return &welcome{} },
		"ping":       func() any { return &ping{} },
		"pong":       func() any { return &pong{} },
		"param":      func() any { return &param{} },
		"patch":      func() any { return &[]docpatch.Op{} },
		"patched":    func() any { return &patched{} },
		"reject":     func() any { return &codeMsg{} },
		"cmd":        func() any { return &cmd{} },
		"error":      func() any { return &codeMsg{} },
		"rpc":        func() any { return &rpc{} },
		"rpc.result": func() any { return &map[string]any{} },
		"telemetry":  func() any { return &devices.Telemetry{} },
		"sound.play": func() any { return &showsvc.SoundPlay{} },
		"sound.stop": func() any { return &showsvc.SoundStop{} },
		"ack":        func() any { return &showsvc.SoundAck{} },
	}
	// snapshots carry what their channel holds
	snapshots := map[string]func() any{
		"setup":   func() any { return &setup.Setup{} },
		"scene":   func() any { return &scene.Scene{} },
		"show":    func() any { return &show.Show{} },
		"sounds":  func() any { return &[]assets.Asset{} },
		"scenes":  func() any { return &[]scene.Summary{} },
		"videos":  func() any { return &[]videos.Video{} },
		"import":  func() any { return &videos.ImportJob{} },
		"presets": func() any { return &[]scene.Preset{} },
	}
	for i, m := range list {
		var env realtime.Message
		roundTrip(t, "ws-messages envelope", m, &env)
		if len(env.D) == 0 {
			continue
		}
		if env.T == "snapshot" {
			kind, _, _ := strings.Cut(env.Ch, ":")
			mk, ok := snapshots[kind]
			if !ok {
				t.Errorf("snapshot %d on %s has no payload type in the contract test", i, env.Ch)
				continue
			}
			roundTrip(t, "ws-messages snapshot "+env.Ch, env.D, mk())
			continue
		}
		mk, ok := payload[env.T]
		if !ok {
			t.Errorf("message %d (%s) has no payload type in the contract test", i, env.T)
			continue
		}
		roundTrip(t, "ws-messages "+env.T, env.D, mk())
	}
}

// TestSceneRoundTrip decodes scene.json through scene.Decode (defaults, normalize) and encodes it back unchanged.
func TestSceneRoundTrip(t *testing.T) {
	raw, _ := catalog.Fixture("scene")
	sc, err := scene.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	_ = json.Unmarshal(raw, &a)
	_ = json.Unmarshal(sc.Encode(), &b)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("scene.json does not survive Decode/Encode:\nfixture: %s\nencoded: %s", compact(raw), sc.Encode())
	}
	if len(sc.Sounds.Pads) != 2 || sc.Pad("pad_rain") == nil || !sc.Pad("pad_rain").Loop || sc.Timeline.Cues[0].Sound == nil {
		t.Fatalf("sounds did not decode: %+v %+v", sc.Sounds, sc.Timeline.Cues[0])
	}
	// absent sounds decode to no pads, and are written
	old, _ := scene.Decode([]byte(`{"id":"scn_x","setupId":"set_x","name":"x","version":1,"mode":"static","timeline":{"duration":20}}`))
	if old.Sounds.Pads == nil || !strings.Contains(string(old.Encode()), `"sounds":{"pads":[]}`) {
		t.Fatalf("absent sounds: %s", old.Encode())
	}
	// stripped for seeding: no pads, no sound tracks or clips, no cue sounds, no video layers, and still valid
	sc.StripMedia()
	cat, _ := domcatalog.Parse(catalog.JSON)
	if err := sc.Validate(refs{cat}); err != nil {
		t.Fatal(err)
	}
	enc := string(sc.Encode())
	for _, bad := range []string{`"kind":"sound"`, `"effect":"sound"`, `"kind":"video"`, `pad_rain`, `"sound":{`} {
		if strings.Contains(enc, bad) {
			t.Errorf("stripped scene still has %s", bad)
		}
	}
}

func TestCatalogV4(t *testing.T) {
	cat, err := domcatalog.Parse(catalog.JSON)
	if err != nil {
		t.Fatal(err)
	}
	if cat.Version < 6 || len(cat.Gobos) < 45 || cat.StackLight.Kelvin != 5600 || cat.GoboParams["throw"].Type != "number" {
		t.Fatalf("catalog %d: %d gobos, stackLight %+v", cat.Version, len(cat.Gobos), cat.StackLight)
	}
	for _, g := range cat.Gobos {
		gb := cat.Gobo(g.ID)
		if gb == nil || gb.Category == "" || gb.Thumb == "" || gb.Attachment.Scale <= 0 || gb.Focus <= 0 {
			t.Errorf("gobo %s: %+v", g.ID, gb)
		}
		if _, ok := cat.GoboSchema(g.ID); !ok {
			t.Errorf("gobo %s has no schema", g.ID)
		}
		// (catalog 6) every gobo is a metal plate: its metal thumbnail, a reference photo and a round, fill, stretch or
		// tile light field, in one of the catalog's categories
		if gb != nil {
			if gb.MetalThumb != "thumbs/"+g.ID+"-metal.png" || gb.Source == "" || gb.Params["field"].Type != "enum" || gb.Params["field"].Default != "round" {
				t.Errorf("plate %s: %+v", g.ID, gb)
			}
			if !strings.HasPrefix(g.ID, "plate-") || !slices.ContainsFunc(cat.GoboCategories, func(c domcatalog.Named) bool { return c.ID == gb.Category }) {
				t.Errorf("plate %s category %q", g.ID, gb.Category)
			}
		}
	}
	// (catalog 6, §16) the window presets: every window param in a group, the preset's geometry as defaults
	windows := 0
	for _, g := range cat.Gobos {
		gb := cat.Gobo(g.ID)
		if gb.Family != "window" {
			continue
		}
		windows++
		for _, grp := range cat.WindowParamGroups {
			for _, k := range grp.Params {
				if _, ok := gb.Params[k]; !ok {
					t.Errorf("window %s misses %s", g.ID, k)
				}
			}
		}
	}
	if windows != 13 || len(cat.WindowParamGroups) != 6 {
		t.Fatalf("%d window presets, %d groups", windows, len(cat.WindowParamGroups))
	}
	// the merged schema: goboParams, the gobo's own params, the gobo's defaults over goboParams defaults
	s, _ := cat.GoboSchema("plate-arched-window")
	g := cat.Gobo("plate-arched-window")
	if s["cols"].Type != "integer" || s["arch"].Type != "boolean" || s["arch"].Default != true || s["throw"].Type != "number" {
		t.Fatalf("plate-arched-window merged schema %+v", s)
	}
	for k := range cat.GoboParams {
		want := cat.GoboParams[k].Default
		if v, ok := g.Defaults[k]; ok {
			want = v
		}
		if s[k].Default != want {
			t.Errorf("plate-arched-window %s default %v, want %v", k, s[k].Default, want)
		}
	}
	// (§16) every removed gobo maps to a plate that exists
	for _, id := range scene.RemovedGoboIDs() {
		if cat.Gobo(id) != nil || cat.Gobo(scene.PlateFor(id)) == nil {
			t.Errorf("removed %s maps to %s", id, scene.PlateFor(id))
		}
	}
	for _, id := range []string{"hue-cycle", "color-flow", "pulse", "aurora", "kelvin-cycle"} {
		if _, ok := cat.LayerSchema("generator", id); !ok {
			t.Errorf("generator %s", id)
		}
	}
	for _, mp := range cat.MotionPresets {
		var m scene.Motion
		if err := json.Unmarshal(mp.Motion, &m); err != nil || m.Duration < 1 {
			t.Errorf("motion preset %s: %v %+v", mp.ID, err, m)
		}
	}
	for _, k := range cat.SceneKinds {
		if !scene.Kinds[k.ID] || scene.KindMode(k.ID) != k.Mode {
			t.Errorf("scene kind %+v", k)
		}
		if cat.DefaultTemplate(k.ID) == nil {
			t.Errorf("scene kind %s has no template", k.ID)
		}
	}
	if len(cat.MotionEasings) != len(scene.MotionEasings) || len(cat.MotionLoops) != len(scene.MotionLoops) {
		t.Fatalf("motion enums %v %v", cat.MotionEasings, cat.MotionLoops)
	}
}

func TestCatalogV3(t *testing.T) {
	cat, err := domcatalog.Parse(catalog.JSON)
	if err != nil {
		t.Fatal(err)
	}
	if cat.Version < 3 || cat.VideoParams["blur"].Type != "number" || cat.VideoParams["audio"].Type != "boolean" {
		t.Fatalf("catalog %d videoParams %v", cat.Version, cat.VideoParams)
	}
}
