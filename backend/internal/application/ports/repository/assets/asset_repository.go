// Package assets is the storage port of asset metadata and bytes.
package assets

import (
	"context"
	"io"

	"projmap/internal/domain/assets"
)

// AssetRepository stores asset metadata.
type AssetRepository interface {
	Get(ctx context.Context, sha string) (*assets.Asset, error)
	Save(ctx context.Context, a *assets.Asset) error
	// List returns the assets of a kind, newest first.
	List(ctx context.Context, kind string) ([]assets.Asset, error)
	// Rename sets an asset's name.
	Rename(ctx context.Context, sha, name string) error
	Delete(ctx context.Context, sha string) error
}

// Blobs stores bytes by sha256.
type Blobs interface {
	// Put writes the bytes and returns their sha256 (hex).
	Put(b []byte) (string, error)
	Open(sha string) (io.ReadSeekCloser, error)
	Read(sha string) ([]byte, error)
	Path(sha string) string
	// PutFile moves a file into the store (streams for large videos) and returns its sha256 (hex).
	PutFile(path string) (string, error)
	Remove(sha string) error
}
