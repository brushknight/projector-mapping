package scene

import (
	"encoding/json"
	"time"

	"projmap/internal/domain/docpatch"
)

// Draft statuses.
const (
	DraftOpen      = "open"
	DraftProposed  = "proposed"
	DraftApplied   = "applied"
	DraftDiscarded = "discarded"
)

// Draft is a backstage copy of a scene: ops against the scene at BaseVersion.
type Draft struct {
	ID          string        `json:"id"`
	SceneID     string        `json:"sceneId"`
	Author      string        `json:"author"`
	BaseVersion int64         `json:"baseVersion"`
	Ops         []docpatch.Op `json:"ops"`
	Status      string        `json:"status"`
	Summary     string        `json:"summary"`
	BaseDoc     []byte        `json:"-"`
	UpdatedAt   time.Time     `json:"-"`
}

// IsOpen tells whether the draft still takes ops.
func (d *Draft) IsOpen() bool { return d.Status == DraftOpen || d.Status == DraftProposed }

// HistoryEntry is one committed patch.
type HistoryEntry struct {
	Version int64         `json:"version"`
	Author  string        `json:"author"`
	TS      time.Time     `json:"ts"`
	Ops     []docpatch.Op `json:"ops"`
	Inverse []docpatch.Op `json:"-"`
}

// Preset modes.
var PresetModes = map[string]bool{"static": true, "live": true, "color": true, "scenery": true}

// Preset is a named snapshot of one backdrop stack; applying it replaces that mode's stack and puts the mode on air.
type Preset struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Mode       string     `json:"mode"`
	Backdrop   LayerStack `json:"backdrop"`
	ThumbAsset *string    `json:"thumbAsset"`
	CreatedAt  time.Time  `json:"createdAt"`
}

// MarshalJSON writes the stack in its mode's shape: a static preset carries {layers: [], light, attachments}, a live
// one {layers, light, attachments}, color and scenery presets {layers}.
func (p Preset) MarshalJSON() ([]byte, error) {
	type plain Preset
	return json.Marshal(struct {
		plain
		Backdrop any `json:"backdrop"`
	}{plain(p), StackJSON(p.Mode, p.Backdrop)})
}

// Upgrade moves a static or live preset from before the light model to it (see UpgradeStack) and reports whether
// it changed.
func (p *Preset) Upgrade() bool {
	return UpgradeStack(p.Mode, &p.Backdrop)
}

// PresetOps replace the preset's mode stack and put that mode on air (protocol §1 Preset). Layer and
// attachment ids of the preset that another stack of sc already uses get new ids (they share one namespace).
func PresetOps(pr *Preset, sc *Scene) []docpatch.Op {
	mode := pr.Mode
	if !IsBackdropMode(mode) {
		mode = ModeStatic
	}
	st := pr.Backdrop
	st.Layers = append([]Layer{}, st.Layers...)
	st.Attachments = append([]Attachment{}, st.Attachments...)
	if sc != nil {
		used := map[string]bool{}
		for _, m := range BackdropModes {
			if m == mode {
				continue
			}
			o := sc.Backdrop.Stack(m)
			for _, l := range o.Layers {
				used[l.ID] = true
			}
			for _, a := range o.Attachments {
				used[a.ID] = true
			}
		}
		for i := range st.Layers {
			if used[st.Layers[i].ID] {
				st.Layers[i].ID = NewID("lay")
			}
		}
		for i := range st.Attachments {
			if used[st.Attachments[i].ID] {
				st.Attachments[i].ID = NewID("att")
			}
		}
	}
	return []docpatch.Op{docpatch.Replace("/backdrop/"+mode, StackJSON(mode, st)), docpatch.Replace("/mode", mode)}
}
