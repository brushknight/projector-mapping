// Package scenesvc implements the scenes section: one goroutine per open scene owns its document, so patches, params,
// undo and redo are serialized without locks; drafts and presets go through the same actors.
package scenesvc

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	scenerepo "projmap/internal/application/ports/repository/scenes"
	"projmap/internal/application/services"
	scenessvc "projmap/internal/application/services/scenes"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
)

// Channel is a scene's realtime channel.
func Channel(id string) string { return "scene:" + id }

// Service implements SceneService.
type Service struct {
	repo  scenerepo.SceneRepository
	refs  scene.Refs
	pub   realtime.Publisher
	log   *slog.Logger
	now   func() time.Time
	delay time.Duration

	mu     sync.Mutex
	actors map[string]*actor
}

var _ scenessvc.SceneService = (*Service)(nil)

// New makes the service.
func New(repo scenerepo.SceneRepository, refs scene.Refs, pub realtime.Publisher, log *slog.Logger) *Service {
	return &Service{repo: repo, refs: refs, pub: pub, log: log, now: time.Now, delay: services.ParamDelay, actors: map[string]*actor{}}
}

// SetParamDelay changes the param commit delay (tests).
func (s *Service) SetParamDelay(d time.Duration) { s.delay = d }

// entry is one undoable change.
type entry struct {
	ops, inverse []docpatch.Op
}

type actor struct {
	svc     *Service
	id      string
	inbox   chan func()
	doc     []byte
	version int64
	name    string
	undo    []entry
	redo    []entry
	params  *services.Coalescer
	closed  bool
}

// actorFor loads (once) the scene's actor.
func (s *Service) actorFor(ctx context.Context, id string) (*actor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a, ok := s.actors[id]; ok {
		return a, nil
	}
	doc, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	sc, err := scene.Decode(doc)
	if err != nil {
		return nil, err
	}
	a := &actor{svc: s, id: id, inbox: make(chan func(), 64), doc: sc.Encode(), version: sc.Version, name: sc.Name}
	a.params = services.NewCoalescer(s.delay, func(path string, v json.RawMessage, by string) {
		a.inbox <- func() { a.commitParam(path, v, by) }
	})
	s.actors[id] = a
	go a.loop()
	return a, nil
}

func (a *actor) loop() {
	for f := range a.inbox {
		f()
	}
}

// run executes f on the actor's goroutine and waits.
func (a *actor) run(ctx context.Context, f func()) error {
	done := make(chan struct{})
	select {
	case a.inbox <- func() { f(); close(done) }:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) List(ctx context.Context) ([]scene.Summary, error) {
	// commits write through to the repository, so the stored list is current
	return s.repo.List(ctx)
}

// UpgradeStored rewrites every stored scene that still has the pre-mode backdrop (protocol §1 "Upgrade of older
// documents") and reports how many it changed. It runs once on start, before any scene is opened.
func (s *Service) UpgradeStored(ctx context.Context) (int, error) {
	list, err := s.repo.List(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, sum := range list {
		doc, err := s.repo.Get(ctx, sum.ID)
		if err != nil {
			return n, err
		}
		next, changed, err := scene.Upgrade(doc)
		if err != nil {
			s.log.Warn("scene upgrade failed", "scene", sum.ID, "err", err)
			continue
		}
		if !changed {
			continue
		}
		sc, err := scene.Decode(next)
		if err != nil {
			s.log.Warn("scene upgrade failed", "scene", sum.ID, "err", err)
			continue
		}
		if err := s.repo.Rewrite(ctx, sum.ID, sc.Encode()); err != nil {
			return n, err
		}
		s.log.Info("upgraded scene to per-mode backdrops", "scene", sum.ID, "mode", sc.Mode)
		n++
	}
	return n, nil
}

func (s *Service) Get(ctx context.Context, id string) ([]byte, int64, error) {
	a, err := s.actorFor(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	var doc []byte
	var v int64
	err = a.run(ctx, func() { doc, v = a.doc, a.version })
	return doc, v, err
}

func (s *Service) Scene(ctx context.Context, id string) (*scene.Scene, error) {
	doc, _, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return scene.Decode(doc)
}

func (s *Service) Validate(sc *scene.Scene) error {
	if err := sc.Validate(s.refs); err != nil {
		return app_errors.Invalid("%s", err.Error())
	}
	return nil
}

func (s *Service) Create(ctx context.Context, name, setupID string) (*scene.Scene, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, app_errors.BadRequest("A scene needs a name.")
	}
	if setupID == "" {
		return nil, app_errors.BadRequest("A scene needs a setupId.")
	}
	sc := scene.New(services.NewID("scn"), setupID, name)
	if err := s.repo.Create(ctx, &sc); err != nil {
		return nil, err
	}
	return &sc, nil
}

func (s *Service) Import(ctx context.Context, sc *scene.Scene) error {
	if sc.ID == "" {
		sc.ID = services.NewID("scn")
	}
	if sc.Version < 1 {
		sc.Version = 1
	}
	sc.Normalize()
	if err := s.Validate(sc); err != nil {
		return err
	}
	return s.repo.Create(ctx, sc)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.mu.Lock()
	if a, ok := s.actors[id]; ok {
		delete(s.actors, id)
		a.inbox <- func() { a.closed = true }
	}
	s.mu.Unlock()
	return nil
}

// guard refuses ops on the document's identity.
func guard(ops []docpatch.Op) error {
	if len(ops) == 0 {
		return app_errors.BadRequest("A patch needs at least one op.")
	}
	for _, op := range ops {
		switch op.Op {
		case "add", "remove", "replace", "move", "copy", "test":
		default:
			return app_errors.BadRequest("Op %q is not a JSON Patch op.", op.Op)
		}
		for _, p := range []string{op.Path, op.From} {
			if p == "/id" || p == "/version" || p == "/setupId" || (op.Path == "" && op.Op != "test") {
				return app_errors.BadRequest("Patches cannot change %s.", map[bool]string{true: "the whole document", false: p}[p == ""])
			}
		}
	}
	return nil
}

// commit applies ops on the actor goroutine, validates, stores and broadcasts. Callers hold the actor.
func (a *actor) commit(ctx context.Context, ops []docpatch.Op, by, re string) (entry, error) {
	if a.closed {
		return entry{}, app_errors.NotFound("Scene %s does not exist.", a.id)
	}
	next, inverse, err := docpatch.Apply(a.doc, ops)
	if err != nil {
		return entry{}, app_errors.Invalid("The patch does not apply: %v", err)
	}
	sc, err := scene.Decode(next)
	if err != nil {
		return entry{}, app_errors.Invalid("The patch makes an invalid scene: %v", err)
	}
	sc.Version = a.version + 1
	if err := a.svc.Validate(sc); err != nil {
		return entry{}, err
	}
	doc := sc.Encode()
	he := scene.HistoryEntry{Version: sc.Version, Author: by, TS: a.svc.now().UTC(), Ops: ops, Inverse: inverse}
	if err := a.svc.repo.Commit(ctx, a.id, doc, sc.Name, he); err != nil {
		return entry{}, err
	}
	a.doc, a.version, a.name = doc, sc.Version, sc.Name
	a.svc.pub.Publish(Channel(a.id), realtime.Message{T: "patched", Ch: Channel(a.id), V: realtime.Ver(a.version), Re: re,
		D: realtime.Data(map[string]any{"ops": ops, "by": by})})
	return entry{ops: ops, inverse: inverse}, nil
}

// resync sends the current document to every subscriber (after a param that could not be committed).
func (a *actor) resync() {
	a.svc.pub.Publish(Channel(a.id), realtime.Message{T: "snapshot", Ch: Channel(a.id), V: realtime.Ver(a.version), D: a.doc})
}

func (s *Service) Patch(ctx context.Context, cmd scenessvc.PatchCmd) (int64, error) {
	if err := guard(cmd.Ops); err != nil {
		return 0, err
	}
	a, err := s.actorFor(ctx, cmd.SceneID)
	if err != nil {
		return 0, err
	}
	var v int64
	var cerr error
	err = a.run(ctx, func() {
		if cmd.Base != a.version && !docpatch.LeafOnly(a.doc, cmd.Ops) {
			cerr = app_errors.Stale(a.version)
			return
		}
		var e entry
		if e, cerr = a.commit(ctx, cmd.Ops, cmd.By, cmd.Re); cerr == nil {
			a.undo = append(a.undo, e)
			if len(a.undo) > 200 {
				a.undo = a.undo[1:]
			}
			a.redo = nil
		}
		v = a.version
	})
	if err != nil {
		return 0, err
	}
	return v, cerr
}

func (s *Service) Param(ctx context.Context, cmd scenessvc.ParamCmd) error {
	if !strings.HasPrefix(cmd.Path, "/") || cmd.Path == "/id" || cmd.Path == "/version" || cmd.Path == "/setupId" {
		return app_errors.BadRequest("Param path %q is not a JSON Pointer into the scene.", cmd.Path)
	}
	a, err := s.actorFor(ctx, cmd.SceneID)
	if err != nil {
		return err
	}
	s.pub.PublishExcept(Channel(cmd.SceneID), realtime.Message{T: "param", Ch: Channel(cmd.SceneID),
		D: realtime.Data(map[string]any{"path": cmd.Path, "value": cmd.Value, "by": cmd.By})}, cmd.Conn)
	a.params.Put(cmd.Path, cmd.Value, cmd.By)
	return nil
}

// commitParam runs on the actor goroutine 200 ms after the last param on path.
func (a *actor) commitParam(path string, v json.RawMessage, by string) {
	if a.closed {
		return
	}
	op := docpatch.Op{Op: "replace", Path: path, Value: v}
	if cur, err := docpatch.GetRaw(a.doc, path); err == nil {
		if b, _ := json.Marshal(cur); string(b) == string(v) {
			return
		}
	}
	e, err := a.commit(context.Background(), []docpatch.Op{op}, by, "")
	if err != nil {
		a.svc.log.Warn("param commit failed", "scene", a.id, "path", path, "err", err)
		a.resync()
		return
	}
	a.undo = append(a.undo, e)
	a.redo = nil
}

func (s *Service) Undo(ctx context.Context, id, by string) (int64, error) {
	return s.step(ctx, id, by, true)
}

func (s *Service) Redo(ctx context.Context, id, by string) (int64, error) {
	return s.step(ctx, id, by, false)
}

func (s *Service) step(ctx context.Context, id, by string, undo bool) (int64, error) {
	a, err := s.actorFor(ctx, id)
	if err != nil {
		return 0, err
	}
	a.params.FlushAll()
	var v int64
	var cerr error
	err = a.run(ctx, func() {
		stack := &a.redo
		if undo {
			stack = &a.undo
		}
		if len(*stack) == 0 {
			cerr = app_errors.Conflict("There is nothing to %s.", map[bool]string{true: "undo", false: "redo"}[undo])
			v = a.version
			return
		}
		e := (*stack)[len(*stack)-1]
		ops, label := e.ops, "redo"
		if undo {
			ops, label = e.inverse, "undo"
		}
		var done entry
		if done, cerr = a.commit(ctx, ops, by+" ("+label+")", ""); cerr != nil {
			cerr = app_errors.Conflict("The scene changed too much to %s that step.", label)
			v = a.version
			return
		}
		*stack = (*stack)[:len(*stack)-1]
		if undo {
			a.redo = append(a.redo, entry{ops: e.ops, inverse: done.ops})
		} else {
			a.undo = append(a.undo, entry{ops: done.ops, inverse: done.inverse})
		}
		v = a.version
	})
	if err != nil {
		return 0, err
	}
	return v, cerr
}

func (s *Service) History(ctx context.Context, id string, limit int) ([]scene.HistoryEntry, error) {
	if _, err := s.actorFor(ctx, id); err != nil {
		return nil, err
	}
	return s.repo.History(ctx, id, limit)
}

// commitRebase applies a draft's ops onto the current document, ignoring the base (drafts rebase when they can).
func (s *Service) commitRebase(ctx context.Context, id string, ops []docpatch.Op, by string) (int64, error) {
	if err := guard(ops); err != nil {
		return 0, err
	}
	a, err := s.actorFor(ctx, id)
	if err != nil {
		return 0, err
	}
	var v int64
	var cerr error
	err = a.run(ctx, func() {
		var e entry
		if e, cerr = a.commit(ctx, ops, by, ""); cerr == nil {
			a.undo = append(a.undo, e)
			a.redo = nil
		}
		v = a.version
	})
	if err != nil {
		return 0, err
	}
	return v, cerr
}
