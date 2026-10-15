package scenesvc

import (
	"context"
	"strings"
	"sync"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	scenerepo "projmap/internal/application/ports/repository/scenes"
	"projmap/internal/application/services"
	scenessvc "projmap/internal/application/services/scenes"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
)

// DraftChannel is a draft's realtime channel.
func DraftChannel(id string) string { return "draft:" + id }

// Drafts implements DraftService.
type Drafts struct {
	repo   scenerepo.DraftRepository
	scenes *Service
	pub    realtime.Publisher
	mu     sync.Mutex // serializes writes to drafts (agents write one draft each; this keeps it simple)
}

var _ scenessvc.DraftService = (*Drafts)(nil)

// NewDrafts makes the draft service over the scene service.
func NewDrafts(repo scenerepo.DraftRepository, scenes *Service, pub realtime.Publisher) *Drafts {
	return &Drafts{repo: repo, scenes: scenes, pub: pub}
}

func (d *Drafts) publish(dr *scene.Draft) {
	d.pub.Publish(DraftChannel(dr.ID), realtime.Message{T: "snapshot", Ch: DraftChannel(dr.ID), V: realtime.Ver(int64(len(dr.Ops))), D: realtime.Data(dr)})
}

func (d *Drafts) List(ctx context.Context, sceneID string) ([]scene.Draft, error) {
	return d.repo.List(ctx, sceneID)
}

func (d *Drafts) Get(ctx context.Context, id string) (*scene.Draft, error) {
	return d.repo.Get(ctx, id)
}

func (d *Drafts) Create(ctx context.Context, sceneID, author string) (*scene.Draft, error) {
	if sceneID == "" {
		return nil, app_errors.BadRequest("A draft needs a sceneId.")
	}
	author = strings.TrimSpace(author)
	if author == "" {
		author = "user:editor"
	}
	doc, v, err := d.scenes.Get(ctx, sceneID)
	if err != nil {
		return nil, err
	}
	dr := &scene.Draft{ID: services.NewID("drf"), SceneID: sceneID, Author: author, BaseVersion: v, Ops: []docpatch.Op{},
		Status: scene.DraftOpen, BaseDoc: doc}
	if err := d.repo.Save(ctx, dr); err != nil {
		return nil, err
	}
	d.publish(dr)
	return dr, nil
}

func (d *Drafts) view(dr *scene.Draft) ([]byte, error) {
	if len(dr.Ops) == 0 {
		return dr.BaseDoc, nil
	}
	return docpatch.ApplyPlain(dr.BaseDoc, dr.Ops)
}

func (d *Drafts) View(ctx context.Context, id string) (*scene.Scene, error) {
	dr, err := d.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	doc, err := d.view(dr)
	if err != nil {
		return nil, app_errors.Invalid("Draft %s no longer applies to its base: %v", id, err)
	}
	return scene.Decode(doc)
}

func (d *Drafts) AddOps(ctx context.Context, id string, ops []docpatch.Op) (*scene.Draft, error) {
	if err := guard(ops); err != nil {
		return nil, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	dr, err := d.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if !dr.IsOpen() {
		return nil, app_errors.Conflict("Draft %s is %s; start a new draft.", id, dr.Status)
	}
	cur, err := d.view(dr)
	if err != nil {
		return nil, app_errors.Invalid("Draft %s no longer applies: %v", id, err)
	}
	next, err := docpatch.ApplyPlain(cur, ops)
	if err != nil {
		return nil, app_errors.Invalid("The ops do not apply to the draft: %v", err)
	}
	sc, err := scene.Decode(next)
	if err != nil {
		return nil, app_errors.Invalid("The ops make an invalid scene: %v", err)
	}
	// detail surfaces follow their face in the draft too (the same rule as a live commit)
	if touchesPoints(ops) {
		if old, derr := scene.Decode(cur); derr == nil {
			if extra := scene.FollowOps(sc, scene.FollowDetails(old, sc)); len(extra) > 0 {
				all := append(append([]docpatch.Op{}, ops...), extra...)
				if n2, e2 := docpatch.ApplyPlain(cur, all); e2 == nil {
					if sc2, e3 := scene.Decode(n2); e3 == nil {
						ops, sc = all, sc2
					}
				}
			}
		}
	}
	if err := d.scenes.Validate(sc); err != nil {
		return nil, err
	}
	dr.Ops = append(dr.Ops, ops...)
	if dr.Status == scene.DraftProposed {
		dr.Status = scene.DraftOpen
	}
	if err := d.repo.Save(ctx, dr); err != nil {
		return nil, err
	}
	d.publish(dr)
	return dr, nil
}

func (d *Drafts) Propose(ctx context.Context, id, summary string) (*scene.Draft, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	dr, err := d.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if !dr.IsOpen() {
		return nil, app_errors.Conflict("Draft %s is %s.", id, dr.Status)
	}
	dr.Status, dr.Summary = scene.DraftProposed, strings.TrimSpace(summary)
	if err := d.repo.Save(ctx, dr); err != nil {
		return nil, err
	}
	d.publish(dr)
	return dr, nil
}

func (d *Drafts) Apply(ctx context.Context, id, by string) (*scene.Draft, int64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	dr, err := d.repo.Get(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	if !dr.IsOpen() {
		return nil, 0, app_errors.Conflict("Draft %s is %s.", id, dr.Status)
	}
	var v int64
	if len(dr.Ops) > 0 {
		v, err = d.scenes.commitRebase(ctx, dr.SceneID, dr.Ops, dr.Author+" via "+by)
		if err != nil {
			if e := app_errors.As(err); e.Code == "invalid" {
				return nil, 0, app_errors.Conflict("The scene changed since the draft started and the draft no longer applies (%s). Start a new draft.", e.Message)
			}
			return nil, 0, err
		}
	} else if _, v, err = d.scenes.Get(ctx, dr.SceneID); err != nil {
		return nil, 0, err
	}
	dr.Status = scene.DraftApplied
	if err := d.repo.Save(ctx, dr); err != nil {
		return nil, 0, err
	}
	d.publish(dr)
	return dr, v, nil
}

func (d *Drafts) Discard(ctx context.Context, id string) (*scene.Draft, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	dr, err := d.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if dr.Status == scene.DraftApplied {
		return nil, app_errors.Conflict("Draft %s is already applied; undo it on the scene instead.", id)
	}
	dr.Status = scene.DraftDiscarded
	if err := d.repo.Save(ctx, dr); err != nil {
		return nil, err
	}
	d.publish(dr)
	return dr, nil
}
