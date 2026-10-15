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
	// Sharp is the share of mapped camera pixels that read every Gray-code bit (in focus).
	Sharp float64 `json:"sharp"`
	// ROI is the quality inside the region of interest (the whole lit frame when none was given).
	ROI *ROIQuality `json:"roi,omitempty"`
	// Contrast is how strongly the projector showed in the white and black stills.
	Contrast *Contrast `json:"contrast,omitempty"`
}

// ROIQuality is the quality inside the region of interest, over the camera pixels the projector lights there.
type ROIQuality struct {
	// Mapped is the share with a correspondence, Sharp the share at full precision ("sharp area mapped").
	Mapped  float64 `json:"mapped"`
	Sharp   float64 `json:"sharp"`
	ErrorPx float64 `json:"errorPx"`
}

// Rect is an axis-aligned rectangle.
type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Empty tells whether r has no area.
func (r *Rect) Empty() bool { return r == nil || r.W <= 0 || r.H <= 0 }

// ROI limits a calibration: Scene in scene pixels (from the editor), Camera in camera-view fractions 0…1 of the
// still (from the phone). Either or both.
type ROI struct {
	Scene  *Rect `json:"roi,omitempty"`
	Camera *Rect `json:"cameraRoi,omitempty"`
}

// Calibration is one Gray-code pass and its result.
type Calibration struct {
	ID       string   `json:"id"`
	SetupID  string   `json:"setupId"`
	Status   string   `json:"status"`
	Message  string   `json:"message"`
	Quality  *Quality `json:"quality"`
	MapAsset *string  `json:"mapAsset"`
	// ConfidenceAsset is an 8-bit PNG at decode resolution: per camera pixel, 0 = no correspondence, else
	// 255 · (bits read) / (bits per axis). The precision is 2^(bits per axis − bits read) projector px.
	ConfidenceAsset *string `json:"confidenceAsset,omitempty"`
	// DiffAsset is what the camera saw of the projector: |white − black| ×4, 8-bit PNG (also on failures).
	DiffAsset *string `json:"diffAsset,omitempty"`
	// ROI is what the calibration was limited to: the scene rectangle, the camera rectangle (fractions) and the
	// projector rectangle (physical px, with margin) the patterns were drawn in.
	ROI          *Rect   `json:"roi,omitempty"`
	CameraROI    *Rect   `json:"cameraRoi,omitempty"`
	ProjectorROI *Rect   `json:"projectorRoi,omitempty"`
	WhiteAsset   *string `json:"whiteAsset"`
	CameraW      int     `json:"cameraWidth"`
	CameraH      int     `json:"cameraHeight"`
	ProjW        int     `json:"projectorWidth"`
	// SettleMs is the wait between showing a pattern and capturing it that this pass needed (it grows when the
	// projector or the phone lags).
	SettleMs  int       `json:"settleMs,omitempty"`
	ProjH     int       `json:"projectorHeight"`
	CreatedAt time.Time `json:"createdAt"`
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

// Check is one line of the auto map pre-flight: ok, and when not, what to do about it.
type Check struct {
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
	Fix    string `json:"fix,omitempty"`
}

// OutputCheck is the projector output line: the newest /out and its telemetry.
type OutputCheck struct {
	Check
	Connected bool    `json:"connected"`
	Name      string  `json:"name,omitempty"`
	Width     int     `json:"width"`
	Height    int     `json:"height"`
	FPS       float64 `json:"fps"`
	// SetupWidth and SetupHeight are the projector pixels the active setup expects.
	SetupWidth  int `json:"setupWidth"`
	SetupHeight int `json:"setupHeight"`
	// Warning says the window does not fill the projector (not a blocker).
	Warning string `json:"warning,omitempty"`
}

// CameraCheck is the phone camera line.
type CameraCheck struct {
	Check
	Connected bool    `json:"connected"`
	Streaming bool    `json:"streaming"`
	FPS       float64 `json:"fps"`
	Width     int     `json:"width"`
	Height    int     `json:"height"`
	Steady    bool    `json:"steady"`
	LastFrame int64   `json:"lastFrameAgeMs"`
}

// Preflight is GET /camera/preflight: what auto map needs before it can start.
type Preflight struct {
	Server Check       `json:"server"`
	Output OutputCheck `json:"output"`
	Camera CameraCheck `json:"camera"`
	// Ready is output.ok && camera.ok; Reason says what blocks the start when not.
	Ready  bool   `json:"ready"`
	Reason string `json:"reason,omitempty"`
	// Aiming is true while the output shows the aiming image (calibration.aim).
	Aiming bool `json:"aiming"`
	// Running is the id of the calibration in progress, "" when none.
	Running string `json:"running"`
	// Light is the last light check (within 10 min), nil when none.
	Light *LightCheck `json:"light,omitempty"`
}

// Contrast is how strongly the projector shows in the camera: the white − black difference, 0–255 levels.
type Contrast struct {
	// Lit is the share of the view the projector visibly lights.
	Lit float64 `json:"lit"`
	// Median and Peak (99th percentile) of the difference over lit pixels; Room the median black level there.
	Median    float64 `json:"median"`
	Peak      float64 `json:"peak"`
	Room      float64 `json:"room"`
	Noise     float64 `json:"noise"`
	Threshold float64 `json:"threshold"`
	// BrighterPct is Peak over the room level, in percent.
	BrighterPct float64 `json:"brighterPct"`
}

// LightCheck is POST /calibrations/lightcheck: white, black, white on the output, compared on the preview.
type LightCheck struct {
	// Level is strong | weak | none.
	Level    string    `json:"level"`
	Message  string    `json:"message"`
	Contrast Contrast  `json:"contrast"`
	At       time.Time `json:"at"`
}
