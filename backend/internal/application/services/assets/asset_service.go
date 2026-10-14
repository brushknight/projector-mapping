// Package assets holds the assets section's service interface: content-addressed files.
package assets

import (
	"context"
	"io"

	"projmap/internal/domain/assets"
)

// MaxBytes is the largest upload (sounds included).
const MaxBytes = 64 << 20

// MaxVideoBytes is the largest video upload.
const MaxVideoBytes = 512 << 20

// SoundIn is what an uploader says about a sound: the file name, a name, and the duration and peaks it decoded
// itself (kept when the server cannot read the file).
type SoundIn struct {
	FileName string
	Name     string
	Duration *float64
	Peaks    []float64
}

// AssetService stores and serves assets.
type AssetService interface {
	// Upload stores bytes (deduplicated by sha256), reads width and height, and makes a thumbnail for large images.
	Upload(ctx context.Context, data []byte, kind string) (*assets.Asset, error)
	Get(ctx context.Context, sha string) (*assets.Asset, error)
	Open(ctx context.Context, sha string) (io.ReadSeekCloser, *assets.Asset, error)
	Read(ctx context.Context, sha string) ([]byte, error)
	// UploadSound stores a WAV, MP3, M4A, AIFF or OGG file as kind sound with its name, duration and peaks.
	UploadSound(ctx context.Context, data []byte, in SoundIn) (*assets.Asset, error)
	// StoreVideo moves a video file into the store as kind video, with its size and duration when ffprobe can tell.
	StoreVideo(ctx context.Context, path, name string) (*assets.Asset, error)
	// VideoThumb stores a JPEG of the video's frame at seconds and returns its sha.
	VideoThumb(ctx context.Context, sha string, at float64) (string, error)
	// List returns the assets of a kind, newest first.
	List(ctx context.Context, kind string) ([]assets.Asset, error)
	Rename(ctx context.Context, sha, name string) (*assets.Asset, error)
	// Delete removes the asset and its file.
	Delete(ctx context.Context, sha string) error
	// Path is the asset's file on disk.
	Path(sha string) string
}
