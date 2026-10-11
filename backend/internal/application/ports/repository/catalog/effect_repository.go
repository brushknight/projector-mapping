// Package catalog is the storage port of user and agent effects.
package catalog

import (
	"context"

	"projmap/internal/domain/catalog"
)

// EffectRepository stores user and agent effects (built-ins come from the embedded catalog).
type EffectRepository interface {
	List(ctx context.Context) ([]catalog.Effect, error)
	Get(ctx context.Context, id string) (*catalog.Effect, error)
	Save(ctx context.Context, e *catalog.Effect) error
	Delete(ctx context.Context, id string) error
}
