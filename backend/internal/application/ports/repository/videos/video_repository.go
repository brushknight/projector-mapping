// Package videos is the storage port of the video library.
package videos

import (
	"context"

	"projmap/internal/domain/videos"
)

// VideoRepository stores Videos.
type VideoRepository interface {
	List(ctx context.Context) ([]videos.Video, error)
	Get(ctx context.Context, id string) (*videos.Video, error)
	Save(ctx context.Context, v *videos.Video) error
	Delete(ctx context.Context, id string) error
}
