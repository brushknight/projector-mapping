// Package scenes holds the scenes section's service interfaces: scene documents (patches, params, undo, history),
// drafts and presets.
package scenes

import (
	"context"
	"encoding/json"

	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
)

// PatchCmd is a structural edit.
type PatchCmd struct {
	SceneID string
	Base    int64
	Ops     []docpatch.Op
	By      string
	// Re is the client's message id, echoed in patched.re.
	Re string
}

// ParamCmd is a continuous value.
type ParamCmd struct {
	SceneID string
	Path    string
	Value   json.RawMessage
	By      string
	// Conn is the sender's connection, which does not get the param back.
	Conn string
}

// CreateIn is POST /scenes without duplicate (protocol §15).
type CreateIn struct {
	Name    string `json:"name"`
	SetupID string `json:"setupId"`
	// Kind picks its default template; Template a sceneTemplates id (its kind wins over Kind).
	Kind     string `json:"kind"`
	Template string `json:"template"`
}

// SceneService owns scene documents: one goroutine per open scene serializes every write.
type SceneService interface {
	List(ctx context.Context) ([]scene.Summary, error)
	// Get returns the document (version included).
	Get(ctx context.Context, id string) ([]byte, int64, error)
	Scene(ctx context.Context, id string) (*scene.Scene, error)
	// Create makes a scene: from a template (or a kind's default template), else the empty static scene.
	Create(ctx context.Context, in CreateIn) (*scene.Scene, error)
	// Duplicate deep-copies a scene's current document under a new id, version 1 and the given name.
	Duplicate(ctx context.Context, srcID, name string) (*scene.Scene, error)
	// Rename is a replace /name patch; it returns the summary.
	Rename(ctx context.Context, id, name, by string) (scene.Summary, error)
	// Import stores a whole scene document (seed, from-photo).
	Import(ctx context.Context, s *scene.Scene) error
	Delete(ctx context.Context, id string) error
	Patch(ctx context.Context, cmd PatchCmd) (int64, error)
	Param(ctx context.Context, cmd ParamCmd) error
	Undo(ctx context.Context, id, by string) (int64, error)
	Redo(ctx context.Context, id, by string) (int64, error)
	History(ctx context.Context, id string, limit int) ([]scene.HistoryEntry, error)
	// Validate checks a document against the catalog and the scene rules.
	Validate(s *scene.Scene) error
}

// DraftService keeps backstage copies.
type DraftService interface {
	List(ctx context.Context, sceneID string) ([]scene.Draft, error)
	Get(ctx context.Context, id string) (*scene.Draft, error)
	Create(ctx context.Context, sceneID, author string) (*scene.Draft, error)
	// View is the draft applied to its base: the scene the draft would make.
	View(ctx context.Context, id string) (*scene.Scene, error)
	// AddOps appends ops written against View; they must apply and validate.
	AddOps(ctx context.Context, id string, ops []docpatch.Op) (*scene.Draft, error)
	Propose(ctx context.Context, id, summary string) (*scene.Draft, error)
	Apply(ctx context.Context, id, by string) (*scene.Draft, int64, error)
	Discard(ctx context.Context, id string) (*scene.Draft, error)
}

// PresetService keeps named backdrops.
type PresetService interface {
	List(ctx context.Context) ([]scene.Preset, error)
	Create(ctx context.Context, name, mode, sceneID string) (*scene.Preset, error)
	Save(ctx context.Context, p *scene.Preset) error
	Apply(ctx context.Context, id, sceneID, by string) (int64, error)
	Delete(ctx context.Context, id string) error
}
