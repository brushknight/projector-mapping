// Package outputs tests putting the output on a display (protocol §17). Chrome and the display list are stubbed: no
// window ever opens and nothing asks the system.
package outputs

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
	"projmap/internal/infrastructure/browser"
)

// AppKit frames (origin the main display's bottom-left corner, y up): the projector sits above the main display
const twoDisplays = `[{"name":"Built-in Retina Display","w":1512,"h":982,"scale":2,"x":0,"y":0},
 {"name":"EPSON PJ","w":1920,"h":1080,"scale":1,"x":200,"y":982}]`

type call struct {
	name string
	args []string
}

// stub replaces the exec and the display probe for one test.
func stub(t *testing.T, displays string, execErr error) *[]call {
	t.Helper()
	calls := &[]call{}
	exec, probe, output, wait, pageFull := browser.Exec, browser.Probe, browser.Output, browser.Wait, browser.PageFullscreen
	browser.Wait = 300 * time.Millisecond
	browser.PageFullscreen = func(context.Context, string, string) error { return nil }
	browser.Exec = func(_ context.Context, name string, args ...string) error {
		*calls = append(*calls, call{name, args})
		return execErr
	}
	// ps finds the output profile's Chrome; osascript reports the window full screen on the display it was sent to
	browser.Output = func(_ context.Context, name string, args ...string) ([]byte, error) {
		switch name {
		case "ps":
			for _, c := range *calls {
				for _, a := range c.args {
					if strings.HasPrefix(a, "--user-data-dir=") {
						return []byte("  77 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome " + a + "\n"), nil
					}
				}
			}
			return nil, nil
		case "osascript":
			n := len(args)
			x, _ := strconv.Atoi(args[n-5])
			y, _ := strconv.Atoi(args[n-4])
			return []byte(fmt.Sprintf(`{"x":%d,"y":%d,"w":800,"h":600}`, x-40, y-40)), nil
		}
		return nil, errors.New("unexpected " + name)
	}
	browser.Probe = func(context.Context) ([]byte, error) {
		if displays == "" {
			return nil, errors.New("no window server")
		}
		return []byte(displays), nil
	}
	t.Cleanup(func() {
		browser.Exec, browser.Probe, browser.Output, browser.Wait, browser.PageFullscreen = exec, probe, output, wait, pageFull
	})
	return calls
}

func TestDisplays(t *testing.T) {
	stub(t, twoDisplays, nil)
	h := apitest.New(t)
	var list []browser.Display
	r := h.Do("GET", "/api/v1/outputs/displays", nil)
	apitest.Expect(t, r, http.StatusOK)
	r.Into(t, &list)
	if len(list) != 2 {
		t.Fatalf("displays %s", r.Body)
	}
	if d := list[0]; d.Index != 1 || !d.Main || d.Width != 3024 || d.Height != 1964 || d.Name != "Built-in Retina Display" {
		t.Fatalf("main display %+v", d)
	}
	if d := list[1]; d.Index != 2 || d.Main || d.Width != 1920 || d.X != 200 || d.Y != -1080 {
		t.Fatalf("second display %+v", d)
	}
}

func TestLaunch(t *testing.T) {
	calls := stub(t, twoDisplays, nil)
	h := apitest.New(t)
	r := h.Do("POST", "/api/v1/outputs/launch", map[string]any{"display": 2, "route": "out"})
	apitest.Expect(t, r, http.StatusAccepted)
	var res struct {
		Launched bool
		URL      string
		Display  browser.Display
	}
	r.Into(t, &res)
	if !res.Launched || !strings.HasSuffix(res.URL, "/out") || res.Display.Index != 2 {
		t.Fatalf("launch %s", r.Body)
	}
	if len(*calls) != 1 || (*calls)[0].name != "open" {
		t.Fatalf("calls %+v", *calls)
	}
	args := (*calls)[0].args
	for _, want := range []string{"--app=" + res.URL, "--window-position=200,-1080", "--window-size=1920,1080", "--autoplay-policy=no-user-gesture-required", "--no-first-run"} {
		if !slices.Contains(args, want) {
			t.Fatalf("missing %s in %v", want, args)
		}
	}
	if !slices.Contains(args, "--user-data-dir="+browser.ProfileDir(h.DataDir)) {
		t.Fatalf("the kiosk window needs its own profile under the data folder: %v", args)
	}
	// the viewer, on the main display
	r = h.Do("POST", "/api/v1/outputs/launch", map[string]any{"display": 1, "route": "view"})
	apitest.Expect(t, r, http.StatusAccepted)
	if args := (*calls)[1].args; !slices.Contains(args, "--window-position=0,0") || !strings.HasSuffix(args[slices.IndexFunc(args, func(a string) bool { return strings.HasPrefix(a, "--app=") })], "/view") {
		t.Fatalf("viewer args %v", args)
	}
}

func TestLaunchRefuses(t *testing.T) {
	calls := stub(t, twoDisplays, nil)
	h := apitest.New(t)
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/outputs/launch", map[string]any{"display": 3}), http.StatusNotFound, "not_found")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/outputs/launch", map[string]any{"display": 1, "route": "editor"}), http.StatusBadRequest, "bad_request")
	// a paired phone on the network cannot start programs on this Mac
	code := h.Do("GET", "/api/v1/pair/code", nil).Map(t)
	var pr struct{ Token string }
	h.Remote("POST", "/api/v1/pair", map[string]any{"code": code["code"], "name": "phone", "role": "remote"}, "").Into(t, &pr)
	apitest.ExpectErr(t, h.Remote("POST", "/api/v1/outputs/launch", map[string]any{"display": 1, "route": "out"}, pr.Token), http.StatusForbidden, "forbidden")
	apitest.ExpectErr(t, h.Remote("GET", "/api/v1/outputs/displays", nil, pr.Token), http.StatusForbidden, "forbidden")
	if len(*calls) != 0 {
		t.Fatalf("nothing may launch: %+v", *calls)
	}
}

func TestLaunchFailures(t *testing.T) {
	stub(t, "", nil)
	h := apitest.New(t)
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/outputs/displays", nil), http.StatusServiceUnavailable, "unavailable")
	stub(t, twoDisplays, errors.New("no Chrome"))
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/outputs/launch", map[string]any{"display": 1}), http.StatusServiceUnavailable, "unavailable")
}
