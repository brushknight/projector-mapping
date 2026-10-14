// Package assets holds content-addressed files: photos, references, snapshots, calibration maps, thumbnails, sounds
// and videos.
package assets

// Kinds of asset.
var Kinds = map[string]bool{"photo": true, "reference": true, "snapshot": true, "calibration": true, "thumb": true,
	KindSound: true, KindVideo: true}

// Media kinds (protocol §14).
const (
	KindSound = "sound"
	KindVideo = "video"
)

// PeakCount is how many peaks a sound gets.
const PeakCount = 128

// Asset is one stored file, addressed by its sha256.
type Asset struct {
	SHA    string  `json:"sha"`
	Mime   string  `json:"mime"`
	Width  int     `json:"width"`
	Height int     `json:"height"`
	Bytes  int64   `json:"bytes"`
	Kind   string  `json:"kind"`
	Thumb  *string `json:"thumb,omitempty"`
	// Name labels sounds and videos.
	Name string `json:"name,omitempty"`
	// Duration is the length in seconds (sounds and videos).
	Duration *float64 `json:"duration,omitempty"`
	// Peaks are 0..1, the largest absolute sample per equal slice (sounds).
	Peaks *[]float64 `json:"peaks,omitempty"`
}

// SetSound fills duration and peaks (never null for a sound).
func (a *Asset) SetSound(duration float64, peaks []float64) {
	if peaks == nil {
		peaks = []float64{}
	}
	a.Duration, a.Peaks = &duration, &peaks
}
