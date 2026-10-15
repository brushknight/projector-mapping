// Package camera stores calibration runs in SQLite.
package camera

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	camerarepo "projmap/internal/application/ports/repository/camera"
	"projmap/internal/domain/camera"
	"projmap/internal/infrastructure/database/sql/shared"
)

// CalibrationModel is a calibrations row.
type CalibrationModel struct {
	ID        string `gorm:"primaryKey"`
	SetupID   string
	Doc       string
	CreatedAt time.Time
}

func (CalibrationModel) TableName() string { return "calibrations" }

// Repository implements CalibrationRepository.
type Repository struct{ db *gorm.DB }

var _ camerarepo.CalibrationRepository = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) Get(ctx context.Context, id string) (*camera.Calibration, error) {
	var m CalibrationModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, shared.NotFound(err, "Calibration %s does not exist.", id)
	}
	var c camera.Calibration
	return &c, json.Unmarshal([]byte(m.Doc), &c)
}

func (r *Repository) Save(ctx context.Context, c *camera.Calibration) error {
	b, _ := json.Marshal(c)
	return r.db.WithContext(ctx).Save(&CalibrationModel{ID: c.ID, SetupID: c.SetupID, Doc: string(b), CreatedAt: c.CreatedAt}).Error
}

func (r *Repository) Running(ctx context.Context) ([]*camera.Calibration, error) {
	var rows []CalibrationModel
	if err := r.db.WithContext(ctx).Where("doc LIKE ?", `%"status":"running"%`).Find(&rows).Error; err != nil {
		return nil, err
	}
	var out []*camera.Calibration
	for _, m := range rows {
		var c camera.Calibration
		if json.Unmarshal([]byte(m.Doc), &c) == nil && c.Status == camera.CalRunning {
			out = append(out, &c)
		}
	}
	return out, nil
}
