// Package camera holds the camera section's service interfaces: stills from the phone, the preview feed and
// calibration (Gray-code passes, maps, surface detection, alignment).
package camera

import (
	"context"

	"projmap/internal/domain/assets"
	"projmap/internal/domain/camera"
)

// MaxStillWidth is the camera frame every calibration still is reduced to: the camera pixel space of maps, of
// surface_create_from_camera and of detect_surfaces.
const MaxStillWidth = 1280

// CameraService talks to the phone's camera.
type CameraService interface {
	Status(ctx context.Context) camera.FeedStatus
	// Preview is the latest preview frame as JPEG.
	Preview(ctx context.Context) ([]byte, bool)
	// Capture asks the phone for a full-resolution still with locked exposure and returns it as an asset.
	Capture(ctx context.Context, kind string) (*assets.Asset, error)
	// StillUploaded stores a still the phone posted for a capture request.
	StillUploaded(ctx context.Context, requestID string, data []byte) (*assets.Asset, error)
}

// CalibrationService runs and uses calibrations.
type CalibrationService interface {
	Start(ctx context.Context, setupID string) (*camera.Calibration, error)
	Get(ctx context.Context, id string) (*camera.Calibration, error)
	Progress(ctx context.Context, id string) (*camera.Progress, error)
	// Current is the setup's calibration (setup.calibrationId).
	Current(ctx context.Context, setupID string) (*camera.Calibration, error)
	// CameraToScene maps camera pixels to scene pixels through the setup's calibration.
	CameraToScene(ctx context.Context, setupID string, pts []camera.Pt) ([]camera.Pt, error)
	// SceneToCamera maps scene pixels to camera pixels (where the projector lights them in the camera's view).
	SceneToCamera(ctx context.Context, setupID string, pts []camera.Pt) ([]camera.Pt, error)
	Detect(ctx context.Context, setupID string) ([]camera.Candidate, error)
	// Measure projects surface outlines over black, captures them and the lit object, and measures each edge against
	// the real object's edges.
	Measure(ctx context.Context, in AlignInput) ([]camera.EdgeError, error)
}

// AlignInput is what Measure checks.
type AlignInput struct {
	SetupID string
	// SurfaceIDs go to output.outline (the output draws them from the scene or preview draft it shows).
	SurfaceIDs []string
	// Edges are the same outlines in scene pixels.
	Edges [][2]camera.Pt
}
