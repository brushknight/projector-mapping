// Package show stores the live state and settings in the kv table.
package show

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	showrepo "projmap/internal/application/ports/repository/show"
)

// KVModel is a kv row.
type KVModel struct {
	Key   string `gorm:"primaryKey"`
	Value string
}

func (KVModel) TableName() string { return "kv" }

// Repository implements KV.
type Repository struct{ db *gorm.DB }

var _ showrepo.KV = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) Get(ctx context.Context, key string) ([]byte, error) {
	var m KVModel
	err := r.db.WithContext(ctx).First(&m, "key = ?", key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []byte(m.Value), nil
}

func (r *Repository) Put(ctx context.Context, key string, value []byte) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{UpdateAll: true}).Create(&KVModel{Key: key, Value: string(value)}).Error
}
