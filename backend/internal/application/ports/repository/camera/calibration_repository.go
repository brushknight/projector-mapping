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
}
