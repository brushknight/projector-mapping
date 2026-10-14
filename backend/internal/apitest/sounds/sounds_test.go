package sounds

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
)

type asset struct {
	SHA      string    `json:"sha"`
	Mime     string    `json:"mime"`
	Kind     string    `json:"kind"`
	Name     string    `json:"name"`
	Duration *float64  `json:"duration"`
	Peaks    []float64 `json:"peaks"`
}

func upload(t *testing.T, h *apitest.H, path, file string, data []byte, fields map[string]string) asset {
	t.Helper()
	r := h.Do("POST", path, apitest.File(file, data, fields))
	apitest.Expect(t, r, http.StatusCreated)
	var a asset
	r.Into(t, &a)
	return a
}

func snapList(t *testing.T, m apitest.Msg) []asset {
	t.Helper()
	var l []asset
	m.Into(t, &l)
	return l
}

func TestSoundLibrary(t *testing.T) {
	apitest.ToolsPath(t, nil) // no ffmpeg: the server reads WAV and AIFF itself and keeps what the uploader decoded
	h := apitest.New(t)
	ws := h.Connect("editor", "editor")
	if l := snapList(t, ws.Sub("sounds")); len(l) != 0 {
		t.Fatalf("sounds %v", l)
	}

	a := upload(t, h, "/api/v1/sounds", "Door Knock.wav", apitest.WAV(8000, 2, 2.5), nil)
	if a.Kind != "sound" || a.Mime != "audio/wav" || a.Name != "Door Knock" || a.Duration == nil || *a.Duration != 2.5 || len(a.Peaks) != 128 {
		t.Fatalf("wav %+v", a)
	}
	for i, p := range a.Peaks {
		if p < 0.7 || p > 0.81 {
			t.Fatalf("peak %d = %v, want about 0.8", i, p)
		}
	}
	if l := snapList(t, ws.NextOn("snapshot", "sounds")); len(l) != 1 || l[0].SHA != a.SHA {
		t.Fatalf("sounds snapshot %v", l)
	}
	// the uploader's own decode is kept when the server cannot read the file
	mp3 := append([]byte("ID3\x04\x00\x00\x00\x00\x00\x00"), make([]byte, 200)...)
	b := upload(t, h, "/api/v1/sounds", "rain.mp3", mp3, map[string]string{"name": "rain on glass", "duration": "12.48", "peaks": "[0.1, 0.5, 2]"})
	if b.Mime != "audio/mpeg" || b.Name != "rain on glass" || *b.Duration != 12.48 || len(b.Peaks) != 3 || b.Peaks[2] != 1 {
		t.Fatalf("mp3 %+v", b)
	}
	// without them: duration 0 and no peaks, never null
	ogg := append([]byte("OggS\x00\x02"), make([]byte, 100)...)
	o := upload(t, h, "/api/v1/sounds", "wind.ogg", ogg, nil)
	if o.Duration == nil || *o.Duration != 0 || o.Peaks == nil || len(o.Peaks) != 0 || !strings.Contains(string(h.Do("GET", "/api/v1/sounds", nil).Body), `"peaks":[]`) {
		t.Fatalf("ogg %+v", o)
	}
	// POST /assets kind=sound does the same
	c := upload(t, h, "/api/v1/assets", "beep.wav", apitest.WAV(16000, 1, 0.5), map[string]string{"kind": "sound"})
	if c.Kind != "sound" || c.Name != "beep" || *c.Duration != 0.5 || len(c.Peaks) != 128 {
		t.Fatalf("assets kind=sound %+v", c)
	}
	l := h.Do("GET", "/api/v1/sounds", nil).List(t)
	if len(l) != 4 {
		t.Fatalf("library %d", len(l))
	}
	// anything else is refused
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/sounds", apitest.File("notes.txt", []byte("hello there, not audio"), nil)), http.StatusBadRequest, "unsupported")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/sounds", apitest.File("clip.mp4", []byte("\x00\x00\x00\x20ftypisom\x00\x00\x00\x00"), nil)), http.StatusBadRequest, "unsupported")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/sounds", apitest.File("x.wav", apitest.WAV(8000, 1, 0.1), map[string]string{"peaks": "nope"})), http.StatusBadRequest, "bad_request")

	// rename and delete publish the list
	r := h.Do("PATCH", "/api/v1/sounds/"+a.SHA, map[string]any{"name": " knock knock "})
	apitest.Expect(t, r, http.StatusOK)
	if r.Map(t)["name"] != "knock knock" {
		t.Fatalf("rename %s", r.Body)
	}
	ws.NextWhere(func(m apitest.Msg) bool {
		return m.T == "snapshot" && m.Ch == "sounds" && strings.Contains(string(m.D), "knock knock")
	}, "renamed sounds snapshot")
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/sounds/"+a.SHA, map[string]any{"name": ""}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/sounds/nope", map[string]any{"name": "x"}), http.StatusNotFound, "not_found")
	apitest.Expect(t, h.Do("GET", "/a/"+a.SHA, nil), http.StatusOK)
	apitest.Expect(t, h.Do("DELETE", "/api/v1/sounds/"+a.SHA, nil), http.StatusNoContent)
	ws.NextWhere(func(m apitest.Msg) bool {
		return m.T == "snapshot" && m.Ch == "sounds" && !strings.Contains(string(m.D), a.SHA)
	}, "sounds snapshot without the deleted sound")
	apitest.Expect(t, h.Do("GET", "/a/"+a.SHA, nil), http.StatusNotFound)
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/sounds/"+a.SHA, nil), http.StatusNotFound, "not_found")
	if len(h.Do("GET", "/api/v1/sounds", nil).List(t)) != 3 {
		t.Fatal("the sound is still listed")
	}
	// the same file again comes back as a new sound
	again := upload(t, h, "/api/v1/sounds", "Door Knock.wav", apitest.WAV(8000, 2, 2.5), nil)
	if again.SHA != a.SHA || again.Name != "Door Knock" {
		t.Fatalf("again %+v", again)
	}
}

func op(o, path string, v any) map[string]any {
	return map[string]any{"op": o, "path": path, "value": v}
}

// patchDesk patches the desk scene on its current version.
func patchDesk(t *testing.T, h *apitest.H, ops ...any) *apitest.Resp {
	t.Helper()
	v := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["version"]
	return h.Do("POST", "/api/v1/scenes/scn_desk/patch", map[string]any{"base": v, "ops": ops})
}

func pad(id, name, sound string, loop bool) map[string]any {
	return map[string]any{"id": id, "name": name, "sound": sound, "volume": 0.9, "color": "blue", "icon": "thunder", "key": "t", "loop": loop}
}

func TestPads(t *testing.T) {
	h := apitest.New(t)
	sc := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)
	if pads := sc["sounds"].(map[string]any)["pads"].([]any); len(pads) != 0 {
		t.Fatalf("the seeded scene has no pads (their sounds are not on this server): %v", pads)
	}
	patch := func(ops ...any) *apitest.Resp { return patchDesk(t, h, ops...) }
	apitest.Expect(t, patch(op("add", "/sounds/pads/-", pad("pad_a", "thunder", "a77c31", false))), http.StatusOK)
	apitest.Expect(t, patch(op("add", "/sounds/pads/-", map[string]any{"id": "pad_b", "name": "rain"})), http.StatusOK)
	apitest.Expect(t, patch(op("replace", "/sounds/pads/0/volume", 0.4)), http.StatusOK)
	pads := h.Do("GET", "/api/v1/scenes/scn_desk", nil).Map(t)["sounds"].(map[string]any)["pads"].([]any)
	b := pads[1].(map[string]any)
	if len(pads) != 2 || pads[0].(map[string]any)["volume"] != 0.4 || b["volume"] != float64(1) || b["color"] != "ink" || b["icon"] != "none" || b["loop"] != false {
		t.Fatalf("pads %v", pads)
	}
	for _, bad := range []map[string]any{
		pad("pad_a", "twice", "s", false),
		pad("pad_c", strings.Repeat("x", 41), "s", false),
		{"id": "pad_d", "name": "x", "volume": 2},
		{"id": "pad_e", "name": "x", "color": "mauve"},
		{"id": "pad_f", "name": "x", "icon": "cat"},
		{"id": "pad_g", "name": "x", "key": "T"},
		{"id": "pad_h", "name": ""},
	} {
		apitest.ExpectErr(t, patch(op("add", "/sounds/pads/-", bad)), http.StatusUnprocessableEntity, "invalid")
	}
	// sound tracks, clips and cue sounds
	apitest.Expect(t, patch(op("add", "/timeline/tracks/-", map[string]any{"id": "trk_snd", "name": "sound", "target": map[string]any{"kind": "sound", "id": nil}}),
		op("add", "/timeline/clips/-", map[string]any{"id": "clp_s", "trackId": "trk_snd", "effect": "sound", "start": 1, "end": 3, "fadeIn": 0, "fadeOut": 0,
			"params": map[string]any{"sound": "a77c31", "offset": 0.5, "volume": 0.8}}),
		op("add", "/timeline/cues/0/sound", map[string]any{"sound": "a77c31", "volume": 1})), http.StatusOK)
	apitest.ExpectErr(t, patch(op("add", "/timeline/clips/-", map[string]any{"id": "clp_x", "trackId": "trk_snd", "effect": "pulse", "start": 1, "end": 3, "fadeIn": 0, "fadeOut": 0, "params": map[string]any{}})),
		http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, patch(op("add", "/timeline/clips/-", map[string]any{"id": "clp_y", "trackId": "trk_all", "effect": "sound", "start": 1, "end": 3, "fadeIn": 0, "fadeOut": 0, "params": map[string]any{"sound": "a"}})),
		http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, patch(op("replace", "/timeline/clips/11/params/volume", 3)), http.StatusUnprocessableEntity, "invalid")
	// video layers: asset: or youtube: refs, catalog videoParams
	video := map[string]any{"id": "lay_v", "kind": "video", "ref": "youtube:aqz-KE-bpKQ", "name": "waves", "visible": true, "opacity": 1, "blend": "normal", "light": nil,
		"params": map[string]any{"blur": 0.2, "brightness": 0.8, "warmth": 0, "drift": 0, "start": 12, "end": 0, "audio": false, "volume": 1}}
	apitest.Expect(t, patch(op("add", "/backdrop/scenery/layers/0", video)), http.StatusOK)
	apitest.ExpectErr(t, patch(op("replace", "/backdrop/scenery/layers/0/ref", "youtube:bad")), http.StatusUnprocessableEntity, "invalid")
	apitest.ExpectErr(t, patch(op("replace", "/backdrop/scenery/layers/0/params/blur", 2)), http.StatusUnprocessableEntity, "invalid")
	apitest.Expect(t, patch(op("replace", "/backdrop/scenery/layers/0/ref", "asset:7c4e1d")), http.StatusOK)
}

// fixture sets up pads on the desk scene and returns the sha of a library sound.
func fixture(t *testing.T, h *apitest.H) string {
	t.Helper()
	a := upload(t, h, "/api/v1/sounds", "thunder.wav", apitest.WAV(8000, 1, 1), nil)
	r := patchDesk(t, h,
		op("add", "/sounds/pads/-", pad("pad_thunder", "thunder", a.SHA, false)),
		op("add", "/sounds/pads/-", pad("pad_rain", "rain", a.SHA, true)),
		op("add", "/sounds/pads/-", map[string]any{"id": "pad_empty", "name": "empty"}),
	)
	apitest.Expect(t, r, http.StatusOK)
	return a.SHA
}

type play struct {
	PlayID string  `json:"playId"`
	Sound  string  `json:"sound"`
	PadID  string  `json:"padId"`
	CueID  string  `json:"cueId"`
	Name   string  `json:"name"`
	Volume float64 `json:"volume"`
	Loop   bool    `json:"loop"`
}

type ack struct {
	PlayID  string `json:"playId"`
	Outputs int    `json:"outputs"`
	Stopped bool   `json:"stopped"`
}

var seq int

func cmd(t *testing.T, ws *apitest.WS, name string, args map[string]any) apitest.Msg {
	t.Helper()
	seq++
	id := "c" + string(rune('a'+seq%26)) + time.Now().Format("150405.000000")
	ws.Send(apitest.Msg{T: "cmd", ID: id, D: apitest.Data(map[string]any{"name": name, "args": args})})
	return ws.NextWhere(func(m apitest.Msg) bool { return (m.T == "ack" || m.T == "error") && m.Re == id }, "reply to "+name)
}

func ackOf(t *testing.T, m apitest.Msg) ack {
	t.Helper()
	if m.T != "ack" {
		t.Fatalf("want ack, got %s %s", m.T, m.D)
	}
	var a ack
	m.Into(t, &a)
	return a
}

func errCode(t *testing.T, m apitest.Msg) string {
	t.Helper()
	if m.T != "error" {
		t.Fatalf("want error, got %s %s", m.T, m.D)
	}
	var e struct{ Code, Message string }
	m.Into(t, &e)
	return e.Code
}

func loops(t *testing.T, h *apitest.H) []any {
	t.Helper()
	return h.Do("GET", "/api/v1/show", nil).Map(t)["audio"].(map[string]any)["loops"].([]any)
}

const quiet = 150 * time.Millisecond

func TestPlayRouting(t *testing.T) {
	h := apitest.New(t)
	sha := fixture(t, h)
	ctl := h.Connect("remote", "phone")
	// nothing plays sound yet
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder"})); c != "no_audio" {
		t.Fatalf("code %s", c)
	}
	m := apitest.ExpectErr(t, h.Do("POST", "/api/v1/sounds/play", map[string]any{"padId": "pad_thunder"}), http.StatusConflict, "no_audio")
	if m["message"] != "Nothing plays sound right now. Open /out on the projector computer and click it once." {
		t.Fatalf("message %v", m["message"])
	}

	out := h.Connect("output", "projector", "render", "audio")
	preview := h.Connect("output", "preview", "render")
	editor := h.Connect("editor", "editor", "audio")
	isPlay := apitest.Is("sound.play", "")

	a := ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder", "volume": 0.5}))
	if a.Outputs != 1 || !strings.HasPrefix(a.PlayID, "ply_") {
		t.Fatalf("ack %+v", a)
	}
	var p play
	got := out.Next("sound.play")
	got.Into(t, &p)
	if got.Ch != "" || p.PlayID != a.PlayID || p.Sound != sha || p.PadID != "pad_thunder" || p.Name != "thunder" || p.Volume != 0.45 || p.Loop {
		t.Fatalf("sound.play %s", got.D)
	}
	preview.None(isPlay, quiet, "sound.play on a client without cap audio")
	editor.None(isPlay, quiet, "sound.play on the editor while output is projector")
	ctl.None(isPlay, quiet, "sound.play on a remote without cap audio")

	// a library sound by sha, over REST
	r := h.Do("POST", "/api/v1/sounds/play", map[string]any{"soundId": sha})
	apitest.Expect(t, r, http.StatusOK)
	p = play{}
	out.Next("sound.play").Into(t, &p)
	if p.Sound != sha || p.PadID != "" || p.Name != "thunder" || p.Volume != 1 {
		t.Fatalf("sound by sha %+v", p)
	}
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_nope"})); c != "not_found" {
		t.Fatalf("unknown pad %s", c)
	}
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_empty"})); c != "bad_request" {
		t.Fatalf("pad without a sound %s", c)
	}
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{"soundId": "nope"})); c != "not_found" {
		t.Fatalf("unknown sound %s", c)
	}
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{})); c != "bad_request" {
		t.Fatalf("no pad or sound %s", c)
	}
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder", "volume": 2})); c != "bad_request" {
		t.Fatalf("volume 2 %s", c)
	}

	// the output follows show.audio.output
	if m := cmd(t, ctl, "show.audio", map[string]any{"output": "editor", "volume": 0.7}); m.T != "ack" {
		t.Fatalf("show.audio %s %s", m.T, m.D)
	}
	s := h.Do("GET", "/api/v1/show", nil).Map(t)["audio"].(map[string]any)
	if s["output"] != "editor" || s["volume"] != 0.7 || s["muted"] != false {
		t.Fatalf("audio %v", s)
	}
	ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder"}))
	editor.Next("sound.play")
	out.None(isPlay, quiet, "sound.play on /out while output is editor")
	apitest.Expect(t, h.Do("POST", "/api/v1/show/audio", map[string]any{"output": "phone"}), http.StatusOK)
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder"})); c != "no_audio" {
		t.Fatalf("a phone without cap audio: %s", c)
	}
	phone := h.Connect("remote", "iphone", "haptics", "audio")
	ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder"}))
	phone.Next("sound.play")
	editor.None(isPlay, quiet, "sound.play on the editor while output is phone")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/audio", map[string]any{"output": "tv"}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/show/audio", map[string]any{"volume": 1.5}), http.StatusBadRequest, "bad_request")
	apitest.Expect(t, h.Do("POST", "/api/v1/show/audio", map[string]any{"muted": true}), http.StatusOK)
	if s := h.Do("GET", "/api/v1/show", nil).Map(t)["audio"].(map[string]any); s["muted"] != true || s["output"] != "phone" || s["volume"] != 0.7 {
		t.Fatalf("muted keeps the rest %v", s)
	}
}

func TestLoops(t *testing.T) {
	h := apitest.New(t)
	fixture(t, h)
	out := h.Connect("output", "projector", "render", "audio")
	ctl := h.Connect("editor", "editor")
	watch := h.Connect("remote", "watcher")
	watch.Sub("show")

	a := ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_rain"}))
	var p play
	out.Next("sound.play").Into(t, &p)
	if !p.Loop || a.Outputs != 1 {
		t.Fatalf("loop play %+v %+v", p, a)
	}
	if l := loops(t, h); len(l) != 1 || l[0] != "pad_rain" {
		t.Fatalf("loops %v", l)
	}
	watch.NextWhere(func(m apitest.Msg) bool {
		return m.T == "snapshot" && m.Ch == "show" && strings.Contains(string(m.D), `"loops":["pad_rain"]`)
	}, "show with the loop")
	// pressing it again stops it
	a = ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_rain"}))
	if !a.Stopped || a.PlayID != "" {
		t.Fatalf("second press %+v", a)
	}
	stop := out.Next("sound.stop")
	if !strings.Contains(string(stop.D), `"padId":"pad_rain"`) {
		t.Fatalf("stop %s", stop.D)
	}
	if l := loops(t, h); len(l) != 0 {
		t.Fatalf("loops after toggle %v", l)
	}
	// sound.stop without ids clears every loop
	ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_rain"}))
	out.Next("sound.play")
	ackOf(t, cmd(t, ctl, "sound.stop", map[string]any{}))
	if s := out.Next("sound.stop"); string(s.D) != "{}" {
		t.Fatalf("stop all %s", s.D)
	}
	if l := loops(t, h); len(l) != 0 {
		t.Fatalf("loops after stop all %v", l)
	}
	// stopping the play id of a loop frees the pad
	a = ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_rain"}))
	out.Next("sound.play")
	r := h.Do("POST", "/api/v1/sounds/stop", map[string]any{"playId": a.PlayID})
	apitest.Expect(t, r, http.StatusOK)
	out.Next("sound.stop")
	if l := loops(t, h); len(l) != 0 {
		t.Fatalf("loops after stopping its play %v", l)
	}
	// show.stop and activate clear loops (and stop them)
	ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_rain"}))
	out.Next("sound.play")
	apitest.Expect(t, h.Do("POST", "/api/v1/show/stop", nil), http.StatusOK)
	out.Next("sound.stop")
	if l := loops(t, h); len(l) != 0 {
		t.Fatalf("loops after show.stop %v", l)
	}
	ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_rain"}))
	out.Next("sound.play")
	other := h.Do("POST", "/api/v1/scenes", map[string]any{"name": "Other"}).Map(t)["id"].(string)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/activate", map[string]any{"sceneId": other}), http.StatusOK)
	out.Next("sound.stop")
	if l := loops(t, h); len(l) != 0 {
		t.Fatalf("loops after activate %v", l)
	}
	// a pad of another scene plays with sceneId
	ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder", "sceneId": "scn_desk"}))
	out.Next("sound.play")
	if c := errCode(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_thunder"})); c != "not_found" {
		t.Fatalf("the active scene has no such pad: %s", c)
	}
	// a restart clears loops
	apitest.Expect(t, h.Do("POST", "/api/v1/show/activate", map[string]any{"sceneId": "scn_desk"}), http.StatusOK)
	ackOf(t, cmd(t, ctl, "sound.play", map[string]any{"padId": "pad_rain"}))
	h.Restart(nil)
	if l := loops(t, h); len(l) != 0 {
		t.Fatalf("loops after a restart %v", l)
	}
}

func TestCueSounds(t *testing.T) {
	h := apitest.New(t)
	sha := fixture(t, h)
	out := h.Connect("output", "projector", "render", "audio")
	r := patchDesk(t, h,
		op("add", "/timeline/cues/0/sound", map[string]any{"sound": sha, "volume": 0.6}),
		op("add", "/timeline/cues/1/sound", map[string]any{"sound": sha}),
		op("replace", "/timeline/cues/1/autoFollow", true),
	)
	apitest.Expect(t, r, http.StatusOK)
	isPlay := apitest.Is("sound.play", "")

	// GO starts cue 1 on the wall: its sound plays
	apitest.Expect(t, h.Do("POST", "/api/v1/show/go", nil), http.StatusOK)
	var p play
	out.Next("sound.play").Into(t, &p)
	if p.CueID != "cue_1" || p.Sound != sha || p.Volume != 0.6 || p.Loop || p.Name != "thunder" || p.PadID != "" {
		t.Fatalf("cue sound %+v", p)
	}
	// seeking does not fire cue sounds, but playback passing an auto-follow cue does
	apitest.Expect(t, h.Do("POST", "/api/v1/show/seek", map[string]any{"t": 3.8}), http.StatusOK)
	p = play{}
	out.Next("sound.play").Into(t, &p)
	if p.CueID != "cue_2" || p.Volume != 1 {
		t.Fatalf("auto-follow cue sound %+v", p)
	}
	apitest.Expect(t, h.Do("POST", "/api/v1/show/back", nil), http.StatusOK)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/seek", map[string]any{"t": 0}), http.StatusOK)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/pause", nil), http.StatusOK)
	out.None(isPlay, quiet, "a cue sound on seek or back")
	// GO onto cue 3 (no sound) plays nothing
	apitest.Expect(t, h.Do("POST", "/api/v1/show/seek", map[string]any{"t": 4.5}), http.StatusOK)
	apitest.Expect(t, h.Do("POST", "/api/v1/show/go", nil), http.StatusOK)
	out.None(isPlay, quiet, "a sound for a cue without one")
}
