// Package browser opens the projector output as a clean Chrome window on a chosen display (protocol §17): an app
// window (no address bar) of its own Chrome profile, so it never joins the user's normal Chrome session, with sound
// allowed without a click. `projmap open --out` and `POST /api/v1/outputs/launch` share it.
//
// Chrome on macOS does not honour --window-position for a display left of or above the main one (negative
// coordinates): with --kiosk the window lands on whichever display Chrome likes. So the window opens as a plain app
// window, the Accessibility API (System Events) moves it onto the display and reads its bounds back, and DevTools
// puts the page into its own full screen there (no gesture needed, no Chrome UI). When the caller can see the
// output's reported size (/out telemetry) it must equal the display's pixels; misses retry before Open gives up
// with an error that says what it measured.
package browser

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Display is one screen attached to this Mac. Index counts from 1 (1 is the main display, as in
// `projmap open --out --display`). X, Y, PointWidth and PointHeight are its frame in screen points in the
// Accessibility coordinates (origin the main display's top-left corner, y down: a display above the main one has a
// negative Y); Width and Height are pixels (points × Scale).
type Display struct {
	Index       int     `json:"index"`
	Name        string  `json:"name"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Scale       float64 `json:"scale"`
	X           int     `json:"x"`
	Y           int     `json:"y"`
	PointWidth  int     `json:"pointWidth"`
	PointHeight int     `json:"pointHeight"`
	Main        bool    `json:"main"`
}

// Exec runs a command and waits for it (no shell: every argument is passed as is); tests replace it so no browser
// ever opens.
var Exec = func(ctx context.Context, name string, args ...string) error {
	return exec.CommandContext(ctx, name, args...).Run()
}

// Output runs a command and returns its standard output (ps, osascript); tests replace it.
var Output = func(ctx context.Context, name string, args ...string) ([]byte, error) {
	out, err := exec.CommandContext(ctx, name, args...).Output()
	var ee *exec.ExitError
	if errors.As(err, &ee) && len(ee.Stderr) > 0 {
		err = fmt.Errorf("%w: %s", err, strings.TrimSpace(string(ee.Stderr)))
	}
	return out, err
}

// Probe returns NSScreen.screens as JSON frames in AppKit coordinates (see displaysScript); tests replace it.
var Probe = func(ctx context.Context) ([]byte, error) {
	return Output(ctx, "osascript", "-l", "JavaScript", "-e", displaysScript)
}

// Wait is how long Open polls for Chrome's process, its window and the output's size; tests shorten it.
var Wait = 12 * time.Second

// poll is the polling step.
var poll = 250 * time.Millisecond

// displaysScript lists NSScreen.screens (the first is the main display) as [{name, x, y, w, h, scale}]: the frame
// in AppKit points (origin the main display's bottom-left corner, y up).
const displaysScript = `ObjC.import('AppKit');
var s = $.NSScreen.screens.js;
JSON.stringify(s.map(function (x) { var f = x.frame; var n = '';
  try { n = x.localizedName.js } catch (e) {}
  return { name: n, x: f.origin.x, y: f.origin.y, w: f.size.width, h: f.size.height, scale: x.backingScaleFactor } }))`

// Frame is a display frame as AppKit reports it: points, origin the main display's bottom-left corner, y up.
type Frame struct {
	Name  string  `json:"name"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Scale float64 `json:"scale"`
}

// FromFrames converts AppKit frames (main display first) into Displays in Accessibility coordinates: x stays, the
// top edge y_ax = mainHeight − (y + h).
func FromFrames(frames []Frame) []Display {
	out := make([]Display, 0, len(frames))
	if len(frames) == 0 {
		return out
	}
	mainH := frames[0].H
	for i, f := range frames {
		scale := f.Scale
		if scale <= 0 {
			scale = 1
		}
		name := f.Name
		if name == "" {
			name = fmt.Sprintf("display %d", i+1)
		}
		out = append(out, Display{Index: i + 1, Name: name, Width: int(f.W*scale + 0.5), Height: int(f.H*scale + 0.5), Scale: scale,
			X: int(f.X), Y: int(mainH - f.Y - f.H), PointWidth: int(f.W), PointHeight: int(f.H), Main: i == 0})
	}
	return out
}

// Displays lists the displays attached now.
func Displays(ctx context.Context) ([]Display, error) {
	b, err := Probe(ctx)
	if err != nil {
		return nil, fmt.Errorf("list displays: %w", err)
	}
	var frames []Frame
	if err := json.Unmarshal(b, &frames); err != nil {
		return nil, fmt.Errorf("list displays: %w", err)
	}
	return FromFrames(frames), nil
}

// ProfileDir is the output window's own Chrome profile under the data folder.
func ProfileDir(dataDir string) string { return filepath.Join(dataDir, "chrome-out") }

// AppArgs are the `open` arguments that start Chrome as an app window at url with its own profile. Each flag is one
// argument (the profile path has a space in "Application Support"; nothing goes through a shell). The position and
// size are a first hint only: Chrome ignores positions on displays left of or above the main one.
func AppArgs(url string, d Display, profile string) []string {
	return []string{"-na", "Google Chrome", "--args", "--app=" + url, "--user-data-dir=" + profile,
		fmt.Sprintf("--window-position=%d,%d", d.X, d.Y), fmt.Sprintf("--window-size=%d,%d", d.PointWidth, d.PointHeight),
		"--no-first-run", "--autoplay-policy=no-user-gesture-required", "--disable-features=Translate",
		// DevTools on a free loopback port (written to <profile>/DevToolsActivePort): how the page goes full screen
		"--remote-debugging-port=0"}
}

// MoveTarget is where the window goes before it turns full screen: inside the display with a 40 point margin (so
// macOS never pushes it back across the edge), in Accessibility points.
func MoveTarget(d Display) (x, y, w, h int) {
	return d.X + 40, d.Y + 40, max(400, d.PointWidth-80), max(300, d.PointHeight-80)
}

// Bounds is a window's frame in Accessibility points.
type Bounds struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// On tells whether the window's centre lies on display d.
func (b Bounds) On(d Display) bool {
	cx, cy := b.X+b.W/2, b.Y+b.H/2
	return cx >= d.X && cx < d.X+d.PointWidth && cy >= d.Y && cy < d.Y+d.PointHeight
}

// Which is the display the window's centre lies on (0 when none).
func (b Bounds) Which(list []Display) int {
	for _, d := range list {
		if b.On(d) {
			return d.Index
		}
	}
	return 0
}

// moveScript moves the front window of the Chrome process `pid` to x, y, sizes it w × h, optionally makes it full
// screen, and prints its bounds. Arguments come in argv (never spliced into the source).
const moveScript = `function run(argv) {
  var pid = Number(argv[0]), x = Number(argv[1]), y = Number(argv[2]), w = Number(argv[3]), h = Number(argv[4]);
  var full = argv[5] === '1';
  var se = Application('System Events');
  var t0 = Date.now(), p = null;
  while (Date.now() - t0 < 10000) {
    var ps = se.processes.whose({ unixId: pid });
    if (ps.length > 0 && ps[0].windows.length > 0) { p = ps[0]; break; }
    delay(0.2);
  }
  if (!p) throw new Error('Chrome has no window yet');
  var win = p.windows[0];
  var fs = win.attributes.byName('AXFullScreen');
  try { if (fs.value()) { fs.value = false; delay(1.2); } } catch (e) {}
  win.position = [x, y];
  delay(0.2);
  win.size = [w, h];
  delay(0.3);
  win.position = [x, y];
  if (full) { try { fs.value = true; } catch (e) {} delay(1.6); }
  var pos = win.position(), size = win.size();
  return JSON.stringify({ x: pos[0], y: pos[1], w: size[0], h: size[1] });
}`

// Size is an output's reported size in pixels (the /out telemetry); ok false while nothing reports.
type Size func(ctx context.Context) (w, h int, ok bool)

// Open shows url full screen on display d (nil: the main display) with no Chrome UI at all: it starts Chrome as an
// app window of the output profile, finds that Chrome's process, moves its window onto d with the Accessibility API
// and checks the window bounds, then puts the page itself into full screen through DevTools (PageFullscreen; when
// that fails, macOS full screen of the window through AXFullScreen). With size (the /out telemetry) it waits for the
// output to report exactly d's pixel size. Every miss retries, three attempts in all, then it answers what it
// measured. `all` is the display list, to say where the window went instead.
func Open(ctx context.Context, url string, d *Display, all []Display, dataDir string, size Size) error {
	target := Display{Index: 1, Name: "the main display", PointWidth: 1440, PointHeight: 900, Width: 1440, Height: 900, Scale: 1, Main: true}
	if d != nil {
		target = *d
	} else if len(all) > 0 {
		target = all[0]
	}
	profile := ProfileDir(dataDir)
	if err := Exec(ctx, "open", AppArgs(url, target, profile)...); err != nil {
		return fmt.Errorf("Chrome did not start: %w", err)
	}
	pid, err := chromePID(ctx, profile)
	if err != nil {
		return err
	}
	var last string
	for attempt := 1; attempt <= 3; attempt++ {
		b, err := move(ctx, pid, target, false)
		if err != nil {
			if strings.Contains(err.Error(), "assistive") || strings.Contains(err.Error(), "-1719") || strings.Contains(err.Error(), "-25211") {
				return fmt.Errorf("the output window opened, but projmap may not move it: allow it in System Settings → Privacy & Security → Accessibility (%v)", err)
			}
			last = fmt.Sprintf("moving the window failed: %v", err)
			continue
		}
		if !b.On(target) {
			where := "off every display"
			if i := b.Which(all); i > 0 {
				where = fmt.Sprintf("on display %d", i)
			}
			last = fmt.Sprintf("the window ended up %s at %d,%d (%d×%d points), not on display %d", where, b.X, b.Y, b.W, b.H, target.Index)
			continue
		}
		if err := PageFullscreen(ctx, profile, url); err != nil {
			// no DevTools: macOS full screen of the window (the title bar can slide in when the pointer reaches the top)
			if _, err2 := move(ctx, pid, target, true); err2 != nil {
				last = fmt.Sprintf("full screen failed: %v; %v", err, err2)
				continue
			}
		}
		if size == nil {
			return nil
		}
		w, h, seen := waitSize(ctx, size, target)
		if !seen || Fills(w, h, target) {
			return nil
		}
		last = fmt.Sprintf("the output measures %d×%d pixels, not display %d's %d×%d (not full screen there)", w, h, target.Index, target.Width, target.Height)
	}
	return fmt.Errorf("the output did not go full screen on display %d (%s): %s", target.Index, target.Name, last)
}

// Fills tells whether an output measuring w × h pixels (the /out canvas: window size × devicePixelRatio) fills
// display d: its pixel size, give or take 2 pixels of rounding.
func Fills(w, h int, d Display) bool {
	return abs(w-d.Width) <= 2 && abs(h-d.Height) <= 2
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// waitSize polls the output's reported size until it fills d or Wait runs out; seen is false when nothing reported.
func waitSize(ctx context.Context, size Size, d Display) (w, h int, seen bool) {
	deadline := time.Now().Add(Wait)
	for {
		if ww, hh, ok := size(ctx); ok {
			w, h, seen = ww, hh, true
			if Fills(w, h, d) {
				return
			}
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return
		}
		time.Sleep(poll)
	}
}

// chromePID finds the main process of the Chrome that runs the output profile (not its helpers).
func chromePID(ctx context.Context, profile string) (int, error) {
	deadline := time.Now().Add(Wait)
	flag := "--user-data-dir=" + profile
	for {
		out, err := Output(ctx, "ps", "-axww", "-o", "pid=,command=")
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				line = strings.TrimSpace(line)
				if !strings.Contains(line, flag) || strings.Contains(line, "--type=") || !strings.Contains(line, "Google Chrome") {
					continue
				}
				f := strings.Fields(line)
				if pid, err := strconv.Atoi(f[0]); err == nil {
					return pid, nil
				}
			}
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return 0, errors.New("Chrome started, but its window never appeared. Install Google Chrome, or open the output by hand")
		}
		time.Sleep(poll)
	}
}

// move runs moveScript for the window of pid onto d, with macOS full screen when full.
func move(ctx context.Context, pid int, d Display, full bool) (Bounds, error) {
	x, y, w, h := MoveTarget(d)
	fs := "0"
	if full {
		fs = "1"
	}
	out, err := Output(ctx, "osascript", "-l", "JavaScript", "-e", moveScript, "--",
		strconv.Itoa(pid), strconv.Itoa(x), strconv.Itoa(y), strconv.Itoa(w), strconv.Itoa(h), fs)
	if err != nil {
		return Bounds{}, err
	}
	var b Bounds
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(out))), &b); err != nil {
		return Bounds{}, fmt.Errorf("unreadable window bounds %q", strings.TrimSpace(string(out)))
	}
	return b, nil
}
