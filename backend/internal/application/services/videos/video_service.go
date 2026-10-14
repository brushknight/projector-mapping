// Package videos holds the videos section's service interface: the video library and YouTube imports.
package videos

import (
	"context"

	"projmap/internal/domain/videos"
)

// Tools says what the server found for imports.
type Tools struct {
	YTDLP  bool `json:"ytdlp"`
	FFmpeg bool `json:"ffmpeg"`
}

// ImportIn is POST /videos/import.
type ImportIn struct {
	URL       string  `json:"url"`
	MaxHeight int     `json:"maxHeight"`
	Start     float64 `json:"start"`
	End       float64 `json:"end"`
	Name      string  `json:"name"`
}

// VideoService keeps the video library and runs imports.
type VideoService interface {
	// List is the library, newest first.
	List(ctx context.Context) ([]videos.Video, error)
	Get(ctx context.Context, id string) (*videos.Video, error)
	// Upload stores the video file at path (it is moved) as a Video named name (default: fileName without extension).
	Upload(ctx context.Context, path, fileName, name string) (*videos.Video, error)
	Rename(ctx context.Context, id, name string) (*videos.Video, error)
	Delete(ctx context.Context, id string) error
	Tools() Tools
	// Import starts a YouTube import (it runs in the background with yt-dlp, or is done at once as an embed).
	Import(ctx context.Context, in ImportIn) (*videos.ImportJob, error)
	Job(id string) (*videos.ImportJob, int64, error)
	// Jobs are the recent imports, newest first.
	Jobs() []videos.ImportJob
}
