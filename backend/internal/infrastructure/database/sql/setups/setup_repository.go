// Package setups stores projector rigs in SQLite.
package setups

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	setuprepo "projmap/internal/application/ports/repository/setups"
	"projmap/internal/domain/setup"
	"projmap/internal/infrastructure/database/sql/shared"
)

// SetupModel is a setups row.
type SetupModel struct {
	ID        string `gorm:"primaryKey"`
	Version   int64
	Doc       string
	UpdatedAt time.Time
}

func (SetupModel) TableName() string { return "setups" }

// ToDomain decodes the row.
func (m SetupModel) ToDomain() (setup.Setup, error) {
	var s setup.Setup
	err := json.Unmarshal([]byte(m.Doc), &s)
	return s, err
}

// Repository implements SetupRepository.
type Repository struct{ db *gorm.DB }

var _ setuprepo.SetupRepository = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) List(ctx context.Context) ([]setup.Setup, error) {
	var rows []SetupModel
	if err := r.db.WithContext(ctx).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]setup.Setup, 0, len(rows))
	for _, m := range rows {
		s, err := m.ToDomain()
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

func (r *Repository) Get(ctx context.Context, id string) (*setup.Setup, int64, error) {
	var m SetupModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, 0, shared.NotFound(err, "Setup %s does not exist.", id)
	}
	s, err := m.ToDomain()
	return &s, m.Version, err
}

func (r *Repository) Save(ctx context.Context, s *setup.Setup, version int64) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Save(&SetupModel{ID: s.ID, Version: version, Doc: string(b), UpdatedAt: time.Now().UTC()}).Error
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&SetupModel{}, "id = ?", id)
	if res.Error == nil && res.RowsAffected == 0 {
		return shared.NotFound(gorm.ErrRecordNotFound, "Setup %s does not exist.", id)
	}
	return res.Error
}
