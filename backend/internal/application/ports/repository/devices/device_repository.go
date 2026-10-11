// Package devices is the storage port of paired devices.
package devices

import (
	"context"

	"projmap/internal/domain/devices"
)

// DeviceRepository stores devices and their token hashes.
type DeviceRepository interface {
	List(ctx context.Context) ([]devices.Device, error)
	Get(ctx context.Context, id string) (*devices.Device, error)
	ByTokenHash(ctx context.Context, hash string) (*devices.Device, error)
	// ByLocal finds the trusted local device of that name and role.
	ByLocal(ctx context.Context, name string, role devices.Role) (*devices.Device, error)
	Save(ctx context.Context, d *devices.Device) error
	Delete(ctx context.Context, id string) error
}
