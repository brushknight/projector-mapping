package scene

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestMigrateEveryRemovedGobo moves an attachment of every removed gobo to its plate: the scene validates, the
// placement stays, the wall params stay, the old shape params go, and each move has a note.
func TestMigrateEveryRemovedGobo(t *testing.T) {
	refs := refsT(t)
	s := New("scn_m", "set_m", "m")
	s.Normalize()
	for i, id := range RemovedGoboIDs() {
		s.Backdrop.Static.Attachments = append(s.Backdrop.Static.Attachments, Attachment{ID: "att_" + id, Gobo: id, Visible: true, Opacity: 0.7,
			Rotation: float64(i), Scale: 1.5, Params: map[string]any{"throw": 0.3, "density": 0.9, "seed": 4.0, "cols": 3.0, "slats": 30.0, "field": "nope"}})
	}
	notes := MigrateGobos(ModeStatic, &s.Backdrop.Static)
	if len(notes) != len(RemovedGobos) || !strings.Contains(strings.Join(notes, "\n"), "static attachment att_window-4: window-4 → plate-grid-window") {
		t.Fatalf("notes %v", notes)
	}
	for i, a := range s.Backdrop.Static.Attachments {
		if refs.c.Gobo(a.Gobo) == nil || a.Rotation != float64(i) || a.Scale != 1.5 || a.Opacity != 0.7 || a.Params["throw"] != 0.3 {
			t.Errorf("%s: %+v", a.ID, a)
		}
		for _, gone := range []string{"density", "seed", "field"} {
			if _, ok := a.Params[gone]; ok {
				t.Errorf("%s keeps %s", a.ID, gone)
			}
		}
	}
	if err := s.Validate(refs); err != nil {
		t.Fatalf("migrated scene is invalid: %v", err)
	}
	// the windows keep their panes, blinds their slats
	byID := map[string]Attachment{}
	for _, a := range s.Backdrop.Static.Attachments {
		byID[a.ID] = a
	}
	if w := byID["att_window"]; w.Gobo != "plate-grid-window" || w.Params["cols"] != 3.0 || w.Params["rows"] != 3.0 || w.Params["sashes"] != 1.0 {
		t.Fatalf("window %+v", w)
	}
	if b := byID["att_vertical-blinds"]; b.Gobo != "plate-slat-blinds" || b.Params["slats"] != 30.0 || b.Params["vertical"] != true {
		t.Fatalf("vertical blinds %+v", b)
	}
	if d := byID["att_french-doors"]; d.Params["sashes"] != 2.0 || d.Params["cols"] != 2.0 {
		t.Fatalf("french doors %+v", d)
	}
	// a second pass moves nothing
	if again := MigrateGobos(ModeStatic, &s.Backdrop.Static); len(again) != 0 {
		t.Fatalf("second pass %v", again)
	}
}

// TestUpgradeFormat6 scales photo and video brightness once on the stored-scene upgrade, never on a plain decode.
func TestUpgradeFormat6(t *testing.T) {
	doc := `{"id":"s","setupId":"x","name":"n","version":2,"mode":"scenery","kind":"scenery","backdrop":{"static":{"layers":[],"attachments":[{"id":"att_1","gobo":"plate-spiral","params":{}}]},
		"live":{"layers":[],"attachments":[]},"color":{"layers":[]},"scenery":{"layers":[
		{"id":"p","kind":"photo","ref":"flowers","name":"f","visible":true,"opacity":1,"blend":"normal","light":null,"params":{"brightness":0.66}},
		{"id":"v","kind":"video","ref":"youtube:aqz-KE-bpKQ","name":"v","visible":true,"opacity":1,"blend":"normal","light":null,"params":{"brightness":0.8}}]}},
		"points":[],"objects":[],"timeline":{"duration":20,"tracks":[],"clips":[],"cues":[]}}`
	plain, err := Decode([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	if plain.Backdrop.Scenery.Layers[0].Params["brightness"] != 0.66 || plain.Format != FormatVersion || plain.Backdrop.Static.Attachments[0].Gobo != "plate-swirl" {
		t.Fatalf("decode %+v", plain.Backdrop)
	}
	out, notes, changed, err := UpgradeNotes([]byte(doc))
	if err != nil || !changed {
		t.Fatalf("upgrade %v %v", changed, err)
	}
	var m struct {
		Format   int `json:"format"`
		Backdrop struct {
			Scenery struct {
				Layers []struct {
					Params map[string]any `json:"params"`
				} `json:"layers"`
			} `json:"scenery"`
		} `json:"backdrop"`
	}
	_ = json.Unmarshal(out, &m)
	if m.Format != 6 || m.Backdrop.Scenery.Layers[0].Params["brightness"] != 0.924 || m.Backdrop.Scenery.Layers[1].Params["brightness"] != 1.0 {
		t.Fatalf("upgraded %s", out)
	}
	if len(notes) != 2 || !strings.Contains(notes[0], "plate-spiral → plate-swirl") || !strings.Contains(notes[1], "brightness") {
		t.Fatalf("notes %v", notes)
	}
	if _, _, again, _ := UpgradeNotes(out); again {
		t.Fatal("a format 6 scene upgrades again")
	}
	// a preset upgrades the same way, once
	p := Preset{ID: "pre_x", Mode: ModeScenery, Backdrop: LayerStack{Layers: []Layer{{ID: "p", Kind: "photo", Params: map[string]any{"brightness": 0.5}}}}}
	if changed, notes := p.UpgradeNotes(); !changed || len(notes) != 1 || p.Backdrop.Layers[0].Params["brightness"] != 0.7 || p.Format != FormatVersion {
		t.Fatalf("preset %v %v %+v", changed, notes, p)
	}
	if changed, _ := p.UpgradeNotes(); changed || p.Backdrop.Layers[0].Params["brightness"] != 0.7 {
		t.Fatal("a format 6 preset upgrades again")
	}
}
