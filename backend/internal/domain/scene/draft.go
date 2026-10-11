package scene

import (
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
