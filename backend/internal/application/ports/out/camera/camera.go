// Package camera holds the camera section's client ports: the phone's preview feed and the vision math.
package camera

import (
	"image"
	"time"

	"projmap/internal/domain/camera"
)

// Frame is one preview frame from the phone.
type Frame struct {
	Seq    int64
	Width  int
	Height int
	JPEG   []byte
	At     time.Time
}

// Feed is the phone's live preview, kept by the hub.
type Feed interface {
	LatestFrame() (Frame, bool)
	Status() (camera.Status, time.Time, bool)
	// CameraDevice is the id of the connected camera client ("" when none).
	CameraDevice() string
	// FrameRate is the preview frames per second the server actually received over the last 2 s.
	FrameRate() float64
	// ProjectorOutput is the newest connected projector output (/out) and its last telemetry.
	ProjectorOutput() (Output, bool)
}

// Output is a connected projector output.
type Output struct {
	DeviceID string
	Name     string
	// Width, Height and FPS come from its telemetry (0 until the first report).
	Width, Height int
	FPS           float64
}

// Frames are the captured stills of one calibration pass.
type Frames struct {
	White, Black image.Image
	X, Y         [][2]image.Image
}

// Map is a decoded camera↔projector correspondence.
type Map interface {
	// CamToProj maps a camera pixel (full still resolution) to a physical projector pixel.
	CamToProj(u, v float64) (camera.Pt, bool)
	// ProjToCam maps a physical projector pixel to a camera pixel.
	ProjToCam(x, y float64) (camera.Pt, bool)
	CameraSize() (int, int)
	Encode() ([]byte, error)
	// Confidence is the 8-bit confidence PNG (see camera.Calibration.ConfidenceAsset).
	Confidence() ([]byte, error)
	// Confident tells whether camera pixel (u, v) has a correspondence, and when not, the nearest one that does
	// (ok false when none is near).
	Confident(u, v float64) (bool, camera.Pt, bool)
}

// DecodeROI limits a decode: CamROI in still pixels, ProjROI in physical projector pixels (empty = none).
type DecodeROI struct {
	CamROI, ProjROI image.Rectangle
}

// Vision is the Gray-code math.
type Vision interface {
	Bits(n int) int
	// Decode fills Quality.Contrast even when it fails.
	Decode(f Frames, projW, projH int, roi DecodeROI) (Map, camera.Quality, error)
	// Contrast measures a white − black pair of 0..1 luma buffers.
	Contrast(white, black []float32, w, h int) camera.Contrast
	Load(b []byte) (Map, error)
	Detect(m Map) []camera.Candidate
	// Align measures each projector-space edge against the physical edges seen in lit, using the outline still.
	Align(lines, lit image.Image, m Map, edges [][2]camera.Pt) []camera.EdgeError
}
