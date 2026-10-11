// Package catalog holds the catalog section's service interface: the built-in catalog plus user and agent effects.
package catalog

import (
	"context"

	"projmap/internal/domain/catalog"
)

// EffectInput creates or updates an effect.
type EffectInput struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Params any    `json:"params"`
	Origin string `json:"-"`
}

// CatalogService serves the catalog and the effect library.
type CatalogService interface {
	// JSON is GET /catalog's body.
	JSON() []byte
	Catalog() *catalog.Catalog
	Effects(ctx context.Context) ([]catalog.Effect, error)
	Effect(ctx context.Context, id string) (*catalog.Effect, error)
	CreateEffect(ctx context.Context, in EffectInput) (*catalog.Effect, []string, error)
	UpdateEffect(ctx context.Context, id string, in EffectInput) (*catalog.Effect, []string, error)
	DeleteEffect(ctx context.Context, id string) error
	// LayerSchema and EffectSchema implement scene.Refs.
	LayerSchema(kind, ref string) (catalog.Schema, bool)
	EffectSchema(id string) (catalog.Schema, bool)
}
