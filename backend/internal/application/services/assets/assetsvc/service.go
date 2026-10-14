// Package assetsvc implements the assets section.
package assetsvc

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	_ "image/png" // decoders for DecodeConfig
	"io"
	"net/http"

	"golang.org/x/image/draw"

	"projmap/internal/application/app_errors"
	assetrepo "projmap/internal/application/ports/repository/assets"
	assetssvc "projmap/internal/application/services/assets"
	"projmap/internal/domain/assets"
)

// ThumbSize is the longest side of a thumbnail.
const ThumbSize = 512

// Service implements AssetService.
type Service struct {
	repo  assetrepo.AssetRepository
	blobs assetrepo.Blobs
}

var _ assetssvc.AssetService = (*Service)(nil)

// New makes the service.
func New(repo assetrepo.AssetRepository, blobs assetrepo.Blobs) *Service {
	return &Service{repo: repo, blobs: blobs}
}

// Sniff returns the mime type, recognizing HEIC/HEIF too.
func Sniff(b []byte) string {
	if len(b) >= 12 && string(b[4:8]) == "ftyp" {
		switch string(b[8:12]) {
		case "heic", "heix", "hevc", "heim", "heis", "mif1", "msf1":
			return "image/heic"
		}
	}
	if IsSVG(b) {
		return "image/svg+xml"
	}
	m := http.DetectContentType(b)
	if i := bytes.IndexByte([]byte(m), ';'); i > 0 {
		m = m[:i]
	}
	return m
}

func (s *Service) Upload(ctx context.Context, data []byte, kind string) (*assets.Asset, error) {
	if len(data) == 0 {
		return nil, app_errors.BadRequest("The upload is empty.")
	}
	if len(data) > assetssvc.MaxBytes {
		return nil, app_errors.BadRequest("The upload is larger than 64 MB.")
	}
	if kind == "" {
		kind = "photo"
	}
	if !assets.Kinds[kind] {
		return nil, app_errors.BadRequest("kind must be photo, reference, snapshot, calibration or thumb.")
	}
	sha, err := s.blobs.Put(data)
	if err != nil {
		return nil, err
	}
	if a, err := s.repo.Get(ctx, sha); err == nil {
		return a, nil
	}
	a := &assets.Asset{SHA: sha, Mime: Sniff(data), Bytes: int64(len(data)), Kind: kind}
	if a.Mime == "image/svg+xml" {
		a.Width, a.Height = SVGSize(data)
	}
	// HEIC has no pure-Go decoder: it is stored as is, without size or thumbnail
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		a.Width, a.Height = cfg.Width, cfg.Height
		if kind != "thumb" && kind != "calibration" && (cfg.Width > ThumbSize || cfg.Height > ThumbSize) {
			if t, err := s.thumb(ctx, data); err == nil {
				a.Thumb = &t
			}
		}
	}
	if err := s.repo.Save(ctx, a); err != nil {
		return nil, err
	}
	return a, nil
}

// thumb stores a JPEG thumbnail with the longest side ThumbSize.
func (s *Service) thumb(ctx context.Context, data []byte) (string, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w >= h {
		h, w = h*ThumbSize/w, ThumbSize
	} else {
		w, h = w*ThumbSize/h, ThumbSize
	}
	dst := image.NewRGBA(image.Rect(0, 0, max(w, 1), max(h, 1)))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 80}); err != nil {
		return "", err
	}
	t, err := s.Upload(ctx, buf.Bytes(), "thumb")
	if err != nil {
		return "", err
	}
	return t.SHA, nil
}

func (s *Service) Get(ctx context.Context, sha string) (*assets.Asset, error) {
	return s.repo.Get(ctx, sha)
}

func (s *Service) Open(ctx context.Context, sha string) (io.ReadSeekCloser, *assets.Asset, error) {
	a, err := s.repo.Get(ctx, sha)
	if err != nil {
		return nil, nil, err
	}
	f, err := s.blobs.Open(sha)
	if err != nil {
		return nil, nil, app_errors.NotFound("Asset %s has no file.", sha)
	}
	return f, a, nil
}

func (s *Service) Read(ctx context.Context, sha string) ([]byte, error) {
	if _, err := s.repo.Get(ctx, sha); err != nil {
		return nil, err
	}
	return s.blobs.Read(sha)
}
