// Package setups is the storage port of projector rigs.
package setups

import (
	"context"

	"projmap/internal/domain/setup"
)

// SetupRepository stores setups with a version that bumps on every save.
type SetupRepository interface {
	List(ctx context.Context) ([]setup.Setup, error)
	Get(ctx context.Context, id string) (*setup.Setup, int64, error)
	Save(ctx context.Context, s *setup.Setup, version int64) error
	Delete(ctx context.Context, id string) error
}
