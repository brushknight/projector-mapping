package app

import (
	"context"
	"encoding/json"
	"time"

	builtin "projmap/internal/catalog"
	"projmap/internal/domain/catalog"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/setup"
)

// The seeded rig and scene (contract/fixtures/setup.json and scene.json).
const (
	SeedSetupID = "set_desk"
	SeedSceneID = "scn_desk"
)

// Seed fills an empty database: the desk setup and scene from the fixtures and the starter presets. It reports
// whether it seeded.
func Seed(ctx context.Context, setups *SetupsModule, scenes *ScenesModule, cat *catalog.Catalog) (bool, error) {
	list, err := setups.Service.List(ctx)
	if err != nil || len(list) > 0 {
		return false, err
	}
	b, err := builtin.Fixture("setup")
	if err != nil {
		return false, err
	}
	var set setup.Setup
	if err := json.Unmarshal(b, &set); err != nil {
		return false, err
	}
	if _, err := setups.Service.Create(ctx, set); err != nil {
		return false, err
	}
	if b, err = builtin.Fixture("scene"); err != nil {
		return false, err
	}
	sc, err := scene.Decode(b)
	if err != nil {
		return false, err
	}
	if err := scenes.Service.Import(ctx, sc); err != nil {
		return false, err
	}
	for _, p := range StarterPresets(cat) {
		p := p
		if err := scenes.Presets.Save(ctx, &p); err != nil {
			return false, err
		}
	}
	return true, nil
}

func light(intensity, softness, angle, scale, kelvin float64, fx string) *scene.Light {
	return &scene.Light{Intensity: intensity, Softness: softness, Angle: angle, Scale: scale,
		Color: scene.Color{Mode: "cct", Kelvin: kelvin, Tint: 0, Hue: 212, Sat: 0.7}, FX: scene.LightFX{Kind: fx, Speed: 0.35}}
}

func defaults(s catalog.Schema) map[string]any {
	out := map[string]any{}
	for k, p := range s {
		if p.Default != nil {
			out[k] = p.Default
		}
	}
	return out
}

// StarterPresets are golden hour, office am, noir blinds, breezy window, storm, ember and flowers.
func StarterPresets(cat *catalog.Catalog) []scene.Preset {
	proc := func(ref string) map[string]any {
		s, _ := cat.LayerSchema("procedural", ref)
		return defaults(s)
	}
	layer := func(id, kind, ref, name, blend string, opacity float64, l *scene.Light, params map[string]any) scene.Layer {
		if params == nil {
			params = map[string]any{}
		}
		return scene.Layer{ID: id, Kind: kind, Ref: ref, Name: name, Visible: true, Opacity: opacity, Blend: blend, Light: l, Params: params}
	}
	storm := light(0.7, 0.3, 0, 1, 6500, "lightning")
	noir := light(0.9, 0.15, -30, 1.2, 4300, "none")
	noir.Color.Tint = -0.05
	gradient := cat.Gradient("ember")
	photo := defaults(cat.PhotoParams)
	t := time.Date(2026, 10, 11, 10, 0, 0, 0, time.UTC)
	mk := func(id, name, mode string, i int, layers ...scene.Layer) scene.Preset {
		return scene.Preset{ID: id, Name: name, Mode: mode, Backdrop: scene.LayerStack{Layers: layers}, CreatedAt: t.Add(time.Duration(i) * time.Second)}
	}
	return []scene.Preset{
		mk("pre_golden", "golden hour", "static", 0, layer("lay_window", "gobo", "window", "window 2×3", "normal", 1, light(0.8, 0.62, -22, 1.4, 3200, "none"), nil)),
		mk("pre_office", "office am", "static", 1, layer("lay_blinds", "gobo", "blinds", "blinds", "normal", 1, light(0.75, 0.45, -10, 1.2, 5600, "none"), nil)),
		mk("pre_noir", "noir blinds", "static", 2, layer("lay_blinds", "gobo", "blinds", "blinds", "normal", 1, noir, nil)),
		mk("pre_breezy", "breezy window", "live", 3,
			layer("lay_window", "gobo", "window", "window 2×3", "normal", 1, light(0.8, 0.55, -18, 1.4, 4000, "none"), nil),
			layer("lay_tree", "procedural", "tree-sway", "tree sway", "multiply", 0.88, light(0.8, 0.62, -22, 1.4, 3200, "none"), proc("tree-sway"))),
		mk("pre_storm", "storm", "live", 4,
			layer("lay_clouds", "procedural", "clouds", "clouds", "normal", 0.9, light(0.5, 0.7, 0, 1, 7000, "none"), proc("clouds")),
			layer("lay_lightning", "procedural", "lightning", "lightning", "screen", 1, storm, proc("lightning"))),
		mk("pre_ember", "ember", "color", 5, layer("lay_ember", "gradient", "ember", "ember", "normal", 1, nil, gradient)),
		mk("pre_flowers", "flowers", "scenery", 6, layer("lay_flowers", "photo", "flowers", "flowers", "normal", 1, nil, photo)),
	}
}
