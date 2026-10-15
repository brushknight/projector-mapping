package scenesvc

import (
	"encoding/json"
	"strings"
	"testing"

	"projmap/internal/domain/scene"
)

func TestApplyPresetOpsRenamesClashingIDs(t *testing.T) {
	sc := scene.New("scn_x", "set_x", "x")
	sc.Normalize()
	sc.Backdrop.Live.Attachments = []scene.Attachment{{ID: "att_window", Gobo: "window", Visible: true, Opacity: 1, Scale: 1}}
	pr := &scene.Preset{ID: "pre_x", Name: "x", Mode: scene.ModeStatic, Backdrop: scene.LayerStack{Layers: []scene.Layer{},
		Attachments: []scene.Attachment{{ID: "att_window", Gobo: "blinds", Visible: true, Opacity: 1, Scale: 1}, {ID: "att_other", Gobo: "dots", Visible: true, Opacity: 1, Scale: 1}}}}
	ops := ApplyPresetOps(pr, &sc)
	if len(ops) != 2 || ops[0].Path != "/backdrop/static" || ops[1].Path != "/mode" {
		t.Fatalf("ops %+v", ops)
	}
	b, _ := json.Marshal(ops[0].Value)
	if strings.Contains(string(b), `"att_window"`) || !strings.Contains(string(b), `"att_other"`) || !strings.Contains(string(b), `"light":{`) {
		t.Fatalf("static stack %s", b)
	}
	if pr.Backdrop.Attachments[0].ID != "att_window" {
		t.Fatal("the stored preset is not changed")
	}
}
