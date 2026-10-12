// Package show holds the show section's service interface: the live state and the transport on the server clock.
package show

import (
	"context"
	"encoding/json"

	"projmap/internal/domain/show"
)

// Actions are the names of POST /show/{action} and cmd show.{action}.
var Actions = []string{"go", "back", "play", "pause", "stop", "seek", "blackout", "activate", "solo", "preview"}

// ShowService owns the live state.
type ShowService interface {
	Get(ctx context.Context) show.Show
	// Do runs an action with its JSON args ({t} for seek, {on} for blackout, {sceneId} for activate,
	// {surfaceIds, fill?, seconds?} for solo, {draftId, t?, play?} for preview).
	Do(ctx context.Context, action string, args json.RawMessage, by string) (show.Show, error)
	// Preview plays a draft on the projector from..to (agent preview); an empty draftID ends the preview.
	Preview(ctx context.Context, draftID string, from, to float64, play bool) (show.Show, error)
	// Now is the server clock in unix ns.
	Now() int64
}
