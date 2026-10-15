// Package camera is the storage port of calibrations.
package camera

import (
	"context"

	"projmap/internal/domain/camera"
)

// CalibrationRepository stores calibration runs.
type CalibrationRepository interface {
	Get(ctx context.Context, id string) (*camera.Calibration, error)
	Save(ctx context.Context, c *camera.Calibration) error
	// Running lists the calibrations whose status is still running (after a restart: interrupted ones).
	Running(ctx context.Context) ([]*camera.Calibration, error)
}
