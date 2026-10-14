// Package sounds holds the sounds section's service interface: the sound library (assets of kind sound).
package sounds

import (
	"context"

	assetssvc "projmap/internal/application/services/assets"
	"projmap/internal/domain/assets"
)

// SoundService keeps the sound library and publishes it on the sounds channel.
type SoundService interface {
	// List is the library, newest first.
	List(ctx context.Context) ([]assets.Asset, error)
	Upload(ctx context.Context, data []byte, in assetssvc.SoundIn) (*assets.Asset, error)
	Rename(ctx context.Context, sha, name string) (*assets.Asset, error)
	// Delete removes the sound; pads, clips and cues that use it stay and show as missing.
	Delete(ctx context.Context, sha string) error
}
