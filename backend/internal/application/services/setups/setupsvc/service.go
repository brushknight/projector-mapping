// Package setupsvc implements the setups section.
package setupsvc

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	jsonpatch "github.com/evanphx/json-patch/v5"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	setuprepo "projmap/internal/application/ports/repository/setups"
	"projmap/internal/application/services"
	setupssvc "projmap/internal/application/services/setups"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/setup"
)

// Channel is a setup's realtime channel.
func Channel(id string) string { return "setup:" + id }

// Service implements SetupService. Setups change rarely, so one mutex serializes writes.
type Service struct {
	repo setuprepo.SetupRepository
	pub  realtime.Publisher
	log  *slog.Logger

	mu     sync.Mutex
	params map[string]*services.Coalescer
	timers map[string]*time.Timer
	// Now is the clock (tests move it).
	Now func() time.Time
	// InUse tells whether a scene uses the setup (blocks delete).
	InUse func(ctx context.Context, id string) bool
}

var _ setupssvc.SetupService = (*Service)(nil)

// New makes the service.
func New(repo setuprepo.SetupRepository, pub realtime.Publisher, log *slog.Logger) *Service {
	return &Service{repo: repo, pub: pub, log: log, params: map[string]*services.Coalescer{}, timers: map[string]*time.Timer{}, Now: time.Now}
}

func (s *Service) List(ctx context.Context) ([]setup.Setup, error) { return s.repo.List(ctx) }

func (s *Service) Get(ctx context.Context, id string) (*setup.Setup, int64, error) {
	return s.repo.Get(ctx, id)
}

func (s *Service) Create(ctx context.Context, in setup.Setup) (*setup.Setup, error) {
	d := setup.Default(services.NewID("set"), strings.TrimSpace(in.Name))
	if d.Name == "" {
		return nil, app_errors.BadRequest("A setup needs a name.")
	}
	if in.Output.Width > 0 {
		d.Output = in.Output
	}
	if d.Output.Orientation == "" {
		d.Output.Orientation = setup.Landscape
	}
	if in.ID != "" {
		d.ID = in.ID
	}
	if err := d.Validate(); err != nil {
		return nil, app_errors.Invalid("%s", err.Error())
	}
	if err := s.repo.Save(ctx, &d, 1); err != nil {
		return nil, err
	}
	return &d, nil
}

// patternChange says whether a write sets testPattern (so its 60 s start again) and for how long.
type patternChange struct {
	touched bool
	seconds int
}

// commit validates and stores doc as the setup's next version; callers hold mu. A write that sets the test pattern
// (re)starts its timer; testPatternUntil itself is the server's to set.
func (s *Service) commit(ctx context.Context, id string, prev *setup.Setup, doc []byte, version int64, pc patternChange) (*setup.Setup, error) {
	var next setup.Setup
	if err := json.Unmarshal(doc, &next); err != nil {
		return nil, app_errors.Invalid("The change makes an invalid setup: %v", err)
	}
	if next.ID != id {
		return nil, app_errors.BadRequest("A setup's id cannot change.")
	}
	if err := next.Validate(); err != nil {
		return nil, app_errors.Invalid("%s", err.Error())
	}
	switch {
	case next.TestPattern == "off":
		next.TestPatternUntil = nil
	case pc.touched || prev == nil || prev.TestPattern != next.TestPattern || prev.TestPatternUntil == nil:
		secs := pc.seconds
		if secs <= 0 {
			secs = setup.TestPatternDefault
		}
		if secs > setup.TestPatternMax {
			secs = setup.TestPatternMax
		}
		until := s.Now().Add(time.Duration(secs) * time.Second).UnixNano()
		next.TestPatternUntil = &until
	default:
		next.TestPatternUntil = prev.TestPatternUntil
	}
	if err := s.repo.Save(ctx, &next, version); err != nil {
		return nil, err
	}
	s.schedule(&next)
	return &next, nil
}

// schedule arms (or drops) the timer that turns the setup's test pattern off; callers hold mu.
func (s *Service) schedule(set *setup.Setup) {
	if t, ok := s.timers[set.ID]; ok {
		t.Stop()
		delete(s.timers, set.ID)
	}
	if set.TestPattern == "off" || set.TestPatternUntil == nil {
		return
	}
	id, until := set.ID, *set.TestPatternUntil
	wait := time.Duration(until - s.Now().UnixNano())
	if wait < 0 {
		wait = 0
	}
	s.timers[id] = time.AfterFunc(wait, func() { s.expire(id, until) })
}

// expire turns the pattern off when its deadline (still `until`, so not renewed) has passed.
func (s *Service) expire(id string, until int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx := context.Background()
	cur, v, err := s.repo.Get(ctx, id)
	if err != nil || cur.TestPattern == "off" || cur.TestPatternUntil == nil || *cur.TestPatternUntil != until {
		return
	}
	if s.Now().UnixNano() < until {
		s.schedule(cur)
		return
	}
	next := *cur
	next.TestPattern, next.TestPatternUntil = "off", nil
	if err := s.repo.Save(ctx, &next, v+1); err != nil {
		s.log.Warn("test pattern expiry failed", "setup", id, "err", err)
		return
	}
	delete(s.timers, id)
	s.log.Info("test pattern expired", "setup", id, "pattern", cur.TestPattern)
	s.pub.Publish(Channel(id), realtime.Message{T: "patched", Ch: Channel(id), V: realtime.Ver(v + 1),
		D: realtime.Data(map[string]any{"ops": []docpatch.Op{docpatch.Replace("/testPattern", "off"), docpatch.Replace("/testPatternUntil", nil)}, "by": "server"})})
}

func (s *Service) SetTestPattern(ctx context.Context, id, pattern string, seconds int, by string) (*setup.Setup, error) {
	if seconds < 0 || seconds > setup.TestPatternMax {
		return nil, app_errors.BadRequest("seconds must be 1..%d.", setup.TestPatternMax)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, v, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	next := *cur
	next.TestPattern = pattern
	b, _ := json.Marshal(next)
	set, err := s.commit(ctx, id, cur, b, v+1, patternChange{touched: true, seconds: seconds})
	if err != nil {
		return nil, err
	}
	s.snapshot(set, v+1)
	return set, nil
}

func (s *Service) ExpireTestPatterns(ctx context.Context) error {
	list, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	for i := range list {
		set := list[i]
		if set.TestPattern == "off" {
			continue
		}
		if set.TestPatternUntil == nil {
			// a pattern from before expiry existed: give it one period, then off
			if _, err := s.SetTestPattern(ctx, set.ID, set.TestPattern, 0, "server"); err != nil {
				return err
			}
			continue
		}
		s.mu.Lock()
		s.schedule(&set)
		s.mu.Unlock()
	}
	return nil
}

func (s *Service) snapshot(set *setup.Setup, v int64) {
	s.pub.Publish(Channel(set.ID), realtime.Message{T: "snapshot", Ch: Channel(set.ID), V: realtime.Ver(v), D: realtime.Data(set)})
}

func (s *Service) Merge(ctx context.Context, id string, partial json.RawMessage, by string) (*setup.Setup, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, v, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	b, _ := json.Marshal(cur)
	merged, err := jsonpatch.MergePatch(b, partial)
	if err != nil {
		return nil, app_errors.BadRequest("The body must be a partial setup object: %v", err)
	}
	var keys map[string]json.RawMessage
	_ = json.Unmarshal(partial, &keys)
	_, touched := keys["testPattern"]
	next, err := s.commit(ctx, id, cur, merged, v+1, patternChange{touched: touched})
	if err != nil {
		return nil, err
	}
	s.snapshot(next, v+1)
	return next, nil
}

func (s *Service) Patch(ctx context.Context, id string, base int64, ops []docpatch.Op, by, re string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, v, err := s.repo.Get(ctx, id)
	if err != nil {
		return 0, err
	}
	b, _ := json.Marshal(cur)
	if base != v && !docpatch.LeafOnly(b, ops) {
		return v, app_errors.Stale(v)
	}
	doc, err := docpatch.ApplyPlain(b, ops)
	if err != nil {
		return v, app_errors.Invalid("The patch does not apply: %v", err)
	}
	touched := false
	for _, op := range ops {
		touched = touched || op.Path == "/testPattern"
	}
	next, err := s.commit(ctx, id, cur, doc, v+1, patternChange{touched: touched})
	if err != nil {
		return v, err
	}
	out := ops
	if touched {
		// the server owns the deadline: tell every client what it became
		out = append(append([]docpatch.Op{}, ops...), docpatch.Replace("/testPatternUntil", next.TestPatternUntil))
	}
	s.pub.Publish(Channel(id), realtime.Message{T: "patched", Ch: Channel(id), V: realtime.Ver(v + 1), Re: re,
		D: realtime.Data(map[string]any{"ops": out, "by": by})})
	return v + 1, nil
}

func (s *Service) Param(ctx context.Context, id, path string, value json.RawMessage, by, conn string) error {
	if _, _, err := s.repo.Get(ctx, id); err != nil {
		return err
	}
	s.pub.PublishExcept(Channel(id), realtime.Message{T: "param", Ch: Channel(id),
		D: realtime.Data(map[string]any{"path": path, "value": value, "by": by})}, conn)
	s.mu.Lock()
	c, ok := s.params[id]
	if !ok {
		c = services.NewCoalescer(services.ParamDelay, func(p string, v json.RawMessage, who string) {
			_, v2, _ := s.repo.Get(context.Background(), id)
			if _, err := s.Patch(context.Background(), id, v2, []docpatch.Op{{Op: "replace", Path: p, Value: v}}, who, ""); err != nil {
				s.log.Warn("setup param commit failed", "setup", id, "path", p, "err", err)
				if cur, ver, err := s.repo.Get(context.Background(), id); err == nil {
					s.snapshot(cur, ver)
				}
			}
		})
		s.params[id] = c
	}
	s.mu.Unlock()
	c.Put(path, value, by)
	return nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	if s.InUse != nil && s.InUse(ctx, id) {
		return app_errors.Conflict("Setup %s is used by a scene; delete or move those scenes first.", id)
	}
	return s.repo.Delete(ctx, id)
}
