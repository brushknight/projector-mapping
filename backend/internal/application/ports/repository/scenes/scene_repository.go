// Package scenes is the storage port of scenes, their op log, drafts and presets.
package scenes

import (
	"context"

	"projmap/internal/domain/scene"
)

// SceneRepository stores scene documents and the append-only op log.
type SceneRepository interface {
	List(ctx context.Context) ([]scene.Summary, error)
	// Get returns the scene's JSON document (version included).
	Get(ctx context.Context, id string) ([]byte, error)
	Create(ctx context.Context, s *scene.Scene) error
	// Commit stores the new document (and the list columns from meta: name, kind, mode) and appends the history
	// entry in one transaction.
	Commit(ctx context.Context, id string, doc []byte, meta scene.Summary, e scene.HistoryEntry) error
	Delete(ctx context.Context, id string) error
	// Rewrite replaces the stored document in place (same version, no history entry): format upgrades on start.
	// meta carries the kind and mode for the list.
	Rewrite(ctx context.Context, id string, doc []byte, meta scene.Summary) error
	History(ctx context.Context, id string, limit int) ([]scene.HistoryEntry, error)
}

// DraftRepository stores drafts.
type DraftRepository interface {
	List(ctx context.Context, sceneID string) ([]scene.Draft, error)
	Get(ctx context.Context, id string) (*scene.Draft, error)
	Save(ctx context.Context, d *scene.Draft) error
}

// PresetRepository stores presets.
type PresetRepository interface {
	List(ctx context.Context) ([]scene.Preset, error)
	Get(ctx context.Context, id string) (*scene.Preset, error)
	Save(ctx context.Context, p *scene.Preset) error
	Delete(ctx context.Context, id string) error
}
