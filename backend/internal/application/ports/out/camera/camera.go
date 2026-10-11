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
}

// Vision is the Gray-code math.
type Vision interface {
	Bits(n int) int
	Decode(f Frames, projW, projH int) (Map, camera.Quality, error)
	Load(b []byte) (Map, error)
	Detect(m Map) []camera.Candidate
	// Align measures each projector-space edge against the physical edges seen in lit, using the outline still.
	Align(lines, lit image.Image, m Map, edges [][2]camera.Pt) []camera.EdgeError
}
