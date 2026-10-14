package showsvc

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"testing"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	scenessvc "projmap/internal/application/services/scenes"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/show"
)

type memKV struct {
	mu sync.Mutex
	m  map[string][]byte
}

func (k *memKV) Get(_ context.Context, key string) ([]byte, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.m[key], nil
}

func (k *memKV) Put(_ context.Context, key string, v []byte) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.m[key] = v
	return nil
}

// fakeScenes holds scenes in memory; only List and Scene are used by the show.
type fakeScenes struct {
	scenessvc.SceneService
	scenes []*scene.Scene
}

func (f *fakeScenes) List(context.Context) ([]scene.Summary, error) {
	var out []scene.Summary
	for _, s := range f.scenes {
		out = append(out, scene.Summary{ID: s.ID, Name: s.Name, SetupID: s.SetupID, Version: s.Version})
	}
	return out, nil
}

func (f *fakeScenes) Scene(_ context.Context, id string) (*scene.Scene, error) {
	for _, s := range f.scenes {
		if s.ID == id {
			c := *s
			return &c, nil
		}
	}
	return nil, app_errors.NotFound("Scene %s does not exist.", id)
}

type sent struct {
	to realtime.Target
	m  realtime.Message
}

type fakeDirect struct {
	clients int
	sent    []sent
}

func (d *fakeDirect) SendDirect(to realtime.Target, m realtime.Message) int {
	d.sent = append(d.sent, sent{to, m})
	return d.clients
}

func newService(t *testing.T, kv *memKV, scenes *fakeScenes) (*Service, *fakeDirect) {
	t.Helper()
	s, err := New(context.Background(), kv, scenes, realtime.Nop{}, slog.New(slog.NewTextHandler(io.Discard, nil)), show.Show{OnAir: true})
	if err != nil {
		t.Fatal(err)
	}
	d := &fakeDirect{clients: 1}
	s.UseAudio(d, nil)
	return s, d
}

func desk() *scene.Scene {
	sc := scene.New("scn_a", "set_a", "A")
	sc.Sounds.Pads = []scene.Pad{{ID: "pad_rain", Name: "rain", Sound: "5d1e0a", Volume: 0.6, Color: "teal", Icon: "rain", Loop: true},
		{ID: "pad_bell", Name: "bell", Sound: "a77c31", Volume: 1, Color: "ink", Icon: "bell"}}
	return &sc
}

func TestStartActivatesFirstScene(t *testing.T) {
	kv := &memKV{m: map[string][]byte{}}
	b := scene.New("scn_b", "set_a", "B")
	s, _ := newService(t, kv, &fakeScenes{scenes: []*scene.Scene{desk(), &b}})
	if st := s.Get(context.Background()); st.ActiveSceneID != "scn_a" || st.ActiveSetupID != "set_a" || st.Audio == nil || st.Audio.Output != "projector" {
		t.Fatalf("state %+v", st)
	}
	var stored show.Show
	if err := json.Unmarshal(kv.m["show"], &stored); err != nil || stored.ActiveSceneID != "scn_a" {
		t.Fatalf("not stored at once: %s", kv.m["show"])
	}
	// the stored scene wins while it exists
	stored.ActiveSceneID = "scn_b"
	raw, _ := json.Marshal(stored)
	kv.m["show"] = raw
	s, _ = newService(t, kv, &fakeScenes{scenes: []*scene.Scene{desk(), &b}})
	if s.Get(context.Background()).ActiveSceneID != "scn_b" {
		t.Fatal("the stored active scene was replaced")
	}
	// and a server without scenes has none
	s, _ = newService(t, &memKV{m: map[string][]byte{}}, &fakeScenes{})
	if s.Get(context.Background()).ActiveSceneID != "" {
		t.Fatal("no scenes, no active scene")
	}
}

func TestLoopToggling(t *testing.T) {
	ctx := context.Background()
	s, d := newService(t, &memKV{m: map[string][]byte{}}, &fakeScenes{scenes: []*scene.Scene{desk()}})
	ack, err := s.PlaySound(ctx, showsvc.PlayIn{PadID: "pad_rain"})
	if err != nil || ack.PlayID == "" || ack.Outputs != 1 || ack.Stopped {
		t.Fatalf("first press %+v %v", ack, err)
	}
	if l := s.Get(ctx).Audio.Loops; len(l) != 1 || l[0] != "pad_rain" {
		t.Fatalf("loops %v", l)
	}
	var p showsvc.SoundPlay
	_ = json.Unmarshal(d.sent[0].m.D, &p)
	if d.sent[0].m.T != "sound.play" || d.sent[0].to.Role != "output" || d.sent[0].to.Cap != "audio" || !p.Loop || p.Volume != 0.6 {
		t.Fatalf("sent %+v %s", d.sent[0], d.sent[0].m.D)
	}
	// a one-shot pad never enters loops
	if _, err := s.PlaySound(ctx, showsvc.PlayIn{PadID: "pad_bell", Volume: ptr(0.5)}); err != nil {
		t.Fatal(err)
	}
	if l := s.Get(ctx).Audio.Loops; len(l) != 1 {
		t.Fatalf("loops %v", l)
	}
	ack, err = s.PlaySound(ctx, showsvc.PlayIn{PadID: "pad_rain"})
	if err != nil || !ack.Stopped || ack.PlayID != "" {
		t.Fatalf("second press %+v %v", ack, err)
	}
	if last := d.sent[len(d.sent)-1]; last.m.T != "sound.stop" || string(last.m.D) != `{"padId":"pad_rain"}` {
		t.Fatalf("stop %s %s", last.m.T, last.m.D)
	}
	if l := s.Get(ctx).Audio.Loops; len(l) != 0 {
		t.Fatalf("loops after the second press %v", l)
	}
	// no audio client: nothing starts, nothing loops
	d.clients = 0
	if _, err := s.PlaySound(ctx, showsvc.PlayIn{PadID: "pad_rain"}); app_errors.As(err).Code != "no_audio" {
		t.Fatalf("no audio %v", err)
	}
	if l := s.Get(ctx).Audio.Loops; len(l) != 0 {
		t.Fatalf("loops without audio %v", l)
	}
	// output phone sends to remotes
	d.clients = 1
	if _, err := s.Do(ctx, "audio", json.RawMessage(`{"output":"phone"}`), "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PlaySound(ctx, showsvc.PlayIn{PadID: "pad_rain"}); err != nil {
		t.Fatal(err)
	}
	if last := d.sent[len(d.sent)-1]; last.to.Role != "remote" {
		t.Fatalf("phone output goes to role %s", last.to.Role)
	}
	// show.stop clears and stops the loops
	if _, err := s.Do(ctx, "stop", nil, "test"); err != nil {
		t.Fatal(err)
	}
	if l := s.Get(ctx).Audio.Loops; len(l) != 0 {
		t.Fatalf("loops after stop %v", l)
	}
}

func ptr(f float64) *float64 { return &f }
