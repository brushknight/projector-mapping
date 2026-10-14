// Package show holds the show section's service interface: the live state and the transport on the server clock.
package show

import (
	"context"
	"encoding/json"

	"projmap/internal/domain/show"
)

// Actions are the names of POST /show/{action} and cmd show.{action}.
var Actions = []string{"go", "back", "play", "pause", "stop", "seek", "blackout", "activate", "solo", "preview", "audio"}

// PlayIn is cmd sound.play: a pad of a scene (default the active one) or a library sound, at volume (0..1, default
// 1, multiplying the pad's).
type PlayIn struct {
	PadID   string   `json:"padId,omitempty"`
	SoundID string   `json:"soundId,omitempty"`
	Volume  *float64 `json:"volume,omitempty"`
	SceneID string   `json:"sceneId,omitempty"`
}

// StopIn is cmd sound.stop: one play, every play of a pad, or (neither) every pad and cue sound.
type StopIn struct {
	PlayID string `json:"playId,omitempty"`
	PadID  string `json:"padId,omitempty"`
}

// SoundAck answers sound.play and sound.stop.
type SoundAck struct {
	PlayID  string `json:"playId,omitempty"`
	Outputs int    `json:"outputs"`
	// Stopped says a looping pad that was playing was stopped instead of started.
	Stopped bool `json:"stopped,omitempty"`
}

// SoundPlay is the sound.play message the audio clients get.
type SoundPlay struct {
	PlayID string  `json:"playId"`
	Sound  string  `json:"sound"`
	PadID  string  `json:"padId,omitempty"`
	CueID  string  `json:"cueId,omitempty"`
	Name   string  `json:"name,omitempty"`
	Volume float64 `json:"volume"`
	Loop   bool    `json:"loop"`
}

// SoundStop is the sound.stop message the audio clients get.
type SoundStop struct {
	PlayID string `json:"playId,omitempty"`
	PadID  string `json:"padId,omitempty"`
}

// ShowService owns the live state.
type ShowService interface {
	Get(ctx context.Context) show.Show
	// Do runs an action with its JSON args ({t} for seek, {on} for blackout, {sceneId} for activate,
	// {surfaceIds, fill?, seconds?} for solo, {draftId, t?, play?} for preview, {output?, volume?, muted?} for audio).
	Do(ctx context.Context, action string, args json.RawMessage, by string) (show.Show, error)
	// Preview plays a draft on the projector from..to (agent preview); an empty draftID ends the preview.
	Preview(ctx context.Context, draftID string, from, to float64, play bool) (show.Show, error)
	// Now is the server clock in unix ns.
	Now() int64
	// PlaySound sends sound.play to the audio clients (a looping pad already playing stops instead).
	PlaySound(ctx context.Context, in PlayIn) (SoundAck, error)
	// StopSound sends sound.stop to the audio clients.
	StopSound(ctx context.Context, in StopIn) (SoundAck, error)
}
