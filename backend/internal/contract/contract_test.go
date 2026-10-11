// Package contract checks the wire format: every contract fixture decodes into the Go types and encodes back to the
// same JSON (compared as values), so a drifting struct tag or a renamed field fails here.
package contract

import (
	"encoding/json"
	"reflect"
	"testing"

	"projmap/internal/application/ports/out/realtime"
	"projmap/internal/catalog"
	"projmap/internal/domain/agents"
	"projmap/internal/domain/assets"
	domcatalog "projmap/internal/domain/catalog"
	"projmap/internal/domain/devices"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/setup"
	"projmap/internal/domain/show"
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
		"snapshot":   func() any { return &setup.Setup{} },
		"param":      func() any { return &param{} },
		"patch":      func() any { return &[]docpatch.Op{} },
		"patched":    func() any { return &patched{} },
		"reject":     func() any { return &codeMsg{} },
		"cmd":        func() any { return &cmd{} },
		"error":      func() any { return &codeMsg{} },
		"rpc":        func() any { return &rpc{} },
		"rpc.result": func() any { return &map[string]any{} },
		"telemetry":  func() any { return &devices.Telemetry{} },
	}
	for i, m := range list {
		var env realtime.Message
		roundTrip(t, "ws-messages envelope", m, &env)
		if len(env.D) == 0 {
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
