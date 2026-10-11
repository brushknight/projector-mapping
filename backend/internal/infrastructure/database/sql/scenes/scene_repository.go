// Package scenes stores scenes, the op log, drafts and presets in SQLite.
package scenes

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	scenerepo "projmap/internal/application/ports/repository/scenes"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/infrastructure/database/sql/shared"
)

// SceneModel is a scenes row: the whole document plus the columns lists need.
type SceneModel struct {
	ID        string `gorm:"primaryKey"`
	SetupID   string
	Name      string
	Version   int64
	Doc       string
	UpdatedAt time.Time
}

func (SceneModel) TableName() string { return "scenes" }

// OpModel is one op log entry.
type OpModel struct {
	ID      int64 `gorm:"primaryKey;autoIncrement"`
	SceneID string
	Version int64
	Author  string
	TS      time.Time `gorm:"column:ts"`
	Ops     string
	Inverse string
}

func (OpModel) TableName() string { return "ops" }

// ToDomain decodes the entry.
func (m OpModel) ToDomain() scene.HistoryEntry {
	e := scene.HistoryEntry{Version: m.Version, Author: m.Author, TS: m.TS.UTC()}
	_ = json.Unmarshal([]byte(m.Ops), &e.Ops)
	_ = json.Unmarshal([]byte(m.Inverse), &e.Inverse)
	if e.Ops == nil {
		e.Ops = []docpatch.Op{}
	}
	return e
}

// SceneRepository implements scenes.SceneRepository.
type SceneRepository struct{ db *gorm.DB }

var _ scenerepo.SceneRepository = (*SceneRepository)(nil)

func NewSceneRepository(db *gorm.DB) *SceneRepository { return &SceneRepository{db: db} }

func (r *SceneRepository) List(ctx context.Context) ([]scene.Summary, error) {
	var rows []SceneModel
	if err := r.db.WithContext(ctx).Select("id", "setup_id", "name", "version").Order("name, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]scene.Summary, 0, len(rows))
	for _, m := range rows {
		out = append(out, scene.Summary{ID: m.ID, Name: m.Name, SetupID: m.SetupID, Version: m.Version})
	}
	return out, nil
}

func (r *SceneRepository) Get(ctx context.Context, id string) ([]byte, error) {
	var m SceneModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, shared.NotFound(err, "Scene %s does not exist.", id)
	}
	return []byte(m.Doc), nil
}

func (r *SceneRepository) Create(ctx context.Context, s *scene.Scene) error {
	return r.db.WithContext(ctx).Create(&SceneModel{ID: s.ID, SetupID: s.SetupID, Name: s.Name, Version: s.Version,
		Doc: string(s.Encode()), UpdatedAt: time.Now().UTC()}).Error
}

func (r *SceneRepository) Commit(ctx context.Context, id string, doc []byte, name string, e scene.HistoryEntry) error {
	ops, _ := json.Marshal(e.Ops)
	inv, _ := json.Marshal(e.Inverse)
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&SceneModel{}).Where("id = ?", id).Updates(map[string]any{"doc": string(doc), "version": e.Version,
			"name": name, "updated_at": time.Now().UTC()})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return shared.NotFound(gorm.ErrRecordNotFound, "Scene %s does not exist.", id)
		}
		return tx.Create(&OpModel{SceneID: id, Version: e.Version, Author: e.Author, TS: e.TS, Ops: string(ops), Inverse: string(inv)}).Error
	})
}

func (r *SceneRepository) Rewrite(ctx context.Context, id string, doc []byte) error {
	return r.db.WithContext(ctx).Model(&SceneModel{}).Where("id = ?", id).Updates(map[string]any{"doc": string(doc), "updated_at": time.Now().UTC()}).Error
}

func (r *SceneRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Delete(&SceneModel{}, "id = ?", id)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return shared.NotFound(gorm.ErrRecordNotFound, "Scene %s does not exist.", id)
		}
		return tx.Delete(&OpModel{}, "scene_id = ?", id).Error
	})
}

func (r *SceneRepository) History(ctx context.Context, id string, limit int) ([]scene.HistoryEntry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 50
	}
	var rows []OpModel
	if err := r.db.WithContext(ctx).Where("scene_id = ?", id).Order("version desc, id desc").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]scene.HistoryEntry, 0, len(rows))
	for _, m := range rows {
		out = append(out, m.ToDomain())
	}
	return out, nil
}

// DraftModel is a drafts row.
type DraftModel struct {
	ID        string `gorm:"primaryKey"`
	SceneID   string
	Status    string
	Doc       string
	BaseDoc   string
	UpdatedAt time.Time
}

func (DraftModel) TableName() string { return "drafts" }

// ToDomain decodes the row.
func (m DraftModel) ToDomain() (*scene.Draft, error) {
	var d scene.Draft
	if err := json.Unmarshal([]byte(m.Doc), &d); err != nil {
		return nil, err
	}
	d.BaseDoc, d.UpdatedAt = []byte(m.BaseDoc), m.UpdatedAt
	if d.Ops == nil {
		d.Ops = []docpatch.Op{}
	}
	return &d, nil
}

// DraftRepository implements scenes.DraftRepository.
type DraftRepository struct{ db *gorm.DB }

var _ scenerepo.DraftRepository = (*DraftRepository)(nil)

func NewDraftRepository(db *gorm.DB) *DraftRepository { return &DraftRepository{db: db} }

func (r *DraftRepository) List(ctx context.Context, sceneID string) ([]scene.Draft, error) {
	q := r.db.WithContext(ctx).Order("updated_at desc")
	if sceneID != "" {
		q = q.Where("scene_id = ?", sceneID)
	}
	var rows []DraftModel
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]scene.Draft, 0, len(rows))
	for _, m := range rows {
		d, err := m.ToDomain()
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, nil
}

func (r *DraftRepository) Get(ctx context.Context, id string) (*scene.Draft, error) {
	var m DraftModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, shared.NotFound(err, "Draft %s does not exist.", id)
	}
	return m.ToDomain()
}

func (r *DraftRepository) Save(ctx context.Context, d *scene.Draft) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	d.UpdatedAt = time.Now().UTC()
	return r.db.WithContext(ctx).Save(&DraftModel{ID: d.ID, SceneID: d.SceneID, Status: d.Status, Doc: string(b),
		BaseDoc: string(d.BaseDoc), UpdatedAt: d.UpdatedAt}).Error
}

// PresetModel is a presets row.
type PresetModel struct {
	ID        string `gorm:"primaryKey"`
	Doc       string
	CreatedAt time.Time
}

func (PresetModel) TableName() string { return "presets" }

// PresetRepository implements scenes.PresetRepository.
type PresetRepository struct{ db *gorm.DB }

var _ scenerepo.PresetRepository = (*PresetRepository)(nil)

func NewPresetRepository(db *gorm.DB) *PresetRepository { return &PresetRepository{db: db} }

func (r *PresetRepository) List(ctx context.Context) ([]scene.Preset, error) {
	var rows []PresetModel
	if err := r.db.WithContext(ctx).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]scene.Preset, 0, len(rows))
	for _, m := range rows {
		var p scene.Preset
		if err := json.Unmarshal([]byte(m.Doc), &p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func (r *PresetRepository) Get(ctx context.Context, id string) (*scene.Preset, error) {
	var m PresetModel
	if err := r.db.WithContext(ctx).First(&m, "id = ?", id).Error; err != nil {
		return nil, shared.NotFound(err, "Preset %s does not exist.", id)
	}
	var p scene.Preset
	return &p, json.Unmarshal([]byte(m.Doc), &p)
}

func (r *PresetRepository) Save(ctx context.Context, p *scene.Preset) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Save(&PresetModel{ID: p.ID, Doc: string(b), CreatedAt: p.CreatedAt}).Error
}

func (r *PresetRepository) Delete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&PresetModel{}, "id = ?", id)
	if res.Error == nil && res.RowsAffected == 0 {
		return shared.NotFound(gorm.ErrRecordNotFound, "Preset %s does not exist.", id)
	}
	return res.Error
}
