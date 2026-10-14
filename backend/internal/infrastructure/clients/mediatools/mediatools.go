// Package mediatools runs ffprobe, ffmpeg and yt-dlp when the Mac has them (on PATH, or in /opt/homebrew/bin and
// /usr/local/bin, where Homebrew puts them and where a launchd PATH does not look).
package mediatools

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"projmap/internal/application/ports/out/media"
)

// DefaultDirs are looked in after PATH.
var DefaultDirs = []string{"/opt/homebrew/bin", "/usr/local/bin"}

// Tools implements media.Tools.
type Tools struct {
	// Dirs are the folders searched after PATH.
	Dirs []string
	// LookPath finds a tool on PATH (exec.LookPath when nil).
	LookPath func(string) (string, error)
}

var _ media.Tools = (*Tools)(nil)

// New searches PATH and dirs (nil = DefaultDirs).
func New(dirs []string) *Tools {
	if dirs == nil {
		dirs = DefaultDirs
	}
	return &Tools{Dirs: dirs}
}

// Path is the tool's executable, or "" when there is none.
func (t *Tools) Path(tool string) string {
	look := t.LookPath
	if look == nil {
		look = exec.LookPath
	}
	if p, err := look(tool); err == nil {
		return p
	}
	for _, d := range t.Dirs {
		p := filepath.Join(d, tool)
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return p
		}
	}
	return ""
}

func (t *Tools) Available(tool string) bool { return t.Path(tool) != "" }

func (t *Tools) need(tool string) (string, error) {
	p := t.Path(tool)
	if p == "" {
		return "", fmt.Errorf("%s is not installed", tool)
	}
	return p, nil
}

// run runs a tool and returns stdout, with the last stderr line in the error.
func run(ctx context.Context, bin string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s: %s", filepath.Base(bin), lastLine(errb.String(), err))
	}
	return out.Bytes(), nil
}

func lastLine(s string, err error) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			return l
		}
	}
	if err != nil {
		return err.Error()
	}
	return "failed"
}

func (t *Tools) Probe(ctx context.Context, path string) (media.Probe, error) {
	bin, err := t.need(media.FFprobe)
	if err != nil {
		return media.Probe{}, err
	}
	out, err := run(ctx, bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path)
	if err != nil {
		return media.Probe{}, err
	}
	var p struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
			Duration  string `json:"duration"`
			Tags      struct {
				Rotate string `json:"rotate"`
			} `json:"tags"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &p); err != nil {
		return media.Probe{}, fmt.Errorf("ffprobe: %w", err)
	}
	var r media.Probe
	r.Duration, _ = strconv.ParseFloat(p.Format.Duration, 64)
	for _, s := range p.Streams {
		if s.CodecType == "video" && r.Width == 0 {
			r.Width, r.Height = s.Width, s.Height
			if s.Tags.Rotate == "90" || s.Tags.Rotate == "270" || s.Tags.Rotate == "-90" {
				r.Width, r.Height = r.Height, r.Width
			}
		}
		if r.Duration == 0 {
			r.Duration, _ = strconv.ParseFloat(s.Duration, 64)
		}
	}
	if math.IsNaN(r.Duration) || r.Duration < 0 {
		r.Duration = 0
	}
	return r, nil
}

// maxDecodeSeconds bounds DecodeMono's output.
const maxDecodeSeconds = 2 * 3600

func (t *Tools) DecodeMono(ctx context.Context, path string, rate int) ([]float32, error) {
	bin, err := t.need(media.FFmpeg)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, bin, "-v", "error", "-nostdin", "-i", path, "-vn", "-ac", "1", "-ar", strconv.Itoa(rate), "-f", "f32le", "pipe:1")
	var errb bytes.Buffer
	cmd.Stderr = &errb
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	raw, rerr := io.ReadAll(io.LimitReader(stdout, int64(rate*4*maxDecodeSeconds)))
	_, _ = io.Copy(io.Discard, stdout)
	if err := cmd.Wait(); err != nil {
		return nil, fmt.Errorf("ffmpeg: %s", lastLine(errb.String(), err))
	}
	if rerr != nil {
		return nil, rerr
	}
	out := make([]float32, len(raw)/4)
	for i := range out {
		out[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
	}
	return out, nil
}

func (t *Tools) Frame(ctx context.Context, path string, at float64, width int) ([]byte, error) {
	bin, err := t.need(media.FFmpeg)
	if err != nil {
		return nil, err
	}
	args := []string{"-v", "error", "-nostdin"}
	if at > 0 {
		args = append(args, "-ss", secs(at))
	}
	args = append(args, "-i", path, "-frames:v", "1", "-vf", fmt.Sprintf("scale='min(%d,iw)':-2", width), "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "pipe:1")
	out, err := run(ctx, bin, args...)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("ffmpeg: no frame at %s s", secs(at))
	}
	return out, nil
}

func secs(f float64) string { return strconv.FormatFloat(f, 'f', 3, 64) }

var outTime = regexp.MustCompile(`^out_time_(?:ms|us)=(\d+)`)

func (t *Tools) Trim(ctx context.Context, in, out string, start, end float64, progress func(float64)) error {
	bin, err := t.need(media.FFmpeg)
	if err != nil {
		return err
	}
	args := []string{"-v", "error", "-nostdin", "-y"}
	if start > 0 {
		args = append(args, "-ss", secs(start))
	}
	args = append(args, "-i", in)
	length := 0.0
	if end > start {
		length = end - start
		args = append(args, "-t", secs(length))
	} else if p, err := t.Probe(ctx, in); err == nil && p.Duration > start {
		length = p.Duration - start
	}
	args = append(args, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", out)
	cmd := exec.CommandContext(ctx, bin, args...)
	var errb bytes.Buffer
	cmd.Stderr = &errb
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		if m := outTime.FindStringSubmatch(sc.Text()); m != nil && length > 0 && progress != nil {
			us, _ := strconv.ParseFloat(m[1], 64)
			progress(math.Min(1, us/1e6/length))
		}
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg: %s", lastLine(errb.String(), err))
	}
	return nil
}

var dlPercent = regexp.MustCompile(`^\[download\]\s+([\d.]+)%`)

// Format picks H.264 (plays everywhere) up to maxHeight, merged with m4a audio, falling back to any MP4 and then to
// anything at or below maxHeight.
func Format(maxHeight int) string {
	h := strconv.Itoa(maxHeight)
	return "bv*[height<=" + h + "][vcodec^=avc1]+ba[ext=m4a]/b[height<=" + h + "][ext=mp4]/bv*[height<=" + h + "][ext=mp4]+ba[ext=m4a]/bv*[height<=" + h + "]+ba/b[height<=" + h + "]"
}

func (t *Tools) Download(ctx context.Context, url, dir string, maxHeight int, progress func(float64)) (string, string, error) {
	bin, err := t.need(media.YTDLP)
	if err != nil {
		return "", "", err
	}
	args := []string{"--newline", "--no-playlist", "--no-mtime", "--write-info-json", "-f", Format(maxHeight), "--merge-output-format", "mp4",
		"-o", filepath.Join(dir, "download.%(ext)s")}
	if ff := t.Path(media.FFmpeg); ff != "" {
		args = append(args, "--ffmpeg-location", ff)
	}
	args = append(args, url)
	cmd := exec.CommandContext(ctx, bin, args...)
	var errb tail
	cmd.Stderr = &errb
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", "", err
	}
	if err := cmd.Start(); err != nil {
		return "", "", err
	}
	best := 0.0
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		if m := dlPercent.FindStringSubmatch(strings.TrimSpace(sc.Text())); m != nil {
			p, _ := strconv.ParseFloat(m[1], 64)
			// video and audio download one after the other; keep the bar from running backwards
			if p/100 > best {
				best = p / 100
				if progress != nil {
					progress(math.Min(1, best))
				}
			}
		}
	}
	if err := cmd.Wait(); err != nil {
		msg := errb.String()
		if i := strings.LastIndex(msg, "ERROR:"); i >= 0 {
			msg = msg[i:]
		}
		return "", "", fmt.Errorf("yt-dlp: %s", lastLine(msg, err))
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return "", "", err
	}
	var found string
	var size int64
	for _, e := range ents {
		n := e.Name()
		if e.IsDir() || !strings.HasPrefix(n, "download.") || strings.HasSuffix(n, ".part") || strings.HasSuffix(n, ".ytdl") || strings.HasSuffix(n, ".json") {
			continue
		}
		if info, err := e.Info(); err == nil && info.Size() > size {
			found, size = filepath.Join(dir, n), info.Size()
		}
	}
	if found == "" {
		return "", "", fmt.Errorf("yt-dlp finished without a file")
	}
	var info struct {
		Title string `json:"title"`
	}
	if b, err := os.ReadFile(filepath.Join(dir, "download.info.json")); err == nil {
		_ = json.Unmarshal(b, &info)
	}
	return found, strings.TrimSpace(info.Title), nil
}

// tail keeps the last 8 KB written to it.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 8192 {
		t.buf = t.buf[len(t.buf)-8192:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}
