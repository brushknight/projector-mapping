// Package agents stores agent sessions and their events in SQLite.
package agents

import (
	"context"
	"encoding/json"

	"gorm.io/gorm"

	agentrepo "projmap/internal/application/ports/repository/agents"
	"projmap/internal/domain/agents"
	"projmap/internal/infrastructure/database/sql/shared"
	"time"
)

// SessionModel is an agent_sessions row.
type SessionModel struct {
	ID        string `gorm:"primaryKey"`
	Doc       string
	CreatedAt time.Time
}

func (SessionModel) TableName() string { return "agent_sessions" }

// EventModel is an agent_events row.
type EventModel struct {
	ID        int64 `gorm:"primaryKey;autoIncrement"`
	SessionID string
	Seq       int
	Doc       string
}

func (EventModel) TableName() string { return "agent_events" }

// Repository implements SessionRepository.
type Repository struct{ db *gorm.DB }

var _ agentrepo.SessionRepository = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) List(ctx context.Context) ([]agents.Session, error) {
	var rows []SessionModel
	if err := r.db.WithContext(ctx).Order("created_at desc").Limit(200).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]agents.Session, 0, len(rows))
	for _, m := range rows {
		var s agents.Session
		if err := json.Unmarshal([]byte(m.Doc), &s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

func (r *Repository) Get(ctx context.Context, id string) (*agents.Session, error) {
	var m SessionModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, shared.NotFound(err, "Agent session %s does not exist.", id)
	}
	var s agents.Session
	return &s, json.Unmarshal([]byte(m.Doc), &s)
}

func (r *Repository) Save(ctx context.Context, s *agents.Session) error {
	b, _ := json.Marshal(s)
	return r.db.WithContext(ctx).Save(&SessionModel{ID: s.ID, Doc: string(b), CreatedAt: s.CreatedAt}).Error
}

func (r *Repository) AppendEvent(ctx context.Context, sessionID string, e agents.Event) error {
	b, _ := json.Marshal(e)
	return r.db.WithContext(ctx).Create(&EventModel{SessionID: sessionID, Seq: e.Seq, Doc: string(b)}).Error
}

func (r *Repository) Events(ctx context.Context, sessionID string) ([]agents.Event, error) {
	var rows []EventModel
	if err := r.db.WithContext(ctx).Where("session_id = ?", sessionID).Order("seq, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]agents.Event, 0, len(rows))
	for _, m := range rows {
		var e agents.Event
		if err := json.Unmarshal([]byte(m.Doc), &e); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}
