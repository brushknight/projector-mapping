package assetsvc

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"projmap/internal/application/app_errors"
	assetssvc "projmap/internal/application/services/assets"
	"projmap/internal/domain/assets"
)

// decodeRate is the sample rate sounds are decoded at for their peaks.
const decodeRate = 8000

// UnsupportedSound answers a file that is not WAV, MP3, M4A, AIFF or OGG.
func UnsupportedSound() error {
	return app_errors.Unsupported("Upload a WAV, MP3, M4A, AIFF or OGG file.")
}

func (s *Service) UploadSound(ctx context.Context, data []byte, in assetssvc.SoundIn) (*assets.Asset, error) {
	if len(data) == 0 {
		return nil, app_errors.BadRequest("The upload is empty.")
	}
	if len(data) > assetssvc.MaxBytes {
		return nil, app_errors.BadRequest("The upload is larger than 64 MB.")
	}
	mime := SniffSound(data, in.FileName)
	if mime == "" {
		return nil, UnsupportedSound()
	}
	name := SoundName(in.Name, in.FileName)
	sha, err := s.blobs.Put(data)
	if err != nil {
		return nil, err
	}
	if a, err := s.repo.Get(ctx, sha); err == nil && a.Kind == assets.KindSound {
		return a, nil
	}
	a := &assets.Asset{SHA: sha, Mime: mime, Bytes: int64(len(data)), Kind: assets.KindSound, Name: name}
	d, peaks, ok := s.analyse(ctx, mime, data, sha)
	if !ok {
		d, peaks = 0, []float64{}
		if in.Duration != nil && *in.Duration >= 0 && !math.IsNaN(*in.Duration) && !math.IsInf(*in.Duration, 0) {
			d = *in.Duration
		}
		if in.Peaks != nil {
			peaks = clampPeaks(in.Peaks)
		}
	}
	a.SetSound(math.Round(d*1000)/1000, peaks)
	if err := s.repo.Save(ctx, a); err != nil {
		return nil, err
	}
	return a, nil
}

// analyse reads duration and peaks: WAV and AIFF in Go, the rest through ffmpeg (and ffprobe for the duration).
func (s *Service) analyse(ctx context.Context, mime string, data []byte, sha string) (float64, []float64, bool) {
	switch mime {
	case MimeWAV:
		if d, p, err := ReadWAV(data, assets.PeakCount); err == nil {
			return d, p, true
		}
	case MimeAIFF:
		if d, p, err := ReadAIFF(data, assets.PeakCount); err == nil {
			return d, p, true
		}
	}
	if s.media == nil {
		return 0, nil, false
	}
	path := s.blobs.Path(sha)
	cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	samples, err := s.media.DecodeMono(cctx, path, decodeRate)
	if err != nil || len(samples) == 0 {
		return 0, nil, false
	}
	d := float64(len(samples)) / decodeRate
	if p, err := s.media.Probe(cctx, path); err == nil && p.Duration > 0 {
		d = p.Duration
	}
	return d, PeaksOf(samples, assets.PeakCount), true
}

func clampPeaks(in []float64) []float64 {
	if len(in) > 4096 {
		in = in[:4096]
	}
	out := make([]float64, len(in))
	for i, v := range in {
		if math.IsNaN(v) {
			v = 0
		}
		out[i] = round3(math.Max(0, math.Min(1, math.Abs(v))))
	}
	return out
}

// SoundName is the given name, else the file name without its extension, trimmed to 80 characters.
func SoundName(name, fileName string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		base := filepath.Base(fileName)
		name = strings.TrimSpace(strings.TrimSuffix(base, filepath.Ext(base)))
	}
	if name == "" || name == "." {
		name = "sound"
	}
	if r := []rune(name); len(r) > 80 {
		name = string(r[:80])
	}
	return name
}

// Video mime types by first bytes (MP4, MOV, WebM).
func SniffVideo(head []byte) string {
	if len(head) >= 12 && string(head[4:8]) == "ftyp" {
		if string(head[8:10]) == "qt" {
			return "video/quicktime"
		}
		return "video/mp4"
	}
	if len(head) >= 8 && (string(head[4:8]) == "moov" || string(head[4:8]) == "mdat" || string(head[4:8]) == "wide" || string(head[4:8]) == "free") {
		return "video/quicktime"
	}
	if len(head) >= 4 && head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3 {
		return "video/webm"
	}
	return ""
}

func (s *Service) StoreVideo(ctx context.Context, path, name string) (*assets.Asset, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	head := make([]byte, 64)
	n, _ := f.Read(head)
	st, _ := f.Stat()
	f.Close()
	mime := SniffVideo(head[:n])
	if mime == "" {
		return nil, app_errors.Unsupported("Upload an MP4, MOV or WebM video.")
	}
	sha, err := s.blobs.PutFile(path)
	if err != nil {
		return nil, err
	}
	if a, err := s.repo.Get(ctx, sha); err == nil && a.Kind == assets.KindVideo {
		return a, nil
	}
	a := &assets.Asset{SHA: sha, Mime: mime, Kind: assets.KindVideo, Name: strings.TrimSpace(name)}
	if st != nil {
		a.Bytes = st.Size()
	}
	s.probeVideo(ctx, a)
	if err := s.repo.Save(ctx, a); err != nil {
		return nil, err
	}
	return a, nil
}

// probeVideo fills size and duration when ffprobe can read the file (a failure leaves them 0).
func (s *Service) probeVideo(ctx context.Context, a *assets.Asset) {
	if s.media == nil {
		return
	}
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if p, err := s.media.Probe(cctx, s.blobs.Path(a.SHA)); err == nil {
		a.Width, a.Height = p.Width, p.Height
		d := math.Round(p.Duration*1000) / 1000
		a.Duration = &d
	}
}

func (s *Service) VideoThumb(ctx context.Context, sha string, at float64) (string, error) {
	if s.media == nil {
		return "", app_errors.Unavailable("ffmpeg is not installed.")
	}
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	jpg, err := s.media.Frame(cctx, s.blobs.Path(sha), at, ThumbSize)
	if err != nil {
		return "", err
	}
	t, err := s.Upload(ctx, jpg, "thumb")
	if err != nil {
		return "", err
	}
	return t.SHA, nil
}

func (s *Service) List(ctx context.Context, kind string) ([]assets.Asset, error) {
	return s.repo.List(ctx, kind)
}

func (s *Service) Rename(ctx context.Context, sha, name string) (*assets.Asset, error) {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 80 {
		return nil, app_errors.BadRequest("A name needs 1 to 80 characters.")
	}
	if err := s.repo.Rename(ctx, sha, name); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, sha)
}

func (s *Service) Delete(ctx context.Context, sha string) error {
	a, err := s.repo.Get(ctx, sha)
	if err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, sha); err != nil {
		return err
	}
	if a.Thumb != nil {
		_ = s.repo.Delete(ctx, *a.Thumb)
		_ = s.blobs.Remove(*a.Thumb)
	}
	return s.blobs.Remove(sha)
}

func (s *Service) Path(sha string) string { return s.blobs.Path(sha) }
