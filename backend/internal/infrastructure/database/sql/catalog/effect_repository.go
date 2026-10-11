// Package catalog stores user and agent effects in SQLite.
package catalog

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	catalogrepo "projmap/internal/application/ports/repository/catalog"
	"projmap/internal/domain/catalog"
	"projmap/internal/infrastructure/database/sql/shared"
)

// EffectModel is an effects row.
type EffectModel struct {
	ID        string `gorm:"primaryKey"`
	Doc       string
	UpdatedAt time.Time
}

func (EffectModel) TableName() string { return "effects" }

// Repository implements EffectRepository.
type Repository struct{ db *gorm.DB }

var _ catalogrepo.EffectRepository = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) List(ctx context.Context) ([]catalog.Effect, error) {
	var rows []EffectModel
	if err := r.db.WithContext(ctx).Order("updated_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]catalog.Effect, 0, len(rows))
	for _, m := range rows {
		var e catalog.Effect
		if err := json.Unmarshal([]byte(m.Doc), &e); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

func (r *Repository) Get(ctx context.Context, id string) (*catalog.Effect, error) {
	var m EffectModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, shared.NotFound(err, "Effect %s does not exist.", id)
	}
	var e catalog.Effect
	return &e, json.Unmarshal([]byte(m.Doc), &e)
}

func (r *Repository) Save(ctx context.Context, e *catalog.Effect) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Save(&EffectModel{ID: e.ID, Doc: string(b), UpdatedAt: time.Now().UTC()}).Error
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&EffectModel{}, "id = ?", id)
	if res.Error == nil && res.RowsAffected == 0 {
		return shared.NotFound(gorm.ErrRecordNotFound, "Effect %s does not exist.", id)
	}
	return res.Error
}
