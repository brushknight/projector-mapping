// Package setups holds the setups section's service interface: projector rigs.
package setups

import (
	"context"
	"encoding/json"

	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/setup"
)

// SetupService owns projector rigs.
type SetupService interface {
	List(ctx context.Context) ([]setup.Setup, error)
	Get(ctx context.Context, id string) (*setup.Setup, int64, error)
	Create(ctx context.Context, s setup.Setup) (*setup.Setup, error)
	// Merge applies a partial setup (RFC 7386 merge) and returns the result.
	Merge(ctx context.Context, id string, partial json.RawMessage, by string) (*setup.Setup, error)
	// Patch applies JSON Patch ops (WebSocket patch on setup:{id}); base follows the scene stale rule.
	Patch(ctx context.Context, id string, base int64, ops []docpatch.Op, by, re string) (int64, error)
	// Param forwards a continuous value and commits it after it settles.
	Param(ctx context.Context, id, path string, value json.RawMessage, by, conn string) error
	// SetTestPattern turns a test pattern on for `seconds` (0 = the default 60 s; sending it again renews it) or off.
	SetTestPattern(ctx context.Context, id, pattern string, seconds int, by string) (*setup.Setup, error)
	// ExpireTestPatterns turns off patterns whose time has passed and schedules the rest (on start).
	ExpireTestPatterns(ctx context.Context) error
	Delete(ctx context.Context, id string) error
}
