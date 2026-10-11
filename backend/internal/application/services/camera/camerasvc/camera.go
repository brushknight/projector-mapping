// Package camerasvc implements the camera section: stills from the phone (camera.capture RPC answered by an upload
// to /camera/stills), the preview feed, and calibration (the Gray-code sequencer of protocol §7, maps, surface
// detection and alignment checks).
package camerasvc

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	_ "image/jpeg" // still decoders
	_ "image/png"
	"sync"
	"time"

	"golang.org/x/image/draw"

	"projmap/internal/application/app_errors"
	cameraport "projmap/internal/application/ports/out/camera"
	"projmap/internal/application/ports/out/realtime"
	"projmap/internal/application/services"
	assetssvc "projmap/internal/application/services/assets"
	camerasvc "projmap/internal/application/services/camera"
	"projmap/internal/domain/assets"
	"projmap/internal/domain/camera"
)

// CaptureTimeout bounds one still.
var CaptureTimeout = 20 * time.Second

// Camera implements CameraService.
type Camera struct {
	feed   cameraport.Feed
	caller realtime.Caller
	assets assetssvc.AssetService

	mu      sync.Mutex
	waiters map[string]*waiter
}

type waiter struct {
	kind string
	ch   chan *assets.Asset
}

var _ camerasvc.CameraService = (*Camera)(nil)

// NewCamera makes the camera service.
func NewCamera(feed cameraport.Feed, caller realtime.Caller, as assetssvc.AssetService) *Camera {
	return &Camera{feed: feed, caller: caller, assets: as, waiters: map[string]*waiter{}}
}

// CameraTarget is who answers camera.capture.
var CameraTarget = realtime.Target{Cap: "camera"}

func (c *Camera) Status(context.Context) camera.FeedStatus {
	st := camera.FeedStatus{Connected: c.caller.Has(CameraTarget), Device: c.feed.CameraDevice()}
	if s, at, ok := c.feed.Status(); ok && time.Since(at) < 5*time.Second {
		st.Streaming, st.FPS, st.Width, st.Height, st.Steady, st.Level = s.Streaming, s.FPS, s.Width, s.Height, s.Steady, s.Level
	}
	st.LastFrameMs = -1
	if f, ok := c.feed.LatestFrame(); ok {
		st.LastFrameMs = time.Since(f.At).Milliseconds()
		if st.Width == 0 {
			st.Width, st.Height = f.Width, f.Height
		}
	}
	return st
}

func (c *Camera) Preview(context.Context) ([]byte, bool) {
	f, ok := c.feed.LatestFrame()
	if !ok || time.Since(f.At) > 10*time.Second {
		return nil, false
	}
	return f.JPEG, true
}

func (c *Camera) Capture(ctx context.Context, kind string) (*assets.Asset, error) {
	if !c.caller.Has(CameraTarget) {
		return nil, app_errors.Unavailable("No phone with a camera is connected. Open projmap on the phone and point it at the wall.")
	}
	if kind == "" {
		kind = "snapshot"
	}
	id := services.NewID("cap")
	w := &waiter{kind: kind, ch: make(chan *assets.Asset, 1)}
	c.mu.Lock()
	c.waiters[id] = w
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.waiters, id)
		c.mu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(ctx, CaptureTimeout)
	defer cancel()
	rpcErr := make(chan error, 1)
	go func() {
		res, err := c.caller.Call(ctx, CameraTarget, "camera.capture", map[string]any{"requestId": id, "lock": true})
		if err != nil {
			rpcErr <- err
			return
		}
		var r struct {
			SHA string `json:"sha"`
		}
		_ = json.Unmarshal(res, &r)
		if r.SHA != "" {
			if a, err := c.assets.Get(ctx, r.SHA); err == nil {
				select {
				case w.ch <- a:
				default:
				}
				return
			}
		}
		// answered without a sha: the upload to /camera/stills still resolves the waiter
	}()
	select {
	case a := <-w.ch:
		return a, nil
	case err := <-rpcErr:
		// the upload may have landed just before the error
		select {
		case a := <-w.ch:
			return a, nil
		default:
		}
		return nil, err
	case <-ctx.Done():
		return nil, app_errors.Timeout("The phone did not send a photo in time.")
	}
}

func (c *Camera) StillUploaded(ctx context.Context, requestID string, data []byte) (*assets.Asset, error) {
	c.mu.Lock()
	w := c.waiters[requestID]
	c.mu.Unlock()
	kind := "snapshot"
	if w != nil {
		kind = w.kind
	}
	a, err := c.assets.Upload(ctx, data, kind)
	if err != nil {
		return nil, err
	}
	if w != nil {
		select {
		case w.ch <- a:
		default:
		}
	}
	return a, nil
}

// DecodeStill decodes a JPEG or PNG and reduces it to gray at most camerasvc.MaxStillWidth wide.
func DecodeStill(b []byte) (*image.Gray, error) {
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, app_errors.Invalid("The still is not a JPEG or PNG: %v", err)
	}
	r := img.Bounds()
	w, h := r.Dx(), r.Dy()
	if w > camerasvc.MaxStillWidth {
		h, w = h*camerasvc.MaxStillWidth/w, camerasvc.MaxStillWidth
	}
	g := image.NewGray(image.Rect(0, 0, w, h))
	if w == r.Dx() {
		draw.Draw(g, g.Bounds(), img, r.Min, draw.Src)
	} else {
		draw.ApproxBiLinear.Scale(g, g.Bounds(), img, r, draw.Src, nil)
	}
	return g, nil
}
