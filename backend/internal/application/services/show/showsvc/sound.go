package showsvc

import (
	"context"
	"math"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	"projmap/internal/application/services"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/domain/assets"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/show"
)

// Cap is what a client that plays sound announces in hello.
const Cap = "audio"

// NoAudioMessage is the no_audio error's message.
const NoAudioMessage = "Nothing plays sound right now. Open /out on the projector computer and click it once."

// audioTarget is the audio clients for the current output; callers hold mu.
func (s *Service) audioTarget() realtime.Target {
	return realtime.Target{Role: show.OutputRole(s.state.Audio.Normalize().Output), Cap: Cap}
}

// send queues a direct message on the audio clients; callers hold mu.
func (s *Service) send(t string, d any) int {
	if s.direct == nil {
		return 0
	}
	return s.direct.SendDirect(s.audioTarget(), realtime.Message{T: t, D: realtime.Data(d)})
}

func (s *Service) PlaySound(ctx context.Context, in showsvc.PlayIn) (showsvc.SoundAck, error) {
	vol := 1.0
	if in.Volume != nil {
		vol = *in.Volume
		if math.IsNaN(vol) || vol < 0 || vol > 1 {
			return showsvc.SoundAck{}, app_errors.BadRequest("volume must be 0..1.")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	msg := showsvc.SoundPlay{PlayID: services.NewID("ply")}
	switch {
	case in.PadID != "":
		sceneID := in.SceneID
		if sceneID == "" {
			sceneID = s.state.ActiveSceneID
		}
		if sceneID == "" {
			return showsvc.SoundAck{}, app_errors.NoScene("No active scene.")
		}
		sc, err := s.scenes.Scene(ctx, sceneID)
		if err != nil {
			return showsvc.SoundAck{}, err
		}
		pad := sc.Pad(in.PadID)
		if pad == nil {
			return showsvc.SoundAck{}, app_errors.NotFound("Pad %s does not exist in scene %s.", in.PadID, sc.ID)
		}
		if pad.Sound == "" {
			return showsvc.SoundAck{}, app_errors.BadRequest("Pad %s has no sound.", pad.Name)
		}
		au := s.state.Audio.Normalize()
		if pad.Loop && show.HasLoop(au.Loops, pad.ID) {
			// a looping pad that plays now: pressing it again stops it
			n := s.send("sound.stop", showsvc.SoundStop{PadID: pad.ID})
			s.forgetLoop(pad.ID)
			st := s.state
			au.Loops = show.WithoutLoop(au.Loops, pad.ID)
			st.Audio = au
			s.commit(ctx, st)
			return showsvc.SoundAck{Outputs: n, Stopped: true}, nil
		}
		msg.Sound, msg.PadID, msg.Name, msg.Volume, msg.Loop = pad.Sound, pad.ID, pad.Name, round3(pad.Volume*vol), pad.Loop
	case in.SoundID != "":
		a, err := s.sound(ctx, in.SoundID)
		if err != nil {
			return showsvc.SoundAck{}, err
		}
		msg.Sound, msg.Name, msg.Volume = a.SHA, a.Name, round3(vol)
	default:
		return showsvc.SoundAck{}, app_errors.BadRequest("sound.play needs padId or soundId.")
	}
	n := s.send("sound.play", msg)
	if n == 0 {
		return showsvc.SoundAck{}, app_errors.NoAudio(NoAudioMessage)
	}
	if msg.Loop {
		s.loopPlays[msg.PlayID] = msg.PadID
		st := s.state
		au := st.Audio.Normalize()
		au.Loops = append(au.Loops, msg.PadID)
		st.Audio = au
		s.commit(ctx, st)
	}
	return showsvc.SoundAck{PlayID: msg.PlayID, Outputs: n}, nil
}

// sound is a library sound by sha.
func (s *Service) sound(ctx context.Context, sha string) (*assets.Asset, error) {
	if s.sounds == nil {
		return nil, app_errors.NotFound("Sound %s does not exist.", sha)
	}
	a, err := s.sounds.Get(ctx, sha)
	if err != nil || a.Kind != assets.KindSound {
		return nil, app_errors.NotFound("Sound %s does not exist.", sha)
	}
	return a, nil
}

func (s *Service) StopSound(ctx context.Context, in showsvc.StopIn) (showsvc.SoundAck, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := s.send("sound.stop", showsvc.SoundStop{PlayID: in.PlayID, PadID: in.PadID})
	au := s.state.Audio.Normalize()
	loops := au.Loops
	switch {
	case in.PlayID == "" && in.PadID == "":
		loops = []string{}
		s.loopPlays = map[string]string{}
	case in.PadID != "":
		loops = show.WithoutLoop(loops, in.PadID)
		s.forgetLoop(in.PadID)
	default:
		if pad, ok := s.loopPlays[in.PlayID]; ok {
			delete(s.loopPlays, in.PlayID)
			if !s.padPlays(pad) {
				loops = show.WithoutLoop(loops, pad)
			}
		}
	}
	if len(loops) != len(au.Loops) {
		st := s.state
		au.Loops = loops
		st.Audio = au
		s.commit(ctx, st)
	}
	return showsvc.SoundAck{Outputs: n}, nil
}

// forgetLoop drops every play of a looping pad; callers hold mu.
func (s *Service) forgetLoop(pad string) {
	for id, p := range s.loopPlays {
		if p == pad {
			delete(s.loopPlays, id)
		}
	}
}

func (s *Service) padPlays(pad string) bool {
	for _, p := range s.loopPlays {
		if p == pad {
			return true
		}
	}
	return false
}

// clearLoops stops the looping pads (show.stop, activate) and returns the audio without loops; callers hold mu.
func (s *Service) clearLoops(a *show.Audio) *show.Audio {
	au := a.Normalize()
	if len(au.Loops) > 0 {
		for _, pad := range au.Loops {
			s.send("sound.stop", showsvc.SoundStop{PadID: pad})
		}
		au.Loops = []string{}
	}
	s.loopPlays = map[string]string{}
	return au
}

// cueSound plays the sound of the cue at index i (transport order) when it has one; callers hold mu.
func (s *Service) cueSound(ctx context.Context, sc *scene.Scene, i int) {
	cues := sortedCues(sc)
	if i < 0 || i >= len(cues) || cues[i].Sound == nil || cues[i].Sound.Sound == "" {
		return
	}
	c := cues[i]
	name := c.Label
	if s.sounds != nil {
		if a, err := s.sounds.Get(ctx, c.Sound.Sound); err == nil && a.Name != "" {
			name = a.Name
		}
	}
	s.send("sound.play", showsvc.SoundPlay{PlayID: services.NewID("ply"), Sound: c.Sound.Sound, CueID: c.ID, Name: name,
		Volume: round3(c.Sound.Volume)})
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }
