// Package videos stores the video library in SQLite.
package videos

import (
	"context"
	"time"

	"gorm.io/gorm"

	videorepo "projmap/internal/application/ports/repository/videos"
	"projmap/internal/domain/videos"
	"projmap/internal/infrastructure/database/sql/shared"
)

// VideoModel is a videos row.
type VideoModel struct {
	ID        string `gorm:"primaryKey"`
	Name      string
	Ref       string
	Source    string
	URL       string
	YouTubeID string `gorm:"column:youtube_id"`
	SHA       string `gorm:"column:sha"`
	Thumb     *string
	Duration  float64
	Width     int
	Height    int
	CreatedAt time.Time
}

func (VideoModel) TableName() string { return "videos" }

func (m VideoModel) toDomain() videos.Video {
	return videos.Video{ID: m.ID, Name: m.Name, Ref: m.Ref, Source: m.Source, URL: m.URL, YouTubeID: m.YouTubeID, SHA: m.SHA,
		Thumb: m.Thumb, Duration: m.Duration, Width: m.Width, Height: m.Height, CreatedAt: m.CreatedAt.UTC()}
}

// Repository implements VideoRepository.
type Repository struct{ db *gorm.DB }

var _ videorepo.VideoRepository = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) List(ctx context.Context) ([]videos.Video, error) {
	var rows []VideoModel
	if err := r.db.WithContext(ctx).Order("created_at DESC, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]videos.Video, 0, len(rows))
	for _, m := range rows {
		out = append(out, m.toDomain())
	}
	return out, nil
}

func (r *Repository) Get(ctx context.Context, id string) (*videos.Video, error) {
	var m VideoModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, shared.NotFound(err, "Video %s does not exist.", id)
	}
	v := m.toDomain()
	return &v, nil
}

func (r *Repository) Save(ctx context.Context, v *videos.Video) error {
	return r.db.WithContext(ctx).Save(&VideoModel{ID: v.ID, Name: v.Name, Ref: v.Ref, Source: v.Source, URL: v.URL, YouTubeID: v.YouTubeID,
		SHA: v.SHA, Thumb: v.Thumb, Duration: v.Duration, Width: v.Width, Height: v.Height, CreatedAt: v.CreatedAt.UTC()}).Error
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&VideoModel{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return shared.NotFound(gorm.ErrRecordNotFound, "Video %s does not exist.", id)
	}
	return nil
}
