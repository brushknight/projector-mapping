// Package media is the port to the command-line media tools the server uses when it finds them: ffprobe and ffmpeg
// (durations, sizes, decoding, thumbnails, trims) and yt-dlp (YouTube downloads).
package media

import "context"

// Tool names.
const (
	FFmpeg  = "ffmpeg"
	FFprobe = "ffprobe"
	YTDLP   = "yt-dlp"
)

// Probe is what ffprobe says about a file.
type Probe struct {
	Duration float64
	Width    int
	Height   int
}

// Tools runs the media tools; every call looks the tool up again, so installing one takes effect without a restart.
type Tools interface {
	// Available tells whether a tool is found (on PATH or in the extra folders).
	Available(tool string) bool
	// Probe reads duration and video size (ffprobe).
	Probe(ctx context.Context, path string) (Probe, error)
	// DecodeMono decodes any audio to mono float samples at rate (ffmpeg).
	DecodeMono(ctx context.Context, path string, rate int) ([]float32, error)
	// Frame grabs the frame at seconds as a JPEG at most width px wide (ffmpeg).
	Frame(ctx context.Context, path string, at float64, width int) ([]byte, error)
	// Trim re-encodes in (H.264, AAC audio kept) from start to end (0 = the end) into out, reporting 0..1.
	Trim(ctx context.Context, in, out string, start, end float64, progress func(float64)) error
	// Download fetches the best MP4 at or below maxHeight into dir with yt-dlp, reporting 0..1, and returns the file
	// and the video's title ("" when unknown).
	Download(ctx context.Context, url, dir string, maxHeight int, progress func(float64)) (file, title string, err error)
}
