package scenesvc

import (
	"context"
	"strings"
	"time"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	scenerepo "projmap/internal/application/ports/repository/scenes"
	"projmap/internal/application/services"
	scenessvc "projmap/internal/application/services/scenes"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
)

// PresetsChannel carries the preset list.
const PresetsChannel = "presets"

// Presets implements PresetService.
type Presets struct {
	repo   scenerepo.PresetRepository
	scenes *Service
	pub    realtime.Publisher
}

var _ scenessvc.PresetService = (*Presets)(nil)

// NewPresets makes the preset service.
func NewPresets(repo scenerepo.PresetRepository, scenes *Service, pub realtime.Publisher) *Presets {
	return &Presets{repo: repo, scenes: scenes, pub: pub}
}

func (p *Presets) broadcast(ctx context.Context) {
	list, err := p.repo.List(ctx)
	if err != nil {
		return
	}
	p.pub.Publish(PresetsChannel, realtime.Message{T: "snapshot", Ch: PresetsChannel, V: realtime.Ver(time.Now().UnixMilli()), D: realtime.Data(list)})
}

func (p *Presets) List(ctx context.Context) ([]scene.Preset, error) { return p.repo.List(ctx) }

func (p *Presets) Create(ctx context.Context, name, mode, sceneID string) (*scene.Preset, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, app_errors.BadRequest("A preset needs a name.")
	}
	sc, err := p.scenes.Scene(ctx, sceneID)
	if err != nil {
		return nil, err
	}
	if mode == "" {
		mode = sc.Mode
		if !scene.IsBackdropMode(mode) {
			mode = scene.ModeStatic
		}
	}
	if !scene.PresetModes[mode] {
		return nil, app_errors.BadRequest("mode must be static, live, color or scenery.")
	}
	pr := &scene.Preset{ID: services.NewID("pre"), Name: name, Mode: mode, Backdrop: *sc.Backdrop.Stack(mode), CreatedAt: time.Now().UTC()}
	if err := p.Save(ctx, pr); err != nil {
		return nil, err
	}
	return pr, nil
}

func (p *Presets) Save(ctx context.Context, pr *scene.Preset) error {
	if pr.Backdrop.Layers == nil {
		pr.Backdrop.Layers = []scene.Layer{}
	}
	pr.Upgrade()
	if err := p.repo.Save(ctx, pr); err != nil {
		return err
	}
	p.broadcast(ctx)
	return nil
}

func (p *Presets) Apply(ctx context.Context, id, sceneID, by string) (int64, error) {
	pr, err := p.repo.Get(ctx, id)
	if err != nil {
		return 0, err
	}
	pr.Upgrade()
	if sceneID == "" {
		return 0, app_errors.BadRequest("Pick the scene to apply the preset to (sceneId).")
	}
	sc, err := p.scenes.Scene(ctx, sceneID)
	if err != nil {
		return 0, err
	}
	return p.scenes.commitRebase(ctx, sceneID, ApplyPresetOps(pr, sc), by)
}

// UpgradeStored rewrites the stored static and live presets from before the light model (protocol §15, Upgrade)
// and reports how many it changed.
func (p *Presets) UpgradeStored(ctx context.Context) (int, error) {
	list, err := p.repo.List(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range list {
		if !list[i].Upgrade() {
			continue
		}
		if err := p.repo.Save(ctx, &list[i]); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// ApplyPresetOps replace the preset's mode stack and put that mode on air (see scene.PresetOps).
func ApplyPresetOps(pr *scene.Preset, sc *scene.Scene) []docpatch.Op { return scene.PresetOps(pr, sc) }

func (p *Presets) Delete(ctx context.Context, id string) error {
	if err := p.repo.Delete(ctx, id); err != nil {
		return err
	}
	p.broadcast(ctx)
	return nil
}
