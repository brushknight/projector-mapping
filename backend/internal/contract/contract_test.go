// Package contract checks the wire format: every contract fixture decodes into the Go types and encodes back to the
// same JSON (compared as values), so a drifting struct tag or a renamed field fails here.
package contract

import (
	"encoding/json"
	"reflect"
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

func TestCatalogV3(t *testing.T) {
	cat, err := domcatalog.Parse(catalog.JSON)
	if err != nil {
		t.Fatal(err)
	}
	if cat.Version < 3 || cat.VideoParams["blur"].Type != "number" || cat.VideoParams["audio"].Type != "boolean" {
		t.Fatalf("catalog %d videoParams %v", cat.Version, cat.VideoParams)
	}
}
