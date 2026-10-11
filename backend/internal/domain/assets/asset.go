// Package assets holds content-addressed files: photos, references, snapshots, calibration maps and thumbnails.
package assets

// Kinds of asset.
var Kinds = map[string]bool{"photo": true, "reference": true, "snapshot": true, "calibration": true, "thumb": true}

// Asset is one stored file, addressed by its sha256.
type Asset struct {
	SHA    string  `json:"sha"`
	Mime   string  `json:"mime"`
	Width  int     `json:"width"`
	Height int     `json:"height"`
	Bytes  int64   `json:"bytes"`
	Kind   string  `json:"kind"`
	Thumb  *string `json:"thumb,omitempty"`
}
