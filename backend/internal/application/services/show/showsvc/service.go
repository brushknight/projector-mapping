// Package showsvc implements the show section: the transport rules of domain/show on the server clock, a timer that
// holds at cues, and the show channel.
package showsvc

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"sync"
	"time"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	showrepo "projmap/internal/application/ports/repository/show"
	assetssvc "projmap/internal/application/services/assets"
	scenessvc "projmap/internal/application/services/scenes"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/domain/assets"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/show"
)

// Channel is the show channel.
const Channel = "show"

const kvKey = "show"

// Service implements ShowService.
type Service struct {
	kv     showrepo.KV
	scenes scenessvc.SceneService
	pub    realtime.Publisher
	log    *slog.Logger
	now    func() int64

	mu    sync.Mutex
	state show.Show
	timer *time.Timer
	// soloTimer clears show.solo at its until; separate from the transport timer.
	soloTimer *time.Timer

	// audio clients and the sound library (UseAudio); nil sends no sound
	direct realtime.Direct
	sounds SoundLookup
	// loopPlays maps the play id of each looping pad that plays now to its pad id
	loopPlays map[string]string
}

// SoundLookup finds library sounds (the asset service).
type SoundLookup interface {
	Get(ctx context.Context, sha string) (*assets.Asset, error)
}

var _ SoundLookup = (assetssvc.AssetService)(nil)

var _ showsvc.ShowService = (*Service)(nil)

// New loads the saved show (or starts from def).
func New(ctx context.Context, kv showrepo.KV, scenes scenessvc.SceneService, pub realtime.Publisher, log *slog.Logger, def show.Show) (*Service, error) {
	s := &Service{kv: kv, scenes: scenes, pub: pub, log: log, now: func() int64 { return time.Now().UnixNano() }, loopPlays: map[string]string{}}
	b, err := kv.Get(ctx, kvKey)
	if err != nil {
		return nil, err
	}
	s.state = def
	if b != nil {
		if err := json.Unmarshal(b, &s.state); err != nil {
			s.state = def
		}
	}
	// the active scene survives restarts: keep the stored one when it exists, else put the first scene on the wall
	store := b == nil
	if ok, err := s.ensureActive(ctx); err != nil {
		return nil, err
	} else if ok {
		store = true
	}
	// a restart clears the looping pads (nothing plays them any more)
	s.state.Audio = s.state.Audio.Normalize()
	s.state.Audio.Loops = []string{}
	// a restart never resumes playback on its own
	if s.state.Transport.State == show.Playing {
		s.state.Transport = show.Pause(s.state.Transport, s.now())
	}
	s.state.Preview = nil
	if s.state.Transport.State == "" {
		s.state.Transport.State = show.Stopped
	}
	// a solo that ran out while the server was down is gone; a running one keeps its deadline
	if s.state.Solo != nil && s.state.Solo.Until <= s.now() {
		s.state.Solo = nil
	}
	if store {
		if b, err := json.Marshal(s.state); err == nil {
			if err := kv.Put(ctx, kvKey, b); err != nil {
				return nil, err
			}
		}
	}
	s.mu.Lock()
	s.armSolo()
	s.mu.Unlock()
	return s, nil
}

// ensureActive makes sure a server with scenes has an active one: the stored scene when it exists, else the first of
// the list (creation order). It reports whether it changed the state.
func (s *Service) ensureActive(ctx context.Context) (bool, error) {
	list, err := s.scenes.List(ctx)
	if err != nil {
		return false, err
	}
	for _, sc := range list {
		if sc.ID == s.state.ActiveSceneID {
			if s.state.ActiveSetupID == "" {
				s.state.ActiveSetupID = sc.SetupID
				return true, nil
			}
			return false, nil
		}
	}
	if len(list) == 0 {
		if s.state.ActiveSceneID == "" {
			return false, nil
		}
		s.state.ActiveSceneID = ""
		return true, nil
	}
	if s.state.ActiveSceneID != "" {
		s.log.Info("the stored active scene is gone; activating the first scene", "was", s.state.ActiveSceneID, "now", list[0].ID)
	}
	s.state.ActiveSceneID, s.state.ActiveSetupID = list[0].ID, list[0].SetupID
	s.state.Transport, s.state.Preview = show.Stop(), nil
	return true, nil
}

// UseAudio connects the audio clients and the sound library.
func (s *Service) UseAudio(direct realtime.Direct, sounds SoundLookup) {
	s.direct, s.sounds = direct, sounds
}

// SetClock replaces the clock (tests).
func (s *Service) SetClock(now func() int64) { s.now = now }

func (s *Service) Now() int64 { return s.now() }

func (s *Service) Get(context.Context) show.Show {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func cuesOf(sc *scene.Scene) []show.Cue {
	out := make([]show.Cue, 0, len(sc.Timeline.Cues))
	for _, c := range sc.Timeline.Cues {
		out = append(out, show.Cue{At: c.At, AutoFollow: c.AutoFollow})
	}
	return out
}

// sortedCues are the scene's cues in transport order (show.SortCues: stable by time), so transport.cue indexes them.
func sortedCues(sc *scene.Scene) []scene.Cue {
	out := append([]scene.Cue(nil), sc.Timeline.Cues...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].At < out[j].At })
	return out
}

// sceneFor returns the scene the transport runs on: the preview draft's scene or the active one.
func (s *Service) activeScene(ctx context.Context) (*scene.Scene, error) {
	if s.state.ActiveSceneID == "" {
		return nil, app_errors.NoScene("No active scene.")
	}
	return s.scenes.Scene(ctx, s.state.ActiveSceneID)
}

func (s *Service) Do(ctx context.Context, action string, args json.RawMessage, by string) (show.Show, error) {
	var a struct {
		T          *float64  `json:"t"`
		On         *bool     `json:"on"`
		SceneID    string    `json:"sceneId"`
		DraftID    string    `json:"draftId"`
		Play       bool      `json:"play"`
		SurfaceIDs *[]string `json:"surfaceIds"`
		Fill       string    `json:"fill"`
		Seconds    *float64  `json:"seconds"`
		Output     *string   `json:"output"`
		Volume     *float64  `json:"volume"`
		Muted      *bool     `json:"muted"`
	}
	if len(args) > 0 && string(args) != "null" {
		if err := json.Unmarshal(args, &a); err != nil {
			return show.Show{}, app_errors.BadRequest("The args must be an object: %v", err)
		}
	}
	if action == "preview" {
		// Preview takes the lock itself
		from := 0.0
		if a.T != nil {
			from = *a.T
		}
		return s.Preview(ctx, a.DraftID, from, 0, a.Play)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	st := s.state
	switch action {
	case "blackout":
		if a.On == nil {
			return st, app_errors.BadRequest("blackout needs {on: true|false}.")
		}
		st.OnAir = !*a.On
	case "activate":
		if a.SceneID == "" {
			return st, app_errors.BadRequest("activate needs {sceneId}.")
		}
		sc, err := s.scenes.Scene(ctx, a.SceneID)
		if err != nil {
			return st, err
		}
		st.ActiveSceneID, st.ActiveSetupID = sc.ID, sc.SetupID
		st.Transport, st.Preview = show.Stop(), nil
		st.Audio = s.clearLoops(st.Audio)
	case "play", "pause", "stop", "go", "back", "seek":
		sc, err := s.activeScene(ctx)
		if err != nil {
			return st, err
		}
		cues := cuesOf(sc)
		switch action {
		case "play":
			st.Transport = show.Play(st.Transport, now)
		case "pause":
			st.Transport = show.Pause(st.Transport, now)
		case "stop":
			st.Transport, st.Preview = show.Stop(), nil
			st.Audio = s.clearLoops(st.Audio)
		case "go":
			t, err := show.Go(st.Transport, cues, now)
			if err != nil {
				return st, app_errors.NoCue("%s", err.Error())
			}
			st.Transport = t
			if len(cues) > 0 && st.Preview == nil {
				defer s.cueSound(ctx, sc, t.Cue)
			}
		case "back":
			st.Transport = show.Back(st.Transport, cues, now)
		case "seek":
			if a.T == nil {
				return st, app_errors.BadRequest("seek needs {t} in seconds.")
			}
			st.Transport = show.Seek(st.Transport, *a.T, cues, sc.Timeline.Duration, now)
		}
	case "solo":
		solo, err := soloOf(a.SurfaceIDs, a.Fill, a.Seconds, now)
		if err != nil {
			return st, err
		}
		st.Solo = solo
	case "audio":
		au := st.Audio.Normalize()
		if a.Output != nil {
			switch *a.Output {
			case show.OutputProjector, show.OutputEditor, show.OutputPhone:
				au.Output = *a.Output
			default:
				return st, app_errors.BadRequest("audio output %q is not one of projector, editor, phone.", *a.Output)
			}
		}
		if a.Volume != nil {
			if *a.Volume < 0 || *a.Volume > 1 {
				return st, app_errors.BadRequest("audio volume must be 0..1.")
			}
			au.Volume = *a.Volume
		}
		if a.Muted != nil {
			au.Muted = *a.Muted
		}
		st.Audio = au
	default:
		return st, app_errors.NotFound("Show action %q does not exist.", action)
	}
	s.commit(ctx, st)
	return s.state, nil
}

func (s *Service) Preview(ctx context.Context, draftID string, from, to float64, play bool) (show.Show, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.state
	if draftID == "" {
		st.Preview = nil
		st.Transport = show.Stop()
		s.commit(ctx, st)
		return s.state, nil
	}
	sc, err := s.activeScene(ctx)
	if err != nil {
		return st, err
	}
	st.Preview = &show.Preview{DraftID: draftID, Until: to}
	now := s.now()
	st.Transport = show.Seek(show.Transport{State: show.Paused}, from, cuesOf(sc), 0, now)
	if play {
		st.Transport = show.Play(st.Transport, now)
	}
	s.commit(ctx, st)
	return s.state, nil
}

// commit stores and publishes the new state and re-arms the cue timer; callers hold mu.
func (s *Service) commit(ctx context.Context, st show.Show) {
	st.Version = s.state.Version + 1
	st.Audio = st.Audio.Normalize()
	s.state = st
	b, _ := json.Marshal(st)
	if err := s.kv.Put(ctx, kvKey, b); err != nil {
		s.log.Warn("save show", "err", err)
	}
	s.pub.Publish(Channel, realtime.Message{T: "snapshot", Ch: Channel, V: realtime.Ver(st.Version), D: b})
	s.arm(ctx)
	s.armSolo()
}

// soloOf builds show.solo from the solo action's args: an empty surfaceIds turns it off, fill defaults to content,
// seconds (1..600, default 60) sets until.
func soloOf(ids *[]string, fill string, seconds *float64, now int64) (*show.Solo, error) {
	if ids == nil {
		return nil, app_errors.BadRequest("solo needs {surfaceIds} ([] turns solo off).")
	}
	if len(*ids) == 0 {
		return nil, nil
	}
	seen := map[string]bool{}
	list := make([]string, 0, len(*ids))
	for _, id := range *ids {
		if id == "" {
			return nil, app_errors.BadRequest("solo surfaceIds cannot hold an empty id.")
		}
		if !seen[id] {
			seen[id] = true
			list = append(list, id)
		}
	}
	switch fill {
	case "":
		fill = show.SoloContent
	case show.SoloContent, show.SoloWhite, show.SoloGrid:
	default:
		return nil, app_errors.BadRequest("solo fill %q is not one of content, white, grid.", fill)
	}
	secs := float64(show.SoloDefaultSeconds)
	if seconds != nil {
		secs = *seconds
		if secs < 1 || secs > show.SoloMaxSeconds {
			return nil, app_errors.BadRequest("solo seconds must be 1..%d.", show.SoloMaxSeconds)
		}
	}
	return &show.Solo{SurfaceIDs: list, Fill: fill, Until: now + int64(secs*1e9)}, nil
}

// armSolo (re)schedules the timer that clears show.solo at its until; callers hold mu.
func (s *Service) armSolo() {
	if s.soloTimer != nil {
		s.soloTimer.Stop()
		s.soloTimer = nil
	}
	if s.state.Solo == nil {
		return
	}
	until := s.state.Solo.Until
	wait := time.Duration(until - s.now())
	if wait < 0 {
		wait = 0
	}
	s.soloTimer = time.AfterFunc(wait, func() { s.expireSolo(until) })
}

// expireSolo clears the solo when it is still the one that ends at until (a renewed solo has a later until).
func (s *Service) expireSolo(until int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Solo == nil || s.state.Solo.Until != until {
		return
	}
	if s.now() < until {
		s.armSolo()
		return
	}
	st := s.state
	st.Solo = nil
	s.commit(context.Background(), st)
}

// arm schedules the next automatic change (hold at a cue, follow it, the end of the timeline or of a preview).
func (s *Service) arm(ctx context.Context) {
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if s.state.Transport.State != show.Playing || s.state.ActiveSceneID == "" {
		return
	}
	sc, err := s.scenes.Scene(ctx, s.state.ActiveSceneID)
	if err != nil {
		return
	}
	at, ok := show.NextStop(s.state.Transport, cuesOf(sc), sc.Timeline.Duration)
	if p := s.state.Preview; p != nil && p.Until > 0 && (!ok || p.Until < at) {
		at, ok = p.Until, true
	}
	if !ok {
		return
	}
	wait := time.Duration((at - s.state.Transport.Playhead(s.now())) * 1e9)
	if wait < 0 {
		wait = 0
	}
	ver := s.state.Version
	s.timer = time.AfterFunc(wait, func() { s.tick(ver) })
}

func (s *Service) tick(ver int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Version != ver {
		return
	}
	ctx := context.Background()
	sc, err := s.scenes.Scene(ctx, s.state.ActiveSceneID)
	if err != nil {
		return
	}
	now := s.now()
	st := s.state
	if p := st.Preview; p != nil && p.Until > 0 && st.Transport.Playhead(now)+1e-6 >= p.Until {
		st.Transport = show.Transport{State: show.Paused, Offset: p.Until, Cue: st.Transport.Cue}
		s.commit(ctx, st)
		return
	}
	from := st.Transport.Cue
	t, changed := show.Advance(st.Transport, cuesOf(sc), sc.Timeline.Duration, now)
	if changed {
		st.Transport = t
		s.commit(ctx, st)
		// playback passed auto-follow cues: each one starts on the wall
		if st.Preview == nil {
			for i := from + 1; i <= t.Cue; i++ {
				s.cueSound(ctx, sc, i)
			}
		}
		return
	}
	s.arm(ctx)
}
