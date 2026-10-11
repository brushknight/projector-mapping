package scene

import (
	"encoding/json"
	"testing"
)

func TestUpgradeSplitsTheStack(t *testing.T) {
	legacy := `{"id":"s","setupId":"x","name":"n","version":3,"backdrop":{"layers":[
		{"id":"g","kind":"gradient","ref":"ember","name":"ember","visible":true,"opacity":1,"blend":"normal","light":null,"params":{}},
		{"id":"p","kind":"photo","ref":"flowers","name":"flowers","visible":true,"opacity":1,"blend":"normal","light":null,"params":{}}
	]},"points":[],"objects":[],"timeline":{"duration":20,"tracks":[],"clips":[],"cues":[]}}`
	out, changed, err := Upgrade([]byte(legacy))
	if err != nil || !changed {
		t.Fatalf("upgrade: changed %v, err %v", changed, err)
	}
	sc, err := Decode(out)
	if err != nil {
		t.Fatal(err)
	}
	if sc.Mode != ModeColor || len(sc.Backdrop.Color.Layers) != 1 || len(sc.Backdrop.Scenery.Layers) != 1 || len(sc.Backdrop.Live.Layers) != 0 || len(sc.Backdrop.Static.Layers) != 0 {
		t.Fatalf("upgraded %+v", sc.Backdrop)
	}
	if sc.Underlay != DefaultUnderlay() || sc.Version != 3 {
		t.Fatalf("underlay %+v version %d", sc.Underlay, sc.Version)
	}
	// current documents pass through
	again, changed, err := Upgrade(sc.Encode())
	if err != nil || changed {
		t.Fatalf("second upgrade changed %v (%v)", changed, err)
	}
	var m map[string]any
	if json.Unmarshal(again, &m) != nil || m["mode"] != "color" {
		t.Fatalf("round trip %s", again)
	}
	// Decode of a legacy document without mode works too (loading a scene)
	if s2, err := Decode([]byte(legacy)); err != nil || s2.Mode != ModeColor {
		t.Fatalf("decode legacy: %v %v", s2, err)
	}
}
