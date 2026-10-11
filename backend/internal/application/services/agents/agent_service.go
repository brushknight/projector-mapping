// Package agents holds the agents section's service interface: sessions, the runner, the event log and the agent
// permission settings.
package agents

import (
	"context"
	"encoding/json"

	"projmap/internal/domain/agents"
)

// StartInput starts a run.
type StartInput struct {
	Agent   string `json:"agent"`
	Prompt  string `json:"prompt"`
	SceneID string `json:"sceneId"`
}

// Snapshot is what agent:{id} carries on sub.
type Snapshot struct {
	Session agents.Session `json:"session"`
	Events  []agents.Event `json:"events"`
}

// AgentService runs agents and keeps their logs.
type AgentService interface {
	Start(ctx context.Context, in StartInput) (*agents.Session, error)
	List(ctx context.Context) ([]agents.Session, error)
	Get(ctx context.Context, id string) (*agents.Session, error)
	Events(ctx context.Context, id string) ([]agents.Event, error)
	Snapshot(ctx context.Context, id string) (*Snapshot, error)
	Cancel(ctx context.Context, id string) (*agents.Session, error)
	// Attach makes a session (and its draft) for an MCP client that connected on its own (Claude Code, Codex).
	Attach(ctx context.Context, agent, sceneID string) (*agents.Session, error)
	// Log appends an event to a session's log (MCP tool calls of attached sessions).
	Log(ctx context.Context, sessionID string, e agents.Event)
	// Finish ends a session started over MCP (its proposal is in).
	Finish(ctx context.Context, sessionID, status string)
	// Owned tells whether the runner started the session (then its CLI output is the log).
	Owned(sessionID string) bool
	Settings(ctx context.Context) agents.Settings
	UpdateSettings(ctx context.Context, partial json.RawMessage) (agents.Settings, error)
}
