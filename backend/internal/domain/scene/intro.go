package scene

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"

	"projmap/internal/domain/docpatch"
)

// Intro is the scene's opening step, step 0 of a sequence (protocol §20 "Step 0"): the wall shows the opening look
// (a backdrop mode, optionally a preset of it) and holds until GO, which converges onto the object or crossfades (or
// cuts) into the mapping.
type Intro struct {
	On               bool        `json:"on"`
	Source           IntroSource `json:"source"`
	Converge         bool        `json:"converge"`
	ConvergeDuration float64     `json:"convergeDuration"`
	From             string      `json:"from"`
	Ease             string      `json:"ease"`
	Transition       string      `json:"transition"`
	TransitionMs     float64     `json:"transitionMs"`
}

// IntroSource is the opening look: a backdrop mode, and a preset of that mode applied when the sequence starts.
type IntroSource struct {
	Mode     string  `json:"mode"`
	PresetID *string `json:"presetId"`
}

// Intro transitions.
var IntroTransitions = map[string]bool{"fade": true, "cut": true}

// DefaultIntro is on with the static look, converging over 2 s from the current spot.
func DefaultIntro(mode string) Intro {
	if !IsBackdropMode(mode) {
		mode = ModeStatic
	}
	return Intro{On: true, Source: IntroSource{Mode: mode}, Converge: true, ConvergeDuration: DefaultConvergeSeconds,
		From: "current", Ease: "inOut", Transition: "fade", TransitionMs: 600}
}

// UnmarshalJSON fills the defaults for absent fields.
func (in *Intro) UnmarshalJSON(b []byte) error {
	type raw Intro
	d := raw(DefaultIntro(ModeStatic))
	d.On = false
	if err := json.Unmarshal(b, &d); err != nil {
		return err
	}
	*in = Intro(d)
	return nil
}

func (c *checker) intro(in *Intro) {
	if in == nil {
		return
	}
	if !IsBackdropMode(in.Source.Mode) {
		c.fail("intro.source.mode %q is not one of static, live, color, scenery", in.Source.Mode)
	}
	c.rng("intro.convergeDuration", in.ConvergeDuration, 0.1, 60)
	c.rng("intro.transitionMs", in.TransitionMs, 0, 10000)
	if !contains(ConvergeFroms, in.From) {
		c.fail("intro.from %q is not one of current, circle, frame", in.From)
	}
	if !contains(ConvergeEases, in.Ease) {
		c.fail("intro.ease %q is not one of inOut, in, out, linear", in.Ease)
	}
	if !IntroTransitions[in.Transition] {
		c.fail("intro.transition %q is not one of fade, cut", in.Transition)
	}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// SequencePlan is what show.sequence.start does to a scene: the patch, and (with converge) where GO plays from.
type SequencePlan struct {
	Ops   []docpatch.Op
	Intro Intro
}

// StartSequence plans show.sequence.start (protocol §20 "Step 0"): the scene's intro (made from the backdrop mode on
// air, converge on, when it has none or it is off), a cue at 0, the converge clip at 0 set to the intro's source,
// duration, from and ease when the intro converges, and objects mode. Preset ops (applying source.presetId) are the
// caller's.
func StartSequence(sc *Scene, newID func(prefix string) string) (SequencePlan, error) {
	var p SequencePlan
	in := DefaultIntro(sc.Mode)
	if sc.Intro != nil {
		in = *sc.Intro
		if !in.On {
			in.On = true
		}
	} else if !IsBackdropMode(sc.Mode) {
		in.Source.Mode = sc.Underlay.From
		if !IsBackdropMode(in.Source.Mode) {
			in.Source.Mode = ModeStatic
		}
	}
	p.Intro = in
	if sc.Intro == nil || !sc.Intro.On {
		p.Ops = append(p.Ops, docpatch.Add("/intro", in))
	}
	if in.Converge {
		cp, err := Converge(sc, ConvergeIn{Duration: in.ConvergeDuration, Source: in.Source.Mode, From: in.From, Ease: in.Ease}, newID)
		if err != nil {
			return p, err
		}
		p.Ops = append(p.Ops, cp.Ops...)
		// the intro's duration, from and ease on the clip (an inserted clip already has the duration)
		ci := -1
		for i, c := range sc.Timeline.Clips {
			if c.ID == cp.ClipID {
				ci = i
			}
		}
		if ci >= 0 {
			c := sc.Timeline.Clips[ci]
			end := math.Round(math.Min(math.Max(in.ConvergeDuration, 0.1), math.Max(0.1, sc.Timeline.Duration))*1000) / 1000
			if math.Abs(c.End-end) > 1e-6 {
				p.Ops = append(p.Ops, docpatch.Replace(fmt.Sprintf("/timeline/clips/%d/end", ci), end))
				// a cue must wait at or after the new end
				hold := false
				for _, q := range sc.Timeline.Cues {
					hold = hold || q.At >= end-atStart
				}
				if !hold {
					p.Ops = append(p.Ops, docpatch.Add("/timeline/cues/-", Cue{ID: newID("cue"), At: end, Label: "after converge"}))
				}
			}
			if c.Params != nil {
				p.Ops = append(p.Ops, docpatch.Add(fmt.Sprintf("/timeline/clips/%d/params/from", ci), in.From),
					docpatch.Add(fmt.Sprintf("/timeline/clips/%d/params/ease", ci), in.Ease))
			}
		}
	} else {
		hasStart := false
		for _, c := range sc.Timeline.Cues {
			hasStart = hasStart || c.At <= atStart
		}
		if !hasStart {
			p.Ops = append(p.Ops, docpatch.Add("/timeline/cues/-", Cue{ID: newID("cue"), At: 0, Label: "start"}))
		}
		if sc.Mode != ModeObjects {
			p.Ops = append(p.Ops, docpatch.Replace("/mode", ModeObjects))
		}
	}
	return p, nil
}

// IntroGoCue is transport.cue when GO leaves step 0: with converge, the cue before the first cue at or after the
// converge's end (playback holds there); otherwise the cue at 0.
func IntroGoCue(sc *Scene) int {
	cues := append([]Cue(nil), sc.Timeline.Cues...)
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].At < cues[j].At })
	if sc.Intro == nil || !sc.Intro.Converge {
		return 0
	}
	end := 0.0
	for _, c := range sc.Timeline.Clips {
		if c.Effect == EffectConverge && c.Start <= atStart && c.End > end {
			end = c.End
		}
	}
	for i, c := range cues {
		if c.At >= end-atStart {
			return max(0, i-1)
		}
	}
	return 0
}
