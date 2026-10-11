// Package camera holds calibration runs (Gray-code passes), their progress and quality, and capture requests.
package camera

import "time"

// Calibration statuses.
const (
	CalRunning = "running"
	CalDone    = "done"
	CalFailed  = "failed"
)

// Quality of a decoded map.
type Quality struct {
	Coverage float64 `json:"coverage"`
	ErrorPx  float64 `json:"errorPx"`
}

// Calibration is one Gray-code pass and its result.
type Calibration struct {
	ID         string    `json:"id"`
	SetupID    string    `json:"setupId"`
	Status     string    `json:"status"`
	Message    string    `json:"message"`
	Quality    *Quality  `json:"quality"`
	MapAsset   *string   `json:"mapAsset"`
	WhiteAsset *string   `json:"whiteAsset"`
	CameraW    int       `json:"cameraWidth"`
	CameraH    int       `json:"cameraHeight"`
	ProjW      int       `json:"projectorWidth"`
	ProjH      int       `json:"projectorHeight"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Progress is what calib:{id} carries.
type Progress struct {
	Step    string `json:"step"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Message string `json:"message"`
}

// Status is the phone's camera.status.
type Status struct {
	Streaming bool    `json:"streaming"`
	FPS       float64 `json:"fps"`
	Width     int     `json:"width"`
	Height    int     `json:"height"`
	Steady    bool    `json:"steady"`
	Level     float64 `json:"level"`
}

// Pt is a 2D point.
type Pt struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Candidate is a surface found from the calibration map.
type Candidate struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Camera     []Pt    `json:"camera"`
	Projector  []Pt    `json:"projector"`
	Scene      []Pt    `json:"scene"`
	Confidence float64 `json:"confidence"`
	AreaCamPx  float64 `json:"areaCamPx"`
}

// EdgeError is the alignment error of one surface edge, in projector pixels (-1 when it could not be measured).
type EdgeError struct {
	Index   int     `json:"index"`
	From    string  `json:"from"`
	To      string  `json:"to"`
	ErrorPx float64 `json:"errorPx"`
	Samples int     `json:"samples"`
}

// FeedStatus is what camera_stream_status reports.
type FeedStatus struct {
	Connected   bool    `json:"connected"`
	Streaming   bool    `json:"streaming"`
	FPS         float64 `json:"fps"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Steady      bool    `json:"steady"`
	Level       float64 `json:"level"`
	LastFrameMs int64   `json:"lastFrameAgeMs"`
	Device      string  `json:"device,omitempty"`
}
