// Package videosvc implements the video library (uploads, YouTube downloads and embeds) and the YouTube import jobs,
// with the videos and import:{id} channels (protocol §14).
package videosvc

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/media"
	"projmap/internal/application/ports/out/realtime"
	videorepo "projmap/internal/application/ports/repository/videos"
	"projmap/internal/application/services"
	assetssvc "projmap/internal/application/services/assets"
	videossvc "projmap/internal/application/services/videos"
	"projmap/internal/domain/videos"
)

// Channel carries the video list.
const Channel = "videos"

// ImportChannel carries one import job.
func ImportChannel(id string) string { return "import:" + id }

// keepJobs is how many finished jobs stay in memory.
const keepJobs = 50

// importTimeout bounds one download and trim.
const importTimeout = 45 * time.Minute

// Service implements VideoService.
type Service struct {
	repo   videorepo.VideoRepository
	assets assetssvc.AssetService
	media  media.Tools
	pub    realtime.Publisher
	log    *slog.Logger
	tmp    string
	now    func() time.Time

	mu   sync.Mutex
	jobs map[string]*job
	// order is the job ids, oldest first
	order []string
	wg    sync.WaitGroup
}

type job struct {
	videos.ImportJob
	seq int64
}

var _ videossvc.VideoService = (*Service)(nil)

// New makes the service; tmp is a folder on the data volume for downloads and uploads in progress.
func New(repo videorepo.VideoRepository, as assetssvc.AssetService, m media.Tools, pub realtime.Publisher, log *slog.Logger, tmp string) *Service {
	return &Service{repo: repo, assets: as, media: m, pub: pub, log: log, tmp: tmp, now: time.Now, jobs: map[string]*job{}}
}

// TempDir is where uploads and downloads land before they move into the store.
func (s *Service) TempDir() (string, error) {
	if err := os.MkdirAll(s.tmp, 0o755); err != nil {
		return "", err
	}
	return s.tmp, nil
}

// Wait blocks until running imports end (tests, shutdown).
func (s *Service) Wait() { s.wg.Wait() }

func (s *Service) List(ctx context.Context) ([]videos.Video, error) {
	l, err := s.repo.List(ctx)
	if l == nil {
		l = []videos.Video{}
	}
	return l, err
}

func (s *Service) Get(ctx context.Context, id string) (*videos.Video, error) {
	return s.repo.Get(ctx, id)
}

func (s *Service) publish(ctx context.Context) {
	l, err := s.List(ctx)
	if err != nil {
		return
	}
	s.pub.Publish(Channel, realtime.Message{T: "snapshot", Ch: Channel, V: realtime.Ver(s.now().UnixMilli()), D: realtime.Data(l)})
}

func cleanName(name, fallback string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = strings.TrimSpace(fallback)
	}
	if name == "" {
		name = "video"
	}
	if r := []rune(name); len(r) > 80 {
		name = string(r[:80])
	}
	return name
}

func (s *Service) Upload(ctx context.Context, path, fileName, name string) (*videos.Video, error) {
	base := filepath.Base(fileName)
	name = cleanName(name, strings.TrimSuffix(base, filepath.Ext(base)))
	a, err := s.assets.StoreVideo(ctx, path, name)
	if err != nil {
		return nil, err
	}
	v := &videos.Video{ID: services.NewID("vid"), Name: name, Ref: videos.AssetRef(a.SHA), Source: videos.SourceFile, SHA: a.SHA,
		Width: a.Width, Height: a.Height, CreatedAt: s.now().UTC()}
	if a.Duration != nil {
		v.Duration = *a.Duration
	}
	s.thumb(ctx, v, 0)
	if err := s.repo.Save(ctx, v); err != nil {
		return nil, err
	}
	s.publish(ctx)
	return v, nil
}

// thumb makes the video's JPEG thumb at seconds when ffmpeg can (a failure leaves it null).
func (s *Service) thumb(ctx context.Context, v *videos.Video, at float64) {
	if v.SHA == "" || s.media == nil || !s.media.Available(media.FFmpeg) {
		return
	}
	if v.Duration > 0 && at >= v.Duration {
		at = 0
	}
	sha, err := s.assets.VideoThumb(ctx, v.SHA, at)
	if err != nil {
		s.log.Info("video thumb", "video", v.ID, "err", err)
		return
	}
	v.Thumb = &sha
}

func (s *Service) Rename(ctx context.Context, id, name string) (*videos.Video, error) {
	v, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 80 {
		return nil, app_errors.BadRequest("A name needs 1 to 80 characters.")
	}
	v.Name = name
	if err := s.repo.Save(ctx, v); err != nil {
		return nil, err
	}
	s.publish(ctx)
	return v, nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	v, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	// the file goes with its last video
	if v.SHA != "" {
		if l, err := s.repo.List(ctx); err == nil && !uses(l, v.SHA) {
			if err := s.assets.Delete(ctx, v.SHA); err != nil && !isNotFound(err) {
				s.log.Warn("delete video file", "sha", v.SHA, "err", err)
			}
		}
	}
	if v.Thumb != nil {
		if l, err := s.repo.List(ctx); err == nil && !usesThumb(l, *v.Thumb) {
			_ = s.assets.Delete(ctx, *v.Thumb)
		}
	}
	s.publish(ctx)
	return nil
}

func uses(l []videos.Video, sha string) bool {
	for _, v := range l {
		if v.SHA == sha {
			return true
		}
	}
	return false
}

func usesThumb(l []videos.Video, sha string) bool {
	for _, v := range l {
		if v.Thumb != nil && *v.Thumb == sha {
			return true
		}
	}
	return false
}

func isNotFound(err error) bool { return app_errors.As(err).Code == "not_found" }

func (s *Service) Tools() videossvc.Tools {
	if s.media == nil {
		return videossvc.Tools{}
	}
	return videossvc.Tools{YTDLP: s.media.Available(media.YTDLP), FFmpeg: s.media.Available(media.FFmpeg)}
}

func (s *Service) Import(ctx context.Context, in videossvc.ImportIn) (*videos.ImportJob, error) {
	ytID := videos.YouTubeID(in.URL)
	if ytID == "" {
		return nil, app_errors.InvalidURL(videos.InvalidURLMessage)
	}
	if in.MaxHeight == 0 {
		in.MaxHeight = videos.DefaultMaxHeight
	}
	if !videos.ValidMaxHeight(in.MaxHeight) {
		return nil, app_errors.BadRequest("maxHeight must be one of 360, 480, 720, 1080, 1440, 2160.")
	}
	if math.IsNaN(in.Start) || math.IsNaN(in.End) {
		return nil, app_errors.BadRequest("start and end must be numbers.")
	}
	if err := videos.CheckTrim(in.Start, in.End); err != nil {
		return nil, app_errors.BadRequest("%s.", strings.ToUpper(err.Error()[:1])+err.Error()[1:])
	}
	j := &job{ImportJob: videos.ImportJob{ID: services.NewID("imp"), URL: strings.TrimSpace(in.URL), YouTubeID: ytID,
		Status: videos.StatusRunning, MaxHeight: in.MaxHeight, Start: in.Start, End: in.End, CreatedAt: s.now().UTC(),
		Name: strings.TrimSpace(in.Name)}}
	if s.media == nil || !s.media.Available(media.YTDLP) {
		j.Mode = videos.ModeEmbed
		v := &videos.Video{ID: services.NewID("vid"), Name: cleanName(j.Name, "youtube "+ytID), Ref: videos.YouTubeRef(ytID),
			Source: videos.SourceYouTube, URL: j.URL, YouTubeID: ytID, CreatedAt: s.now().UTC()}
		if in.End > 0 {
			v.Duration = in.End - in.Start
		}
		if err := s.repo.Save(ctx, v); err != nil {
			return nil, err
		}
		ref := v.Ref
		j.Status, j.Progress, j.Message, j.VideoID, j.Ref = videos.StatusDone, 1, videos.EmbedMessage, &v.ID, &ref
		s.add(j)
		s.publish(ctx)
		out := j.ImportJob
		return &out, nil
	}
	j.Mode, j.Message = videos.ModeDownload, "starting the download"
	s.add(j)
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.run(j.ID)
	}()
	out := j.ImportJob
	return &out, nil
}

func (s *Service) add(j *job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[j.ID] = j
	s.order = append(s.order, j.ID)
	// forget the oldest finished jobs beyond keepJobs
	for len(s.order) > keepJobs {
		old := s.jobs[s.order[0]]
		if old != nil && old.Status == videos.StatusRunning {
			break
		}
		delete(s.jobs, s.order[0])
		s.order = s.order[1:]
	}
}

func (s *Service) Job(id string) (*videos.ImportJob, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return nil, 0, app_errors.NotFound("Import %s does not exist.", id)
	}
	out := j.ImportJob
	return &out, j.seq, nil
}

func (s *Service) Jobs() []videos.ImportJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]videos.ImportJob, 0, len(s.order))
	for i := len(s.order) - 1; i >= 0; i-- {
		if j, ok := s.jobs[s.order[i]]; ok {
			out = append(out, j.ImportJob)
		}
	}
	return out
}

// update changes a job and publishes it on import:{id}.
func (s *Service) update(id string, f func(j *videos.ImportJob)) {
	s.mu.Lock()
	j, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return
	}
	f(&j.ImportJob)
	j.seq++
	snap := j.ImportJob
	seq := j.seq
	s.mu.Unlock()
	ch := ImportChannel(id)
	s.pub.Publish(ch, realtime.Message{T: "snapshot", Ch: ch, V: realtime.Ver(seq), D: realtime.Data(snap)})
}

func (s *Service) fail(id string, err error) {
	msg := err.Error()
	if len(msg) > 300 {
		msg = msg[:300] + "…"
	}
	s.log.Warn("youtube import failed", "job", id, "err", err)
	s.update(id, func(j *videos.ImportJob) { j.Status, j.Message = videos.StatusFailed, "The import failed: "+msg })
}

// run downloads, trims and stores one import.
func (s *Service) run(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), importTimeout)
	defer cancel()
	jp, _, err := s.Job(id)
	if err != nil {
		return
	}
	j := *jp
	root, err := s.TempDir()
	if err != nil {
		s.fail(id, err)
		return
	}
	dir, err := os.MkdirTemp(root, j.ID+"-")
	if err != nil {
		s.fail(id, err)
		return
	}
	defer os.RemoveAll(dir)
	last := -1
	file, title, err := s.media.Download(ctx, j.URL, dir, j.MaxHeight, func(p float64) {
		pct := int(p * 100)
		if pct == last {
			return
		}
		last = pct
		s.update(id, func(j *videos.ImportJob) { j.Progress, j.Message = round3(0.8*p), fmt.Sprintf("downloading %d%%", pct) })
	})
	if err != nil {
		s.fail(id, err)
		return
	}
	if j.Start > 0 || j.End > 0 {
		if !s.media.Available(media.FFmpeg) {
			s.fail(id, fmt.Errorf("ffmpeg is not installed, so the server cannot trim the download. Install it with brew install ffmpeg, or import without start and end"))
			return
		}
		s.update(id, func(j *videos.ImportJob) { j.Progress, j.Message = 0.8, "trimming" })
		out := filepath.Join(dir, "trimmed.mp4")
		if err := s.media.Trim(ctx, file, out, j.Start, j.End, func(p float64) {
			s.update(id, func(j *videos.ImportJob) { j.Progress = round3(0.8 + 0.15*p) })
		}); err != nil {
			s.fail(id, err)
			return
		}
		file = out
	}
	s.update(id, func(j *videos.ImportJob) { j.Progress, j.Message = 0.95, "storing" })
	name := cleanName(j.Name, title)
	if name == "video" {
		name = "youtube " + j.YouTubeID
	}
	a, err := s.assets.StoreVideo(ctx, file, name)
	if err != nil {
		s.fail(id, err)
		return
	}
	v := &videos.Video{ID: services.NewID("vid"), Name: name, Ref: videos.AssetRef(a.SHA), Source: videos.SourceYouTube, URL: j.URL,
		YouTubeID: j.YouTubeID, SHA: a.SHA, Width: a.Width, Height: a.Height, CreatedAt: s.now().UTC()}
	if a.Duration != nil {
		v.Duration = *a.Duration
	}
	s.thumb(ctx, v, 0)
	if err := s.repo.Save(ctx, v); err != nil {
		s.fail(id, err)
		return
	}
	s.publish(ctx)
	ref := v.Ref
	s.update(id, func(j *videos.ImportJob) {
		j.Status, j.Progress, j.Message, j.VideoID, j.Ref = videos.StatusDone, 1, "done", &v.ID, &ref
	})
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }
