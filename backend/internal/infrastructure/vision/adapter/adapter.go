// Package adapter implements the camera section's Vision port with the vision package.
package adapter

import (
	"fmt"
	"image"

	cameraport "projmap/internal/application/ports/out/camera"
	"projmap/internal/domain/camera"
	"projmap/internal/infrastructure/vision"
)

// Vision implements cameraport.Vision.
type Vision struct{}

var _ cameraport.Vision = Vision{}

// Map wraps a decoded map and its sparse inverse.
type Map struct {
	M   *vision.Map
	Inv *vision.InverseMap
}

func wrap(m *vision.Map) *Map { return &Map{M: m, Inv: m.Inverse(8)} }

func (m *Map) CamToProj(u, v float64) (camera.Pt, bool) {
	p, ok := m.M.Lookup(u, v)
	return camera.Pt{X: p.X, Y: p.Y}, ok
}

func (m *Map) ProjToCam(x, y float64) (camera.Pt, bool) {
	p, ok := m.Inv.Lookup(x, y)
	return camera.Pt{X: p.X, Y: p.Y}, ok
}

func (m *Map) CameraSize() (int, int)  { return m.M.CamW, m.M.CamH }
func (m *Map) Encode() ([]byte, error) { return vision.EncodePNG(m.M) }

func (Vision) Bits(n int) int { return vision.Bits(n) }

func (Vision) Decode(f cameraport.Frames, projW, projH int) (cameraport.Map, camera.Quality, error) {
	vf := vision.Frames{White: f.White, Black: f.Black}
	for _, p := range f.X {
		vf.X = append(vf.X, [2]image.Image{p[0], p[1]})
	}
	for _, p := range f.Y {
		vf.Y = append(vf.Y, [2]image.Image{p[0], p[1]})
	}
	m, q, err := vision.Decode(vf, projW, projH, vision.DecodeOptions{})
	if err != nil {
		return nil, camera.Quality{}, err
	}
	return wrap(m), camera.Quality{Coverage: q.Coverage, ErrorPx: q.ErrorPx}, nil
}

func (Vision) Load(b []byte) (cameraport.Map, error) {
	m, err := vision.DecodePNG(b)
	if err != nil {
		return nil, err
	}
	return wrap(m), nil
}

func unwrap(m cameraport.Map) (*Map, error) {
	w, ok := m.(*Map)
	if !ok {
		return nil, fmt.Errorf("map is not a vision map")
	}
	return w, nil
}

func pts(in []vision.Pt) []camera.Pt {
	out := make([]camera.Pt, len(in))
	for i, p := range in {
		out[i] = camera.Pt{X: p.X, Y: p.Y}
	}
	return out
}

func (Vision) Detect(m cameraport.Map) []camera.Candidate {
	w, err := unwrap(m)
	if err != nil {
		return nil
	}
	var out []camera.Candidate
	for i, c := range vision.DetectSurfaces(w.M, vision.DetectOptions{}) {
		out = append(out, camera.Candidate{ID: fmt.Sprintf("cand_%d", i+1), Kind: c.Kind, Camera: pts(c.Camera),
			Projector: pts(c.Projector), Confidence: c.Confidence, AreaCamPx: c.AreaCamPx})
	}
	return out
}

func (Vision) Align(lines, lit image.Image, m cameraport.Map, edges [][2]camera.Pt) []camera.EdgeError {
	w, err := unwrap(m)
	if err != nil {
		return nil
	}
	ve := make([][2]vision.Pt, len(edges))
	for i, e := range edges {
		ve[i] = [2]vision.Pt{{X: e[0].X, Y: e[0].Y}, {X: e[1].X, Y: e[1].Y}}
	}
	res := vision.MeasureAlignment(lines, lit, w.M, w.Inv, ve)
	out := make([]camera.EdgeError, len(res))
	for i, r := range res {
		out[i] = camera.EdgeError{Index: r.Index, ErrorPx: r.ErrorPx, Samples: r.Samples}
	}
	return out
}
