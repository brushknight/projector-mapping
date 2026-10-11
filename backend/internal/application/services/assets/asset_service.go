// Package assets holds the assets section's service interface: content-addressed files.
package assets

import (
	"context"
	"io"

	"projmap/internal/domain/assets"
)

// MaxBytes is the largest upload.
const MaxBytes = 64 << 20

// AssetService stores and serves assets.
type AssetService interface {
	// Upload stores bytes (deduplicated by sha256), reads width and height, and makes a thumbnail for large images.
	Upload(ctx context.Context, data []byte, kind string) (*assets.Asset, error)
	Get(ctx context.Context, sha string) (*assets.Asset, error)
	Open(ctx context.Context, sha string) (io.ReadSeekCloser, *assets.Asset, error)
	Read(ctx context.Context, sha string) ([]byte, error)
}
