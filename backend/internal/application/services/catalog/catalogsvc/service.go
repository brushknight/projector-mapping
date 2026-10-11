// Package catalogsvc implements the catalog service.
package catalogsvc

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"projmap/internal/application/app_errors"
	catalogrepo "projmap/internal/application/ports/repository/catalog"
	"projmap/internal/application/services"
	catalogsvc "projmap/internal/application/services/catalog"
	"projmap/internal/domain/catalog"
)

// Service implements CatalogService.
type Service struct {
	cat  *catalog.Catalog
	repo catalogrepo.EffectRepository

	mu      sync.RWMutex
	schemas map[string]catalog.Schema // user effects' schemas, for validation
}

var _ catalogsvc.CatalogService = (*Service)(nil)

// New parses the embedded catalog and loads the stored effects' schemas.
func New(ctx context.Context, raw []byte, repo catalogrepo.EffectRepository) (*Service, error) {
	cat, err := catalog.Parse(raw)
	if err != nil {
		return nil, err
	}
	s := &Service{cat: cat, repo: repo, schemas: map[string]catalog.Schema{}}
	effects, err := repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, e := range effects {
		s.remember(&e)
	}
	return s, nil
}

func (s *Service) remember(e *catalog.Effect) {
	var sc catalog.Schema
	_ = json.Unmarshal(e.Params, &sc)
	s.mu.Lock()
	s.schemas[e.ID] = sc
	s.mu.Unlock()
}

func (s *Service) JSON() []byte              { return s.cat.Raw }
func (s *Service) Catalog() *catalog.Catalog { return s.cat }

func (s *Service) Effects(ctx context.Context) ([]catalog.Effect, error) {
	user, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	out := append([]catalog.Effect{}, s.cat.Effects...)
	return append(out, user...), nil
}

func (s *Service) Effect(ctx context.Context, id string) (*catalog.Effect, error) {
	if e := s.cat.Effect(id); e != nil {
		c := *e
		return &c, nil
	}
	return s.repo.Get(ctx, id)
}

func (s *Service) build(in catalogsvc.EffectInput) (*catalog.Effect, error) {
	params, _ := json.Marshal(in.Params)
	if in.Params == nil {
		params = []byte("{}")
	}
	src := in.Source
	e := &catalog.Effect{Name: strings.TrimSpace(in.Name), Kind: in.Kind, Origin: in.Origin, Params: params, Source: &src}
	if e.Origin == "" {
		e.Origin = "user"
	}
	if err := catalog.ValidateEffect(e); err != nil {
		return nil, app_errors.Invalid("%s", err.Error())
	}
	return e, nil
}

func (s *Service) CreateEffect(ctx context.Context, in catalogsvc.EffectInput) (*catalog.Effect, []string, error) {
	e, err := s.build(in)
	if err != nil {
		return nil, nil, err
	}
	e.ID = services.NewID("eff")
	if err := s.repo.Save(ctx, e); err != nil {
		return nil, nil, err
	}
	s.remember(e)
	return e, catalog.LintSource(e.Kind, *e.Source), nil
}

func (s *Service) UpdateEffect(ctx context.Context, id string, in catalogsvc.EffectInput) (*catalog.Effect, []string, error) {
	if s.cat.Effect(id) != nil {
		return nil, nil, app_errors.Forbidden("Built-in effect %s cannot change; fork it with a new name.", id)
	}
	old, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if in.Name == "" {
		in.Name = old.Name
	}
	if in.Kind == "" {
		in.Kind = old.Kind
	}
	if in.Source == "" && old.Source != nil {
		in.Source = *old.Source
	}
	if in.Params == nil {
		in.Params = old.Params
	}
	if in.Origin == "" {
		in.Origin = old.Origin
	}
	e, err := s.build(in)
	if err != nil {
		return nil, nil, err
	}
	e.ID = id
	if err := s.repo.Save(ctx, e); err != nil {
		return nil, nil, err
	}
	s.remember(e)
	return e, catalog.LintSource(e.Kind, *e.Source), nil
}

func (s *Service) DeleteEffect(ctx context.Context, id string) error {
	if s.cat.Effect(id) != nil {
		return app_errors.Forbidden("Built-in effect %s cannot be deleted.", id)
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.schemas, id)
	s.mu.Unlock()
	return nil
}

func (s *Service) LayerSchema(kind, ref string) (catalog.Schema, bool) {
	return s.cat.LayerSchema(kind, ref)
}

func (s *Service) EffectSchema(id string) (catalog.Schema, bool) {
	if e := s.cat.Effect(id); e != nil {
		var sc catalog.Schema
		_ = json.Unmarshal(e.Params, &sc)
		return sc, true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	sc, ok := s.schemas[id]
	return sc, ok
}
