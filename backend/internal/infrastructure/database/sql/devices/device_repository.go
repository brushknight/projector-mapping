// Package devices stores paired devices in SQLite.
package devices

import (
	"context"
	"time"

	"gorm.io/gorm"

	devicerepo "projmap/internal/application/ports/repository/devices"
	"projmap/internal/domain/devices"
	"projmap/internal/infrastructure/database/sql/shared"
)

// DeviceModel is a devices row.
type DeviceModel struct {
	ID        string `gorm:"primaryKey"`
	Name      string
	Role      string
	TokenHash *string
	Local     bool
	SessionID *string
	LastSeen  time.Time
	CreatedAt time.Time
}

func (DeviceModel) TableName() string { return "devices" }

// ToDomain converts the row.
func (m DeviceModel) ToDomain() devices.Device {
	d := devices.Device{ID: m.ID, Name: m.Name, Role: devices.Role(m.Role), LastSeen: m.LastSeen.UTC(), Local: m.Local}
	if m.TokenHash != nil {
		d.TokenHash = *m.TokenHash
	}
	if m.SessionID != nil {
		d.SessionID = *m.SessionID
	}
	return d
}

func fromDomain(d *devices.Device) *DeviceModel {
	m := &DeviceModel{ID: d.ID, Name: d.Name, Role: string(d.Role), Local: d.Local, LastSeen: d.LastSeen, CreatedAt: time.Now().UTC()}
	if d.TokenHash != "" {
		m.TokenHash = &d.TokenHash
	}
	if d.SessionID != "" {
		m.SessionID = &d.SessionID
	}
	return m
}

// Repository implements DeviceRepository.
type Repository struct{ db *gorm.DB }

var _ devicerepo.DeviceRepository = (*Repository)(nil)

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) List(ctx context.Context) ([]devices.Device, error) {
	var rows []DeviceModel
	if err := r.db.WithContext(ctx).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]devices.Device, 0, len(rows))
	for _, m := range rows {
		out = append(out, m.ToDomain())
	}
	return out, nil
}

func (r *Repository) one(ctx context.Context, q string, args ...any) (*devices.Device, error) {
	var m DeviceModel
	if err := r.db.WithContext(ctx).Where(q, args...).First(&m).Error; err != nil {
		return nil, shared.NotFound(err, "Device does not exist.")
	}
	d := m.ToDomain()
	return &d, nil
}

func (r *Repository) Get(ctx context.Context, id string) (*devices.Device, error) {
	d, err := r.one(ctx, "id = ?", id)
	if err != nil {
		return nil, shared.NotFound(gorm.ErrRecordNotFound, "Device %s does not exist.", id)
	}
	return d, nil
}

func (r *Repository) ByTokenHash(ctx context.Context, hash string) (*devices.Device, error) {
	return r.one(ctx, "token_hash = ?", hash)
}

func (r *Repository) ByLocal(ctx context.Context, name string, role devices.Role) (*devices.Device, error) {
	return r.one(ctx, "local = 1 AND name = ? AND role = ?", name, string(role))
}

func (r *Repository) Save(ctx context.Context, d *devices.Device) error {
	m := fromDomain(d)
	var existing DeviceModel
	if err := r.db.WithContext(ctx).Select("created_at").First(&existing, "id = ?", d.ID).Error; err == nil {
		m.CreatedAt = existing.CreatedAt
	}
	return r.db.WithContext(ctx).Save(m).Error
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&DeviceModel{}, "id = ?", id)
	if res.Error == nil && res.RowsAffected == 0 {
		return shared.NotFound(gorm.ErrRecordNotFound, "Device %s does not exist.", id)
	}
	return res.Error
}
