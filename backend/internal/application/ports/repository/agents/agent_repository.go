// Package agents is the storage port of agent sessions and their events.
package agents

import (
	"context"

	"projmap/internal/domain/agents"
)

// SessionRepository stores agent sessions and events.
type SessionRepository interface {
	List(ctx context.Context) ([]agents.Session, error)
	Get(ctx context.Context, id string) (*agents.Session, error)
	Save(ctx context.Context, s *agents.Session) error
	AppendEvent(ctx context.Context, sessionID string, e agents.Event) error
	Events(ctx context.Context, sessionID string) ([]agents.Event, error)
}
