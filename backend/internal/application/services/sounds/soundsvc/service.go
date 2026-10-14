// Package soundsvc implements the sound library on top of the asset store and publishes the sounds channel.
package soundsvc

import (
	"context"
	"time"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	assetssvc "projmap/internal/application/services/assets"
	soundssvc "projmap/internal/application/services/sounds"
	"projmap/internal/domain/assets"
)

// Channel carries the sound library (protocol §14).
const Channel = "sounds"

// Service implements SoundService.
type Service struct {
	assets assetssvc.AssetService
	pub    realtime.Publisher
}

var _ soundssvc.SoundService = (*Service)(nil)

// New makes the service.
func New(as assetssvc.AssetService, pub realtime.Publisher) *Service {
	return &Service{assets: as, pub: pub}
}

func (s *Service) List(ctx context.Context) ([]assets.Asset, error) {
	l, err := s.assets.List(ctx, assets.KindSound)
	if l == nil {
		l = []assets.Asset{}
	}
	return l, err
}

// Publish sends the library on the sounds channel.
func (s *Service) Publish(ctx context.Context) {
	l, err := s.List(ctx)
	if err != nil {
		return
	}
	s.pub.Publish(Channel, realtime.Message{T: "snapshot", Ch: Channel, V: realtime.Ver(time.Now().UnixMilli()), D: realtime.Data(l)})
}

func (s *Service) Upload(ctx context.Context, data []byte, in assetssvc.SoundIn) (*assets.Asset, error) {
	a, err := s.assets.UploadSound(ctx, data, in)
	if err != nil {
		return nil, err
	}
	s.Publish(ctx)
	return a, nil
}

func (s *Service) get(ctx context.Context, sha string) error {
	a, err := s.assets.Get(ctx, sha)
	if err != nil || a.Kind != assets.KindSound {
		return app_errors.NotFound("Sound %s does not exist.", sha)
	}
	return nil
}

func (s *Service) Rename(ctx context.Context, sha, name string) (*assets.Asset, error) {
	if err := s.get(ctx, sha); err != nil {
		return nil, err
	}
	a, err := s.assets.Rename(ctx, sha, name)
	if err != nil {
		return nil, err
	}
	s.Publish(ctx)
	return a, nil
}

func (s *Service) Delete(ctx context.Context, sha string) error {
	if err := s.get(ctx, sha); err != nil {
		return err
	}
	if err := s.assets.Delete(ctx, sha); err != nil {
		return err
	}
	s.Publish(ctx)
	return nil
}
