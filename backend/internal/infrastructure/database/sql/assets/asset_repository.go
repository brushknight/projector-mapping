// Package assets stores asset metadata in SQLite.
package assets

import (
	"context"
	"encoding/json"
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
	Name      string
	Duration  *float64
	Peaks     *string
	CreatedAt time.Time
}

func (AssetModel) TableName() string { return "assets" }

// ToDomain converts the row.
func (m AssetModel) ToDomain() *assets.Asset {
	a := &assets.Asset{SHA: m.SHA, Mime: m.Mime, Width: m.Width, Height: m.Height, Bytes: m.Bytes, Kind: m.Kind, Thumb: m.Thumb,
		Name: m.Name, Duration: m.Duration}
	if m.Peaks != nil {
		var p []float64
		if json.Unmarshal([]byte(*m.Peaks), &p) == nil {
			if p == nil {
				p = []float64{}
			}
			a.Peaks = &p
		}
	}
	if m.Kind == assets.KindSound && (a.Duration == nil || a.Peaks == nil) {
		d, p := 0.0, []float64{}
		if a.Duration != nil {
			d = *a.Duration
		}
		if a.Peaks != nil {
			p = *a.Peaks
		}
		a.SetSound(d, p)
	}
	return a
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
	m := AssetModel{SHA: a.SHA, Mime: a.Mime, Width: a.Width, Height: a.Height, Bytes: a.Bytes, Kind: a.Kind, Thumb: a.Thumb,
		Name: a.Name, Duration: a.Duration, CreatedAt: time.Now().UTC()}
	if a.Peaks != nil {
		b, _ := json.Marshal(*a.Peaks)
		s := string(b)
		m.Peaks = &s
	}
	return r.db.WithContext(ctx).Save(&m).Error
}

func (r *Repository) List(ctx context.Context, kind string) ([]assets.Asset, error) {
	var rows []AssetModel
	if err := r.db.WithContext(ctx).Where("kind = ?", kind).Order("created_at DESC, sha").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]assets.Asset, 0, len(rows))
	for _, m := range rows {
		out = append(out, *m.ToDomain())
	}
	return out, nil
}

func (r *Repository) Rename(ctx context.Context, sha, name string) error {
	res := r.db.WithContext(ctx).Model(&AssetModel{}).Where("sha = ?", sha).Update("name", name)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return shared.NotFound(gorm.ErrRecordNotFound, "Asset %s does not exist.", sha)
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, sha string) error {
	res := r.db.WithContext(ctx).Delete(&AssetModel{}, "sha = ?", sha)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return shared.NotFound(gorm.ErrRecordNotFound, "Asset %s does not exist.", sha)
	}
	return nil
}
