// Package assets stores asset metadata in SQLite.
package assets

import (
	"context"
	"time"

	"gorm.io/gorm"

	assetrepo "projmap/internal/application/ports/repository/assets"
	"projmap/internal/domain/assets"
	"projmap/internal/infrastructure/database/sql/shared"
)

// AssetModel is an assets row.
type AssetModel struct {
	SHA       string `gorm:"primaryKey;column:sha"`
	Mime      string
	Width     int
	Height    int
	Bytes     int64
	Kind      string
	Thumb     *string
	CreatedAt time.Time
}

func (AssetModel) TableName() string { return "assets" }

// ToDomain converts the row.
func (m AssetModel) ToDomain() *assets.Asset {
	return &assets.Asset{SHA: m.SHA, Mime: m.Mime, Width: m.Width, Height: m.Height, Bytes: m.Bytes, Kind: m.Kind, Thumb: m.Thumb}
}

// Repository implements AssetRepository.
type Repository struct{ db *gorm.DB }

var _ assetrepo.AssetRepository = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) Get(ctx context.Context, sha string) (*assets.Asset, error) {
	var m AssetModel
	if err := r.db.WithContext(ctx).First(&m, "sha = ?", sha).Error; err != nil {
		return nil, shared.NotFound(err, "Asset %s does not exist.", sha)
	}
	return m.ToDomain(), nil
}

func (r *Repository) Save(ctx context.Context, a *assets.Asset) error {
	return r.db.WithContext(ctx).Save(&AssetModel{SHA: a.SHA, Mime: a.Mime, Width: a.Width, Height: a.Height, Bytes: a.Bytes,
		Kind: a.Kind, Thumb: a.Thumb, CreatedAt: time.Now().UTC()}).Error
}
