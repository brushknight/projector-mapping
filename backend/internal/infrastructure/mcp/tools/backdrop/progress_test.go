package backdrop

import (
	"math"
	"testing"

	"projmap/internal/domain/scene"
)

func TestProgress(t *testing.T) {
	m := scene.DefaultMotion()
	m.Duration, m.StartedAt = 10, 1000
	for _, c := range []struct {
		loop string
		now  float64
		want float64
	}{{"loop", 1000 + 25000, 0.5}, {"once", 1000 + 25000, 1}, {"pingpong", 1000 + 35000, 1.5}, {"loop", 1000, 0}} {
		m.Loop = c.loop
		if got := progress(&m, c.now); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("%s at %v: %v, want %v", c.loop, c.now, got, c.want)
		}
	}
	m.On, m.Phase = false, 0.3
	if got := progress(&m, 99999); got != 0.3 {
		t.Fatalf("paused %v", got)
	}
}
