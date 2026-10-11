package show

import "testing"

var cues = []Cue{{At: 0}, {At: 4}, {At: 6, AutoFollow: true}, {At: 8}}

func TestGoBackHold(t *testing.T) {
	now := int64(1e18)
	tr, err := Go(Stop(), cues, now)
	if err != nil || tr.State != Playing || tr.Cue != 0 || tr.Offset != 0 || tr.StartedAt != now {
		t.Fatalf("first go %+v %v", tr, err)
	}
	// 4.2 s later the playhead holds at cue 1 (4 s, no auto-follow)
	tr2, changed := Advance(tr, cues, 20, now+4_200_000_000)
	if !changed || tr2.State != Paused || tr2.Offset != 4 || tr2.Cue != 0 {
		t.Fatalf("hold %+v", tr2)
	}
	tr3, _ := Go(tr2, cues, now+5e9)
	if tr3.Cue != 1 || tr3.Offset != 4 {
		t.Fatalf("go from hold %+v", tr3)
	}
	// cue 2 auto-follows: the index advances and playback continues to cue 3
	tr4, changed := Advance(tr3, cues, 20, now+5e9+2_100_000_000)
	if !changed || tr4.State != Playing || tr4.Cue != 2 {
		t.Fatalf("follow %+v", tr4)
	}
	if at, ok := NextStop(tr4, cues, 20); !ok || at != 8 {
		t.Fatalf("next stop %v %v", at, ok)
	}
	b := Back(tr3, cues, now+5e9+500_000_000)
	if b.Cue != 0 || b.Offset != 0 {
		t.Fatalf("back within a second %+v", b)
	}
	b = Back(tr3, cues, now+5e9+1_500_000_000)
	if b.Cue != 1 || b.Offset != 4 {
		t.Fatalf("back restarts the cue %+v", b)
	}
	last := Transport{State: Playing, StartedAt: now, Offset: 8, Cue: 3}
	if _, err := Go(last, cues, now); err == nil {
		t.Fatal("no cue after the last")
	}
	end, changed := Advance(last, cues, 20, now+13e9)
	if !changed || end.State != Paused || end.Offset != 20 {
		t.Fatalf("end %+v", end)
	}
}

func TestPlayheadSeek(t *testing.T) {
	tr := Transport{State: Playing, StartedAt: 1e9, Offset: 6.4}
	if p := tr.Playhead(3e9); p != 8.4 {
		t.Fatalf("playhead %v", p)
	}
	p := Pause(tr, 2e9)
	if p.Offset != 7.4 || p.State != Paused {
		t.Fatalf("pause %+v", p)
	}
	s := Seek(Stop(), 6.5, cues, 20, 0)
	if s.Offset != 6.5 || s.Cue != 2 || s.State != Paused {
		t.Fatalf("seek %+v", s)
	}
	if s := Seek(Stop(), 99, cues, 20, 0); s.Offset != 20 {
		t.Fatalf("clamp %+v", s)
	}
}
