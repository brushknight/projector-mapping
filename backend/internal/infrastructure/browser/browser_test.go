package browser

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

// The user's Mac: the DELL is main, the projector ("Monitor") sits ABOVE it, the SOTSU is a portrait display on the
// right. AppKit frames: origin the main display's bottom-left corner, y up.
var userFrames = []Frame{
	{Name: "DELL U2723QE", X: 0, Y: 0, W: 2560, H: 1440, Scale: 1},
	{Name: "Monitor", X: 200, Y: 1440, W: 1920, H: 1080, Scale: 1},
	{Name: "SOTSU ELITE16", X: 2560, Y: -480, W: 1200, H: 1920, Scale: 2},
}

func TestFromFramesToAccessibilityPoints(t *testing.T) {
	ds := FromFrames(userFrames)
	want := []struct{ x, y, w, h, pw, ph int }{
		{0, 0, 2560, 1440, 2560, 1440},
		{200, -1080, 1920, 1080, 1920, 1080}, // above the main display: negative y
		{2560, 0, 1200, 1920, 2400, 3840},
	}
	for i, d := range ds {
		g := want[i]
		if d.Index != i+1 || d.X != g.x || d.Y != g.y || d.PointWidth != g.w || d.PointHeight != g.h || d.Width != g.pw || d.Height != g.ph {
			t.Fatalf("display %d: %+v, want %+v", i+1, d, g)
		}
	}
	if !ds[0].Main || ds[1].Main {
		t.Fatal("the first frame is the main display")
	}
	// where the window goes before full screen: inside each display with a margin
	targets := [][4]int{{40, 40, 2480, 1360}, {240, -1040, 1840, 1000}, {2600, 40, 1120, 1840}}
	for i, d := range ds {
		x, y, w, h := MoveTarget(d)
		if [4]int{x, y, w, h} != targets[i] {
			t.Fatalf("display %d move target %v, want %v", i+1, [4]int{x, y, w, h}, targets[i])
		}
		if b := (Bounds{X: x, Y: y, W: w, H: h}); !b.On(d) || b.Which(ds) != d.Index {
			t.Fatalf("display %d: the move target is not on it", i+1)
		}
		// full screen: the window covers the display exactly
		if b := (Bounds{X: d.X, Y: d.Y, W: d.PointWidth, H: d.PointHeight}); b.Which(ds) != d.Index {
			t.Fatalf("display %d: its own frame reads as display %d", i+1, b.Which(ds))
		}
	}
}

func TestAppArgsKeepTheProfilePathWhole(t *testing.T) {
	ds := FromFrames(userFrames)
	profile := ProfileDir("/Users/me/Library/Application Support/projmap")
	args := AppArgs("http://127.0.0.1:7400/out", ds[1], profile)
	for _, want := range []string{"--app=http://127.0.0.1:7400/out", "--user-data-dir=/Users/me/Library/Application Support/projmap/chrome-out",
		"--window-position=200,-1080", "--window-size=1920,1080", "--autoplay-policy=no-user-gesture-required", "--no-first-run",
		"--remote-debugging-port=0"} {
		if !slices.Contains(args, want) {
			t.Fatalf("missing %q in %q", want, args)
		}
	}
	if slices.Contains(args, "--kiosk") {
		t.Fatal("no --kiosk: Chrome ignores the position with it on displays above or left of the main one")
	}
}

// fake stubs open, ps and osascript: the window lands where `land` says for each move attempt.
type fake struct {
	opened [][]string
	moves  [][]string
	land   []Bounds
	// pageFull is how many times the page was asked to go full screen; noDevtools fails it
	pageFull   int
	noDevtools bool
}

func (f *fake) install(t *testing.T, profile string) {
	t.Helper()
	ex, out, w, p, pf := Exec, Output, Wait, poll, PageFullscreen
	Wait, poll = 200*time.Millisecond, time.Millisecond
	PageFullscreen = func(_ context.Context, prof, url string) error {
		f.pageFull++
		if prof != profile {
			t.Errorf("devtools on profile %q", prof)
		}
		if f.noDevtools {
			return fmt.Errorf("devtools: the output page never showed up")
		}
		return nil
	}
	Exec = func(_ context.Context, name string, args ...string) error {
		f.opened = append(f.opened, append([]string{name}, args...))
		return nil
	}
	Output = func(_ context.Context, name string, args ...string) ([]byte, error) {
		switch name {
		case "ps":
			return []byte(fmt.Sprintf("  101 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=%[1]s --app=x\n"+
				"  102 /Applications/Google Chrome.app/.../Google Chrome Helper --type=renderer --user-data-dir=%[1]s\n", profile)), nil
		case "osascript":
			f.moves = append(f.moves, args)
			i := min(len(f.moves), len(f.land)) - 1
			b, _ := json.Marshal(f.land[i])
			return b, nil
		}
		return nil, fmt.Errorf("unexpected %s", name)
	}
	t.Cleanup(func() { Exec, Output, Wait, poll, PageFullscreen = ex, out, w, p, pf })
}

func TestOpenMovesTheWindowOntoTheDisplay(t *testing.T) {
	ds := FromFrames(userFrames)
	dataDir := "/Users/me/Library/Application Support/projmap"
	f := &fake{land: []Bounds{{X: 200, Y: -1080, W: 1920, H: 1080}}}
	f.install(t, ProfileDir(dataDir))
	size := func(context.Context) (int, int, bool) { return 1920, 1080, true }
	if err := Open(context.Background(), "http://127.0.0.1:7400/out", &ds[1], ds, dataDir, size); err != nil {
		t.Fatal(err)
	}
	if len(f.opened) != 1 || f.opened[0][0] != "open" {
		t.Fatalf("opened %q", f.opened)
	}
	// the move goes to the main Chrome process (not a helper) in AX points; the page then goes full screen itself
	tail := f.moves[0][len(f.moves[0])-6:]
	if strings.Join(tail, " ") != "101 240 -1040 1840 1000 0" || f.pageFull != 1 || len(f.moves) != 1 {
		t.Fatalf("move args %q, page full screen %d, moves %d", tail, f.pageFull, len(f.moves))
	}
	// without DevTools the window falls back to macOS full screen (AXFullScreen)
	f2 := &fake{land: []Bounds{{X: 200, Y: -1080, W: 1920, H: 1080}}, noDevtools: true}
	f2.install(t, ProfileDir(dataDir))
	if err := Open(context.Background(), "http://127.0.0.1:7400/out", &ds[1], ds, dataDir, size); err != nil {
		t.Fatal(err)
	}
	if len(f2.moves) != 2 || f2.moves[1][len(f2.moves[1])-1] != "1" {
		t.Fatalf("fallback moves %q", f2.moves)
	}
}

func TestOpenRetriesThenSaysWhereTheWindowWent(t *testing.T) {
	ds := FromFrames(userFrames)
	// the window keeps landing on the SOTSU, the way Chrome placed it on the user's Mac
	f := &fake{land: []Bounds{{X: 2560, Y: 0, W: 1200, H: 1018}}}
	f.install(t, ProfileDir("/d"))
	err := Open(context.Background(), "http://127.0.0.1:7400/out", &ds[1], ds, "/d", nil)
	if err == nil || !strings.Contains(err.Error(), "on display 3") || !strings.Contains(err.Error(), "not on display 2") {
		t.Fatalf("err %v", err)
	}
	if len(f.moves) != 3 {
		t.Fatalf("want 3 attempts, got %d", len(f.moves))
	}
	// the window is on the display but the output reports another size: retried, then an error with both sizes
	f2 := &fake{land: []Bounds{{X: 200, Y: -1080, W: 1920, H: 1080}}}
	f2.install(t, ProfileDir("/d"))
	err = Open(context.Background(), "u", &ds[1], ds, "/d", func(context.Context) (int, int, bool) { return 2400, 2036, true })
	if err == nil || !strings.Contains(err.Error(), "2400×2036") || !strings.Contains(err.Error(), "1920×1080") || f2.pageFull != 3 {
		t.Fatalf("err %v after %d full screen tries", err, f2.pageFull)
	}
	// a second attempt that lands is a success
	f3 := &fake{land: []Bounds{{X: 2560, Y: 0, W: 1200, H: 1018}, {X: 200, Y: -1080, W: 1920, H: 1080}}}
	f3.install(t, ProfileDir("/d"))
	if err := Open(context.Background(), "u", &ds[1], ds, "/d", nil); err != nil || len(f3.moves) != 2 {
		t.Fatalf("err %v after %d moves", err, len(f3.moves))
	}
}

// The /out canvas is window size × devicePixelRatio: full screen on a display it equals the display's pixels.
func TestFillsNeedsTheDisplaysPixels(t *testing.T) {
	ds := FromFrames(append(userFrames, Frame{Name: "4K projector", X: -1920, Y: 0, W: 1920, H: 1080, Scale: 2}))
	cases := []struct {
		d    int
		w, h int
		want bool
	}{
		{1, 2560, 1440, true},
		{1, 2560, 1415, false}, // a window with its title bar
		{2, 1920, 1080, true},
		{2, 1921, 1079, true},  // rounding
		{2, 1880, 1080, false}, // within 12 %, but not full screen
		{3, 2400, 3840, true},
		{3, 2400, 2036, false}, // what the user's Mac reported: a window on the SOTSU
		{4, 3840, 2160, true},  // 1920 × 1080 points at 2×: the pixels, not the points
		{4, 1920, 1080, false},
	}
	for _, c := range cases {
		if got := Fills(c.w, c.h, ds[c.d-1]); got != c.want {
			t.Errorf("display %d (%d×%d px): %d×%d fills = %v", c.d, ds[c.d-1].Width, ds[c.d-1].Height, c.w, c.h, got)
		}
	}
	if d := ds[3]; d.X != -1920 || d.Y != 360 || d.Width != 3840 || d.Height != 2160 {
		t.Fatalf("left 4K display %+v", d)
	}
}
