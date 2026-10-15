package scene

import (
	"fmt"
	"math"
	"sort"

	"projmap/internal/domain/docpatch"
)

// EffectConverge is the built-in clip effect that closes a backdrop mode's light onto an object's silhouette
// (protocol §20).
const EffectConverge = "converge"

// Converge params and their defaults (catalog effect "converge").
var (
	ConvergeFroms = []string{"current", "circle", "frame"}
	ConvergeEases = []string{"inOut", "in", "out", "linear"}
)

// DefaultConvergeSeconds is the length of the clip show.converge inserts.
const DefaultConvergeSeconds = 2.0

// holdByDefault are the effects whose clips keep their end state after `end` when `hold` is absent: the converge and
// the layer clips (reveal, sweep, motion), which always held (protocol §12, §15).
var holdByDefault = map[string]bool{EffectConverge: true, "reveal": true, "sweep": true, "motion": true}

// Holds tells whether the clip keeps its end state after its end: its own `hold`, else the effect's default.
func (c Clip) Holds() bool {
	if c.Hold != nil {
		return *c.Hold
	}
	return holdByDefault[c.Effect]
}

// ClipState is a clip in effect at a time: playing (start <= t < end) or held (after its end).
type ClipState struct {
	ClipID   string  `json:"clipId"`
	TrackID  string  `json:"trackId"`
	Effect   string  `json:"effect"`
	Progress float64 `json:"progress"`
	Held     bool    `json:"held"`
}

// StateAt is every clip in effect at t, in track order then start (protocol §20): the clips that play at t and the
// held clips whose end has passed, until the next clip with the same effect on the same track starts. It depends on
// the document and t only, so a seek, back or GO lands on the same state as playing there.
func (tl *Timeline) StateAt(t float64) []ClipState {
	order := map[string]int{}
	for i, tr := range tl.Tracks {
		order[tr.ID] = i
	}
	clips := append([]Clip(nil), tl.Clips...)
	sort.SliceStable(clips, func(i, j int) bool {
		a, b := clips[i], clips[j]
		if order[a.TrackID] != order[b.TrackID] {
			return order[a.TrackID] < order[b.TrackID]
		}
		return a.Start < b.Start
	})
	out := []ClipState{}
	for i, c := range clips {
		if t < c.Start {
			continue
		}
		if t < c.End {
			out = append(out, ClipState{ClipID: c.ID, TrackID: c.TrackID, Effect: c.Effect, Progress: progress(c, t)})
			continue
		}
		if !c.Holds() {
			continue
		}
		// a later clip of the same effect on the same track that has started takes over
		over := false
		for _, d := range clips[i+1:] {
			if d.TrackID == c.TrackID && d.Effect == c.Effect && d.Start <= t && d.ID != c.ID {
				over = true
				break
			}
		}
		if !over {
			out = append(out, ClipState{ClipID: c.ID, TrackID: c.TrackID, Effect: c.Effect, Progress: 1, Held: true})
		}
	}
	return out
}

func progress(c Clip, t float64) float64 {
	if c.End <= c.Start {
		return 1
	}
	return math.Max(0, math.Min(1, (t-c.Start)/(c.End-c.Start)))
}

// ConvergeIn is show.converge's args: the clip length (default 2 s) and target object (default the first visible
// object; "all" for every object) of a clip it inserts, and the backdrop mode whose light converges (Source, optional:
// a client that opened its objects view after a backdrop mode passes that mode, since the wall is in objects mode by
// then).
type ConvergeIn struct {
	Duration float64
	ObjectID string
	Source   string
	// From and Ease of an inserted clip (default current, inOut); the intro sets them (§20 "Step 0")
	From, Ease string
}

// ConvergePlan is what show.converge does to a scene: the patch, the clip it uses, the backdrop mode it records as
// the source, and where the transport plays from and holds.
type ConvergePlan struct {
	Ops      []docpatch.Op
	ClipID   string
	Inserted bool
	Source   string
	// End is the converge clip's end; HoldAt the first cue at or after it, where playback holds for GO.
	End    float64
	HoldAt float64
	// Cue is transport.cue while it plays: the cue before the hold cue, in time order.
	Cue int
}

// ErrConverge is a show.converge the scene cannot take (no object to converge onto, an unknown object).
type ErrConverge struct{ Msg string }

func (e ErrConverge) Error() string { return e.Msg }

const atStart = 1e-6

// Converge plans show.converge on sc (protocol §20): it records the backdrop mode on air as the converge source, uses
// the converge clip at t = 0 or inserts one (shifting nothing else), makes sure a cue starts at 0 and one waits at or
// after the clip's end, and puts the scene in objects mode. newID makes ids ("trk", "clp", "cue").
func Converge(sc *Scene, in ConvergeIn, newID func(prefix string) string) (ConvergePlan, error) {
	tl := &sc.Timeline
	var p ConvergePlan
	ci := -1
	for i, c := range tl.Clips {
		if c.Effect == EffectConverge && c.Start <= atStart && (ci < 0 || trackIndex(tl, c.TrackID) < trackIndex(tl, tl.Clips[ci].TrackID)) {
			ci = i
		}
	}
	// the source: the one asked for, else the backdrop mode on air now; already in objects mode, the clip keeps its
	// own (else the underlay's)
	if in.Source != "" && !IsBackdropMode(in.Source) {
		return p, ErrConverge{fmt.Sprintf("converge source %q is not one of static, live, color, scenery.", in.Source)}
	}
	p.Source = sc.Mode
	if in.Source != "" {
		p.Source = in.Source
	}
	if !IsBackdropMode(p.Source) {
		p.Source = ""
		if ci >= 0 {
			if s, ok := tl.Clips[ci].Params["source"].(string); ok && IsBackdropMode(s) {
				p.Source = s
			}
		}
		if p.Source == "" {
			p.Source = sc.Underlay.From
		}
		if !IsBackdropMode(p.Source) {
			p.Source = ModeStatic
		}
	}
	if ci >= 0 {
		c := tl.Clips[ci]
		p.ClipID, p.End = c.ID, c.End
		if s, _ := c.Params["source"].(string); s != p.Source {
			if c.Params == nil {
				p.Ops = append(p.Ops, docpatch.Replace(fmt.Sprintf("/timeline/clips/%d/params", ci), map[string]any{"source": p.Source}))
			} else {
				p.Ops = append(p.Ops, docpatch.Add(fmt.Sprintf("/timeline/clips/%d/params/source", ci), p.Source))
			}
		}
	} else {
		var target Target
		name := "all"
		switch {
		case in.ObjectID == "all":
			target = Target{Kind: "all"}
		case in.ObjectID != "":
			oi := sc.FindObject(in.ObjectID)
			if oi < 0 {
				return p, ErrConverge{fmt.Sprintf("Object %s does not exist in this scene.", in.ObjectID)}
			}
			id := sc.Objects[oi].ID
			target, name = Target{Kind: "object", ID: &id}, sc.Objects[oi].Name
		default:
			for _, o := range sc.Objects {
				if o.Visible {
					id := o.ID
					target, name = Target{Kind: "object", ID: &id}, o.Name
					break
				}
			}
			if target.Kind == "" {
				return p, ErrConverge{"The scene has no mapped object to converge onto. Map one in the map space first."}
			}
		}
		dur := in.Duration
		if dur <= 0 {
			dur = DefaultConvergeSeconds
		}
		dur = math.Min(math.Max(dur, 0.1), math.Max(0.1, tl.Duration))
		p.End = math.Round(dur*1000) / 1000
		// a track of that target with nothing in 0..end, else a new one
		trackID := ""
		for _, tr := range tl.Tracks {
			if !sameTarget(tr.Target, target) {
				continue
			}
			free := true
			for _, c := range tl.Clips {
				if c.TrackID == tr.ID && c.Start < p.End && c.End > 0 {
					free = false
				}
			}
			if free {
				trackID = tr.ID
				break
			}
		}
		if trackID == "" {
			trackID = newID("trk")
			p.Ops = append(p.Ops, docpatch.Add("/timeline/tracks/-", Track{ID: trackID, Name: name + " · converge", Target: target}))
		}
		p.ClipID, p.Inserted = newID("clp"), true
		from, ease := in.From, in.Ease
		if from == "" {
			from = "current"
		}
		if ease == "" {
			ease = "inOut"
		}
		clip := Clip{ID: p.ClipID, TrackID: trackID, Effect: EffectConverge, Start: 0, End: p.End,
			Params: map[string]any{"from": from, "source": p.Source, "ease": ease, "edge": 6.0, "outline": false}}
		p.Ops = append(p.Ops, docpatch.Add("/timeline/clips/-", clip))
	}
	// cues: one starts at 0, one waits at or after the converge's end (GO plays on from it)
	cues := append([]Cue(nil), tl.Cues...)
	hasStart, hold := false, false
	for _, c := range cues {
		hasStart = hasStart || c.At <= atStart
		hold = hold || c.At >= p.End-atStart
	}
	if !hasStart {
		c := Cue{ID: newID("cue"), At: 0, Label: "converge"}
		cues = append(cues, c)
		p.Ops = append(p.Ops, docpatch.Add("/timeline/cues/-", c))
	}
	if !hold {
		c := Cue{ID: newID("cue"), At: p.End, Label: "after converge"}
		cues = append(cues, c)
		p.Ops = append(p.Ops, docpatch.Add("/timeline/cues/-", c))
	}
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].At < cues[j].At })
	for i, c := range cues {
		if c.At >= p.End-atStart {
			p.HoldAt, p.Cue = c.At, max(0, i-1)
			break
		}
	}
	if sc.Mode != ModeObjects {
		p.Ops = append(p.Ops, docpatch.Replace("/mode", ModeObjects))
	}
	return p, nil
}

func trackIndex(tl *Timeline, id string) int {
	for i, tr := range tl.Tracks {
		if tr.ID == id {
			return i
		}
	}
	return len(tl.Tracks)
}

func sameTarget(a, b Target) bool {
	if a.Kind != b.Kind {
		return false
	}
	if a.ID == nil || b.ID == nil {
		return a.ID == nil && b.ID == nil
	}
	return *a.ID == *b.ID
}
