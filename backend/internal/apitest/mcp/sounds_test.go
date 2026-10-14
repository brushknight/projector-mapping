package mcp

import (
	"net/http"
	"strings"
	"testing"

	"projmap/internal/apitest"
)

func TestSoundTools(t *testing.T) {
	h := apitest.New(t)
	r := h.Do("POST", "/api/v1/sounds", apitest.File("thunder clap.wav", apitest.WAV(8000, 1, 2), nil))
	apitest.Expect(t, r, http.StatusCreated)
	sha := r.Map(t)["sha"].(string)
	s, err := connect(t, h, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	text, res := call(t, s, "sound_list", nil)
	if res.IsError || !strings.Contains(text, sha) || !strings.Contains(text, "thunder clap") || !strings.Contains(text, `"duration": 2`) {
		t.Fatalf("sound_list %s", text)
	}
	// a sound clip by name makes the scene's first sound track; the second reuses it
	text, res = call(t, s, "clip_add", map[string]any{"sound": "Thunder Clap", "start": 1, "end": 3, "offset": 0.5, "volume": 0.7})
	if res.IsError {
		t.Fatalf("clip_add %s", text)
	}
	text, res = call(t, s, "clip_add", map[string]any{"sound": sha[:8], "start": 5})
	if res.IsError || !strings.Contains(text, "5.00 to 7.00") {
		t.Fatalf("clip_add without end takes the sound's length: %s", text)
	}
	text, res = call(t, s, "clip_add", map[string]any{"sound": "nope", "start": 1, "end": 2})
	if !res.IsError || !strings.Contains(text, "sound_list") {
		t.Fatalf("unknown sound %s", text)
	}
	text, res = call(t, s, "clip_add", map[string]any{"sound": sha, "track": "trk_all", "start": 1, "end": 2})
	if !res.IsError || !strings.Contains(text, "not a sound track") {
		t.Fatalf("a sound clip on trk_all %s", text)
	}
	text, _ = call(t, s, "timeline_get", nil)
	if strings.Count(text, `"kind": "sound"`) != 1 || strings.Count(text, `"effect": "sound"`) != 2 || !strings.Contains(text, `"offset": 0.5`) {
		t.Fatalf("timeline %s", text)
	}

	// playing needs "agent may preview" and an audio output
	text, res = call(t, s, "sound_play", map[string]any{"name": "thunder clap"})
	if !res.IsError || !strings.Contains(text, "agent may preview") {
		t.Fatalf("ungated sound_play %s", text)
	}
	h.Do("PATCH", "/api/v1/settings", map[string]any{"agentMayPreview": true})
	text, res = call(t, s, "sound_play", map[string]any{"name": "thunder clap"})
	if !res.IsError || !strings.Contains(text, "Nothing plays sound right now") {
		t.Fatalf("no audio %s", text)
	}
	out := h.Connect("output", "projector", "render", "audio")
	text, res = call(t, s, "sound_play", map[string]any{"sound": sha, "volume": 0.5})
	if res.IsError || !strings.Contains(text, "1 audio output") {
		t.Fatalf("sound_play %s", text)
	}
	if m := out.Next("sound.play"); !strings.Contains(string(m.D), sha) || !strings.Contains(string(m.D), `"volume":0.5`) {
		t.Fatalf("sound.play %s", m.D)
	}
	text, res = call(t, s, "sound_play", map[string]any{"pad": "pad_nope"})
	if !res.IsError || !strings.Contains(text, "soundboard") {
		t.Fatalf("unknown pad %s", text)
	}
}
