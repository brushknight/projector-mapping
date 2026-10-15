// Package scenesvc implements the scenes section: one goroutine per open scene owns its document, so patches, params,
// undo and redo are serialized without locks; drafts and presets go through the same actors.
package scenesvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	scenerepo "projmap/internal/application/ports/repository/scenes"
	"projmap/internal/application/services"
	scenessvc "projmap/internal/application/services/scenes"
	"projmap/internal/domain/catalog"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
)

// Channel is a scene's realtime channel.
func Channel(id string) string { return "scene:" + id }

// ListChannel carries the scene list (protocol §14): a snapshot on every create, delete and rename.
const ListChannel = "scenes"

// MaxNameLen is the longest scene name in characters.
const MaxNameLen = 80

// CleanName trims a scene name and checks its length.
func CleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > MaxNameLen {
		return "", app_errors.BadRequest("A scene name needs 1 to %d characters.", MaxNameLen)
	}
	return name, nil
}

// publishList sends the scene list on the scenes channel (summaries with kind and mode, protocol §15).
func (s *Service) publishList(ctx context.Context) {
	l, err := s.repo.List(ctx)
	if err != nil {
		s.log.Warn("scene list", "err", err)
		return
	}
	if l == nil {
		l = []scene.Summary{}
	}
	s.pub.Publish(ListChannel, realtime.Message{T: "snapshot", Ch: ListChannel, V: realtime.Ver(s.now().UnixMilli()), D: realtime.Data(l)})
}

// Service implements SceneService.
type Service struct {
	repo  scenerepo.SceneRepository
	refs  scene.Refs
	cat   *catalog.Catalog
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

// UseCatalog gives the service the catalog that scene templates are built from.
func (s *Service) UseCatalog(c *catalog.Catalog) { s.cat = c }

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
	// kind and mode as last listed: a change republishes the scene list
	kind, mode string
	undo       []entry
	redo       []entry
	params     *services.Coalescer
	closed     bool
	// paramIDs is the point id each pending /points/{i}/… param addressed when it arrived (the commit tests it)
	paramIDs map[string]string
	// liveSent are detail points whose live (uncommitted) positions went out as params while a face was dragged
	liveSent map[string]bool
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
	a := &actor{svc: s, id: id, inbox: make(chan func(), 64), doc: sc.Encode(), version: sc.Version, name: sc.Name, kind: sc.Kind, mode: sc.Mode,
		paramIDs: map[string]string{}, liveSent: map[string]bool{}}
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

// UpgradeStored rewrites every stored scene that is not in the current format (protocol §1 "Upgrade of older
// documents", protocol §15 "Upgrade": gobo layers become attachments, scenes get a kind; protocol §16 "Migration":
// removed attachments move to their plates and brightness scales once, each move logged) and fills the list's kind
// and mode columns; it reports how many it changed. It runs once on start, before any scene is opened.
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
		next, notes, changed, err := scene.UpgradeNotes(doc)
		if err != nil {
			s.log.Warn("scene upgrade failed", "scene", sum.ID, "err", err)
			continue
		}
		if !changed && sum.Kind != "" && sum.Mode != "" {
			continue
		}
		sc, err := scene.Decode(next)
		if err != nil {
			s.log.Warn("scene upgrade failed", "scene", sum.ID, "err", err)
			continue
		}
		if err := s.repo.Rewrite(ctx, sum.ID, sc.Encode(), sc.Summary()); err != nil {
			return n, err
		}
		if changed {
			s.log.Info("upgraded scene", "scene", sum.ID, "kind", sc.Kind, "mode", sc.Mode)
		}
		// (protocol §16) every attachment that moved to a plate, and the brightness scaling, gets its own line
		for _, note := range notes {
			s.log.Info("upgraded scene to the plate library", "scene", sum.ID, "change", note)
		}
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

func (s *Service) Create(ctx context.Context, in scenessvc.CreateIn) (*scene.Scene, error) {
	name, err := CleanName(in.Name)
	if err != nil {
		return nil, err
	}
	if in.SetupID == "" {
		return nil, app_errors.BadRequest("A scene needs a setupId.")
	}
	id := services.NewID("scn")
	sc := scene.New(id, in.SetupID, name)
	sc.Normalize()
	if in.Kind != "" && !scene.Kinds[in.Kind] {
		return nil, app_errors.BadRequest("kind %q is not one of static, live, color, scenery, mapping.", in.Kind)
	}
	tpl := in.Template
	if tpl == "" && in.Kind != "" && s.cat != nil {
		if t := s.cat.DefaultTemplate(in.Kind); t != nil {
			tpl = t.ID
		} else {
			sc.Kind, sc.Mode = in.Kind, scene.KindMode(in.Kind)
		}
	}
	if tpl != "" {
		if s.cat == nil || s.cat.SceneTemplate(tpl) == nil {
			return nil, app_errors.BadRequest("template %q is not a sceneTemplates id of the catalog.", tpl)
		}
		if sc, err = scene.FromTemplate(s.cat, tpl, id, in.SetupID, name); err != nil {
			return nil, app_errors.Invalid("%s", err.Error())
		}
		if err := s.Validate(&sc); err != nil {
			return nil, err
		}
	}
	if err := s.repo.Create(ctx, &sc); err != nil {
		return nil, err
	}
	s.publishList(ctx)
	return &sc, nil
}

func (s *Service) Duplicate(ctx context.Context, srcID, name string) (*scene.Scene, error) {
	name, err := CleanName(name)
	if err != nil {
		return nil, err
	}
	src, err := s.Scene(ctx, srcID)
	if err != nil {
		return nil, err
	}
	src.ID, src.Version, src.Name = services.NewID("scn"), 1, name
	src.Normalize()
	if err := s.repo.Create(ctx, src); err != nil {
		return nil, err
	}
	s.publishList(ctx)
	return src, nil
}

func (s *Service) Rename(ctx context.Context, id, name, by string) (scene.Summary, error) {
	name, err := CleanName(name)
	if err != nil {
		return scene.Summary{}, err
	}
	v, err := s.Patch(ctx, scenessvc.PatchCmd{SceneID: id, Ops: []docpatch.Op{docpatch.Replace("/name", name)}, By: by})
	if err != nil {
		return scene.Summary{}, err
	}
	sc, err := s.Scene(ctx, id)
	if err != nil {
		return scene.Summary{}, err
	}
	sum := sc.Summary()
	sum.Version = v
	return sum, nil
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
	if err := s.repo.Create(ctx, sc); err != nil {
		return err
	}
	s.publishList(ctx)
	return nil
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
	s.publishList(ctx)
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
		if errors.Is(err, docpatch.ErrTestFailed) {
			return entry{}, app_errors.Stale(a.version)
		}
		return entry{}, app_errors.Invalid("The patch does not apply: %v", err)
	}
	sc, err := scene.Decode(next)
	if err != nil {
		return entry{}, app_errors.Invalid("The patch makes an invalid scene: %v", err)
	}
	// detail surfaces follow their face: points that moved bring the details' own points along, in the same patch
	if touchesPoints(ops) {
		if old, derr := scene.Decode(a.doc); derr == nil {
			if extra := scene.FollowOps(sc, scene.FollowDetails(old, sc)); len(extra) > 0 {
				all := append(append([]docpatch.Op{}, ops...), extra...)
				if n2, inv2, e2 := docpatch.Apply(a.doc, all); e2 == nil {
					if sc2, e3 := scene.Decode(n2); e3 == nil {
						ops, next, inverse, sc = all, n2, inv2, sc2
					}
				}
			}
		}
	}
	a.liveSent = map[string]bool{}
	sc.Version = a.version + 1
	if n := len([]rune(strings.TrimSpace(sc.Name))); sc.Name != a.name && (n < 1 || n > MaxNameLen) {
		return entry{}, app_errors.Invalid("A scene name needs 1 to %d characters.", MaxNameLen)
	}
	if err := a.svc.Validate(sc); err != nil {
		return entry{}, err
	}
	doc := sc.Encode()
	he := scene.HistoryEntry{Version: sc.Version, Author: by, TS: a.svc.now().UTC(), Ops: ops, Inverse: inverse}
	if err := a.svc.repo.Commit(ctx, a.id, doc, sc.Summary(), he); err != nil {
		return entry{}, err
	}
	renamed := a.name != sc.Name || a.kind != sc.Kind || a.mode != sc.Mode
	a.doc, a.version, a.name, a.kind, a.mode = doc, sc.Version, sc.Name, sc.Kind, sc.Mode
	a.svc.pub.Publish(Channel(a.id), realtime.Message{T: "patched", Ch: Channel(a.id), V: realtime.Ver(a.version), Re: re,
		D: realtime.Data(map[string]any{"ops": ops, "by": by})})
	if renamed {
		a.svc.publishList(ctx)
	}
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
		// a drag's pending values land first, on the indexes they were sent for, so a structural patch (a magnet
		// weld removing a point) cannot shift them onto another point
		a.commitPending()
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
	var perr error
	err = a.run(ctx, func() { perr = a.param(cmd) })
	if err != nil {
		return err
	}
	return perr
}

// param checks a continuous value against the document, forwards it, remembers it for the commit and sends the
// live positions of detail points that follow a dragged face. Runs on the actor goroutine.
func (a *actor) param(cmd scenessvc.ParamCmd) error {
	if a.closed {
		return app_errors.NotFound("Scene %s does not exist.", a.id)
	}
	idx, field, isPoint := pointPath(cmd.Path)
	var cur *scene.Scene
	if isPoint {
		sc, err := scene.Decode(a.doc)
		if err != nil {
			return app_errors.Invalid("%v", err)
		}
		cur = sc
		if idx >= len(sc.Points) {
			a.resync()
			return app_errors.Mismatch("Point %d does not exist in scene %s; take a fresh snapshot.", idx, a.id)
		}
		if got := sc.Points[idx].ID; cmd.PointID != "" && got != cmd.PointID {
			a.resync()
			return app_errors.Mismatch("Point %d of scene %s is %s, not %s; take a fresh snapshot.", idx, a.id, got, cmd.PointID)
		}
		a.paramIDs[cmd.Path] = sc.Points[idx].ID
	}
	d := map[string]any{"path": cmd.Path, "value": cmd.Value, "by": cmd.By}
	if cmd.PointID != "" {
		d["pointId"] = cmd.PointID
	}
	a.svc.pub.PublishExcept(Channel(a.id), realtime.Message{T: "param", Ch: Channel(a.id), D: realtime.Data(d)}, cmd.Conn)
	a.params.Put(cmd.Path, cmd.Value, cmd.By)
	if isPoint && (field == "x" || field == "y") {
		a.followLive(cur, cmd.By)
	}
	return nil
}

// followLive sends, as params to every subscriber, where the detail points of a face being dragged are right now:
// the committed details mapped from the committed corners to the live ones (committed plus pending params).
func (a *actor) followLive(committed *scene.Scene, by string) {
	live := *committed
	live.Points = append([]scene.Point(nil), committed.Points...)
	for path, raw := range a.params.Pending() {
		i, f, ok := pointPath(path)
		if !ok || i >= len(live.Points) || a.paramIDs[path] != live.Points[i].ID {
			continue
		}
		var v float64
		if json.Unmarshal(raw, &v) != nil {
			continue
		}
		switch f {
		case "x":
			live.Points[i].X = v
		case "y":
			live.Points[i].Y = v
		}
	}
	moves := scene.FollowDetails(committed, &live)
	send := func(i int, p scene.Point) {
		for _, f := range []struct {
			k string
			v float64
		}{{"x", p.X}, {"y", p.Y}} {
			a.svc.pub.Publish(Channel(a.id), realtime.Message{T: "param", Ch: Channel(a.id), D: realtime.Data(map[string]any{
				"path": fmt.Sprintf("/points/%d/%s", i, f.k), "value": f.v, "by": by, "pointId": p.ID})})
		}
	}
	for i, p := range committed.Points {
		if m, ok := moves[p.ID]; ok {
			send(i, m)
			a.liveSent[p.ID] = true
		} else if a.liveSent[p.ID] {
			// the face is back where it was: put the detail point back too
			send(i, p)
			delete(a.liveSent, p.ID)
		}
	}
}

// pointPath parses /points/{i}/{field}.
func pointPath(path string) (int, string, bool) {
	rest, ok := strings.CutPrefix(path, "/points/")
	if !ok {
		return 0, "", false
	}
	num, field, _ := strings.Cut(rest, "/")
	i, err := strconv.Atoi(num)
	if err != nil || i < 0 {
		return 0, "", false
	}
	return i, field, true
}

// touchesPoints tells whether any op writes into /points.
func touchesPoints(ops []docpatch.Op) bool {
	for _, op := range ops {
		if op.Op != "test" && (op.Path == "/points" || strings.HasPrefix(op.Path, "/points/") || strings.HasPrefix(op.From, "/points")) {
			return true
		}
	}
	return false
}

// paramOps is the replace for a committed param, guarded by a test of the point id it was sent for.
func (a *actor) paramOps(path string, v json.RawMessage) []docpatch.Op {
	op := docpatch.Op{Op: "replace", Path: path, Value: v}
	id, ok := a.paramIDs[path]
	delete(a.paramIDs, path)
	if i, _, isPoint := pointPath(path); isPoint && ok {
		b, _ := json.Marshal(id)
		return []docpatch.Op{{Op: "test", Path: fmt.Sprintf("/points/%d/id", i), Value: b}, op}
	}
	return []docpatch.Op{op}
}

// commitPending commits every pending param now, as one patch (on the actor goroutine, before a structural patch).
func (a *actor) commitPending() {
	taken := a.params.Take()
	if len(taken) == 0 {
		return
	}
	paths := make([]string, 0, len(taken))
	for p := range taken {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var ops []docpatch.Op
	by := ""
	for _, p := range paths {
		t := taken[p]
		if cur, err := docpatch.GetRaw(a.doc, p); err == nil {
			if b, _ := json.Marshal(cur); string(b) == string(t.Value) {
				delete(a.paramIDs, p)
				continue
			}
		}
		ops = append(ops, a.paramOps(p, t.Value)...)
		by = t.By
	}
	if len(ops) == 0 {
		return
	}
	e, err := a.commit(context.Background(), ops, by, "")
	if err != nil {
		a.svc.log.Warn("param commit failed", "scene", a.id, "err", err)
		a.resync()
		return
	}
	a.undo = append(a.undo, e)
	a.redo = nil
}

// commitParam runs on the actor goroutine 200 ms after the last param on path.
func (a *actor) commitParam(path string, v json.RawMessage, by string) {
	if a.closed {
		return
	}
	if cur, err := docpatch.GetRaw(a.doc, path); err == nil {
		if b, _ := json.Marshal(cur); string(b) == string(v) {
			delete(a.paramIDs, path)
			return
		}
	}
	e, err := a.commit(context.Background(), a.paramOps(path, v), by, "")
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
