package scene

import "testing"

// TestNewLiveLayerBlend: (§16) shadow layers start as masks over the light (the catalog item's blend); light effects
// and lightning keep blend normal.
func TestNewLiveLayerBlend(t *testing.T) {
	c := refsT(t).c
	for ref, want := range map[string]string{"tree-sway": "multiply", "palm-sway": "multiply", "clouds": "multiply", "rain-glass": "multiply", "dapple": "multiply", "lightning": "normal", "day-cycle": "normal", "candle-flicker": "normal"} {
		l, err := NewLayer(c, "procedural", ref)
		if err != nil {
			t.Fatal(err)
		}
		if l.Blend != want {
			t.Errorf("%s: blend %q, want %q", ref, l.Blend, want)
		}
	}
	if g, err := NewLayer(c, "gradient", "ember"); err != nil || g.Blend != "normal" {
		t.Errorf("a gradient stays normal: %v %v", g.Blend, err)
	}
}
