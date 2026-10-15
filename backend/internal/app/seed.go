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
	// the fixture's pads, sound clips, cue sounds and video layers point at files this server does not have
	sc.StripMedia()
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

// stackLight is a CCT stack light (protocol §15).
func stackLight(intensity, focus, kelvin, tint float64) *scene.StackLight {
	l := scene.DefaultStackLight()
	l.Intensity, l.Focus, l.Color.Kelvin, l.Color.Tint = intensity, focus, kelvin, tint
	return &l
}

// StarterPresets are golden hour, office am, noir blinds, breezy window, storm, ember and flowers.
func StarterPresets(cat *catalog.Catalog) []scene.Preset {
	proc := func(ref string) map[string]any {
		s, _ := cat.LayerSchema("procedural", ref)
		return catalog.Defaults(s)
	}
	layer := func(id, kind, ref, name, blend string, opacity float64, l *scene.Light, params map[string]any) scene.Layer {
		if params == nil {
			params = map[string]any{}
		}
		return scene.Layer{ID: id, Kind: kind, Ref: ref, Name: name, Visible: true, Opacity: opacity, Blend: blend, Light: l, Params: params}
	}
	att := func(id, gobo string, rotation float64) scene.Attachment {
		a, _ := scene.NewAttachment(cat, gobo, nil)
		a.ID = id
		a.Rotation = rotation
		return a
	}
	storm := light(0.7, 0.3, 0, 1, 6500, "lightning")
	gradient := cat.Gradient("ember")
	photo := catalog.Defaults(cat.PhotoParams)
	t := time.Date(2026, 10, 11, 10, 0, 0, 0, time.UTC)
	mk := func(id, name, mode string, i int, st scene.LayerStack) scene.Preset {
		if st.Layers == nil {
			st.Layers = []scene.Layer{}
		}
		if (mode == scene.ModeStatic || mode == scene.ModeLive) && st.Attachments == nil {
			st.Attachments = []scene.Attachment{}
		}
		return scene.Preset{ID: id, Name: name, Mode: mode, Backdrop: st, CreatedAt: t.Add(time.Duration(i) * time.Second)}
	}
	return []scene.Preset{
		mk("pre_golden", "golden hour", "static", 0, scene.LayerStack{Light: stackLight(0.85, 0.38, 3200, 0.04),
			Attachments: []scene.Attachment{att("att_golden", "window", -22)}}),
		mk("pre_office", "office am", "static", 1, scene.LayerStack{Light: stackLight(0.75, 0.55, 5600, 0),
			Attachments: []scene.Attachment{att("att_office", "blinds", -10)}}),
		mk("pre_noir", "noir blinds", "static", 2, scene.LayerStack{Light: stackLight(0.9, 0.85, 4300, -0.05),
			Attachments: []scene.Attachment{att("att_noir", "blinds", -30)}}),
		mk("pre_breezy", "breezy window", "live", 3, scene.LayerStack{Light: stackLight(0.8, 0.45, 4000, 0),
			Attachments: []scene.Attachment{att("att_breezy", "window", -18)},
			Layers:      []scene.Layer{layer("lay_breezy_tree", "procedural", "tree-sway", "tree sway", "multiply", 0.88, light(0.8, 0.62, -22, 1.4, 3200, "none"), proc("tree-sway"))}}),
		mk("pre_storm", "storm", "live", 4, scene.LayerStack{Layers: []scene.Layer{
			layer("lay_clouds", "procedural", "clouds", "clouds", "normal", 0.9, light(0.5, 0.7, 0, 1, 7000, "none"), proc("clouds")),
			layer("lay_lightning", "procedural", "lightning", "lightning", "screen", 1, storm, proc("lightning"))}}),
		mk("pre_ember", "ember", "color", 5, scene.LayerStack{Layers: []scene.Layer{layer("lay_ember", "gradient", "ember", "ember", "normal", 1, nil, gradient)}}),
		mk("pre_flowers", "flowers", "scenery", 6, scene.LayerStack{Layers: []scene.Layer{layer("lay_flowers", "photo", "flowers", "flowers", "normal", 1, nil, photo)}}),
	}
}
