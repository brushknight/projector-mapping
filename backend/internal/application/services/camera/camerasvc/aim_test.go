package camerasvc

import (
	"context"
	"image"
	"io"
	"log/slog"
	"math/rand"
	"strings"
	"testing"

	"projmap/internal/application/ports/out/realtime"
	"projmap/internal/domain/camera"
)

func lit(w, h int, x0, y0, x1, y1 int, noise *rand.Rand) *image.Gray {
	g := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			v := 20
			if x >= x0 && x < x1 && y >= y0 && y < y1 {
				v = 200
			}
			if noise != nil {
				v += noise.Intn(21) - 10
			}
			g.Pix[y*g.Stride+x] = uint8(v)
		}
	}
	return g
}

func TestMoved(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	black := lit(640, 480, 0, 0, 0, 0, r)
	a := lit(640, 480, 100, 80, 540, 400, r)
	if d := Moved(a, lit(640, 480, 100, 80, 540, 400, r), black); d > 1.5 {
		t.Fatalf("still phone measured %.2f px", d)
	}
	if d := Moved(a, lit(640, 480, 102, 81, 542, 401, r), black); d > MovedLimitPx {
		t.Fatalf("a 2 px drift is tolerated, measured %.2f px", d)
	}
	if d := Moved(a, lit(640, 480, 120, 90, 560, 410, r), black); d < MovedLimitPx {
		t.Fatalf("a 20 px move fails, measured %.2f px", d)
	}
}

type memRepo struct {
	m map[string]*camera.Calibration
}

func (r *memRepo) Get(_ context.Context, id string) (*camera.Calibration, error) { return r.m[id], nil }
func (r *memRepo) Save(_ context.Context, c *camera.Calibration) error           { r.m[c.ID] = c; return nil }
func (r *memRepo) Running(context.Context) ([]*camera.Calibration, error) {
	var out []*camera.Calibration
	for _, c := range r.m {
		if c.Status == camera.CalRunning {
			out = append(out, c)
		}
	}
	return out, nil
}

type pubRec struct{ msgs []realtime.Message }

func (p *pubRec) Publish(ch string, m realtime.Message)                 { p.msgs = append(p.msgs, m) }
func (p *pubRec) PublishExcept(ch string, m realtime.Message, _ string) { p.msgs = append(p.msgs, m) }

// TestRecoverFailsInterruptedCalibrations: a calibration left "running" by a server that died is failed on start and
// the failure goes out on calib:{id}.
func TestRecoverFailsInterruptedCalibrations(t *testing.T) {
	repo := &memRepo{m: map[string]*camera.Calibration{
		"cal_a": {ID: "cal_a", Status: camera.CalRunning},
		"cal_b": {ID: "cal_b", Status: camera.CalDone},
	}}
	pub := &pubRec{}
	s := NewCalibrations(repo, nil, nil, nil, nil, nil, pub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	s.Recover(context.Background())
	if c := repo.m["cal_a"]; c.Status != camera.CalFailed || !strings.Contains(c.Message, "server restarted") {
		t.Fatalf("cal_a %+v", c)
	}
	if repo.m["cal_b"].Status != camera.CalDone {
		t.Fatal("a done calibration stays done")
	}
	if len(pub.msgs) != 1 || pub.msgs[0].Ch != "calib:cal_a" || !strings.Contains(string(pub.msgs[0].D), `"failed"`) {
		t.Fatalf("published %+v", pub.msgs)
	}
	p, _ := s.Progress(context.Background(), "cal_a")
	if p.Step != "failed" {
		t.Fatalf("progress %+v", p)
	}
}
