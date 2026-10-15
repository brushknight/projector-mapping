// Package show is the live state: the active scene, on air or blackout, and the transport on the server clock. The
// transport rules (GO, back, hold at cues) are pure functions of the cue list and the current time.
package show

import (
	"fmt"
	"sort"
)

// Transport states.
const (
	Stopped = "stopped"
	Playing = "playing"
	Paused  = "paused"
)

// Transport is the playhead.
type Transport struct {
	State     string  `json:"state"`
	StartedAt int64   `json:"startedAt"`
	Offset    float64 `json:"offset"`
	Cue       int     `json:"cue"`
	// Step is "intro" while the scene's opening look holds (step 0, protocol §20 "Step 0"); "timeline" (or absent)
	// otherwise.
	Step string `json:"step,omitempty"`
}

// Transport steps.
const (
	StepIntro    = "intro"
	StepTimeline = "timeline"
)

// InIntro tells whether the opening look holds (step 0).
func (t Transport) InIntro() bool { return t.Step == StepIntro }

// Preview is a draft the projector plays instead of the live scene (agent preview, "projector_show draft_frame").
type Preview struct {
	DraftID string  `json:"draftId"`
	Until   float64 `json:"until,omitempty"`
}

// Show is the one live state per server.
type Show struct {
	ActiveSetupID string    `json:"activeSetupId"`
	ActiveSceneID string    `json:"activeSceneId"`
	OnAir         bool      `json:"onAir"`
	Transport     Transport `json:"transport"`
	Version       int64     `json:"version"`
	Preview       *Preview  `json:"preview,omitempty"`
	// Solo, when set, makes the output draw only these surfaces until Until (protocol §12).
	Solo *Solo `json:"solo,omitempty"`
	// Audio is the sound output (protocol §14); the server always sets it.
	Audio *Audio `json:"audio,omitempty"`
}

// Audio outputs: which client plays every sound.
const (
	OutputProjector = "projector"
	OutputEditor    = "editor"
	OutputPhone     = "phone"
)

// Audio is where sounds play, the master volume, mute, and the looping pads playing now.
type Audio struct {
	Output string   `json:"output"`
	Volume float64  `json:"volume"`
	Muted  bool     `json:"muted"`
	Loops  []string `json:"loops"`
}

// DefaultAudio plays on the projector at full volume.
func DefaultAudio() *Audio { return &Audio{Output: OutputProjector, Volume: 1, Loops: []string{}} }

// OutputRole is the client role that plays sound for an output (projector → output, editor → editor, phone → remote).
func OutputRole(output string) string {
	switch output {
	case OutputEditor:
		return "editor"
	case OutputPhone:
		return "remote"
	}
	return "output"
}

// Normalize fills the audio defaults; it returns a copy with its own loops slice.
func (a *Audio) Normalize() *Audio {
	if a == nil {
		return DefaultAudio()
	}
	n := *a
	switch n.Output {
	case OutputProjector, OutputEditor, OutputPhone:
	default:
		n.Output = OutputProjector
	}
	if n.Volume < 0 || n.Volume > 1 {
		n.Volume = 1
	}
	n.Loops = append([]string{}, a.Loops...)
	return &n
}

// WithoutLoop returns loops without id.
func WithoutLoop(loops []string, id string) []string {
	out := make([]string, 0, len(loops))
	for _, l := range loops {
		if l != id {
			out = append(out, l)
		}
	}
	return out
}

// HasLoop tells whether id is in loops.
func HasLoop(loops []string, id string) bool {
	for _, l := range loops {
		if l == id {
			return true
		}
	}
	return false
}

// Solo fills.
const (
	SoloContent = "content"
	SoloWhite   = "white"
	SoloGrid    = "grid"
)

// Solo limits the output to some surfaces for a while (server Unix ns).
type Solo struct {
	SurfaceIDs []string `json:"surfaceIds"`
	Fill       string   `json:"fill"`
	Until      int64    `json:"until"`
}

// Solo durations in seconds.
const (
	SoloDefaultSeconds = 60
	SoloMaxSeconds     = 600
)

// Cue is what the transport needs from a scene cue.
type Cue struct {
	At         float64
	AutoFollow bool
}

// SortCues orders cues by time.
func SortCues(c []Cue) []Cue {
	out := append([]Cue(nil), c...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].At < out[j].At })
	return out
}

// Playhead is the transport time in seconds at server time now (unix ns).
func (t Transport) Playhead(now int64) float64 {
	if t.State != Playing {
		return t.Offset
	}
	return t.Offset + float64(now-t.StartedAt)/1e9
}

// ErrNoCue is returned when GO has nowhere to go.
type ErrNoCue struct{ Msg string }

func (e ErrNoCue) Error() string { return e.Msg }

// Play starts or resumes.
func Play(t Transport, now int64) Transport {
	if t.State == Playing {
		return t
	}
	t.State, t.StartedAt = Playing, now
	return t
}

// Pause freezes the playhead.
func Pause(t Transport, now int64) Transport {
	if t.State != Playing {
		return t
	}
	t.Offset, t.State, t.StartedAt = t.Playhead(now), Paused, 0
	return t
}

// Stop rewinds to the start.
func Stop() Transport { return Transport{State: Stopped} }

// Seek moves the playhead to at; the cue becomes the last cue at or before it.
func Seek(t Transport, at float64, cues []Cue, duration float64, now int64) Transport {
	if at < 0 {
		at = 0
	}
	if duration > 0 && at > duration {
		at = duration
	}
	t.Offset = at
	t.Cue = CueAt(cues, at)
	if t.State == Playing {
		t.StartedAt = now
	} else if t.State == Stopped {
		t.State = Paused
	}
	return t
}

// CueAt is the index of the last cue at or before at (0 when none).
func CueAt(cues []Cue, at float64) int {
	cues = SortCues(cues)
	idx := 0
	for i, c := range cues {
		if c.At <= at+1e-9 {
			idx = i
		}
	}
	return idx
}

// Go jumps to the next cue's time and plays. From stopped it starts the current cue (cue 0 after a stop).
func Go(t Transport, cues []Cue, now int64) (Transport, error) {
	cues = SortCues(cues)
	if len(cues) == 0 {
		if t.State == Playing {
			return t, ErrNoCue{"The scene has no cues."}
		}
		return Play(t, now), nil
	}
	next := t.Cue + 1
	if t.State == Stopped {
		next = t.Cue
		if next >= len(cues) {
			next = 0
		}
	}
	if next >= len(cues) {
		return t, ErrNoCue{"There is no next cue."}
	}
	return Transport{State: Playing, StartedAt: now, Offset: cues[next].At, Cue: next}, nil
}

// Back jumps to the previous cue (or restarts the current one when more than a second into it).
func Back(t Transport, cues []Cue, now int64) Transport {
	cues = SortCues(cues)
	if len(cues) == 0 {
		return Seek(t, 0, nil, 0, now)
	}
	cur := t.Cue
	if cur >= len(cues) {
		cur = len(cues) - 1
	}
	target := cur
	if t.Playhead(now) <= cues[cur].At+1 && cur > 0 {
		target = cur - 1
	}
	t.Offset, t.Cue = cues[target].At, target
	if t.State == Playing {
		t.StartedAt = now
	}
	return t
}

// NextStop is when (server ns) a playing transport must change by itself: holding at the next cue that does not
// auto-follow, advancing the cue index at one that does, or pausing at the end. ok is false when nothing is due.
func NextStop(t Transport, cues []Cue, duration float64) (at float64, ok bool) {
	if t.State != Playing {
		return 0, false
	}
	cues = SortCues(cues)
	if t.Cue+1 < len(cues) {
		return cues[t.Cue+1].At, true
	}
	if duration > 0 {
		return duration, true
	}
	return 0, false
}

// Advance applies what is due at time now: hold at a cue, follow it, or pause at the end. changed tells whether t
// changed.
func Advance(t Transport, cues []Cue, duration float64, now int64) (Transport, bool) {
	changed := false
	cues = SortCues(cues)
	for i := 0; i < len(cues)+1 && t.State == Playing; i++ {
		ph := t.Playhead(now)
		if t.Cue+1 < len(cues) && ph+1e-6 >= cues[t.Cue+1].At {
			nx := cues[t.Cue+1]
			if nx.AutoFollow {
				t.Cue++
				changed = true
				continue
			}
			t = Transport{State: Paused, Offset: nx.At, Cue: t.Cue}
			return t, true
		}
		if duration > 0 && ph+1e-6 >= duration {
			return Transport{State: Paused, Offset: duration, Cue: t.Cue}, true
		}
		break
	}
	return t, changed
}

// Validate checks a transport's values.
func (t Transport) Validate() error {
	switch t.State {
	case Stopped, Playing, Paused:
	default:
		return fmt.Errorf("transport state %q is unknown", t.State)
	}
	return nil
}
