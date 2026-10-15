package browser

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// PageFullscreen puts the page at url of the output profile's Chrome into the page's own full screen (the Fullscreen
// API, as a click on /out would), through the Chrome DevTools Protocol on the port Chrome wrote to
// <profile>/DevToolsActivePort: Runtime.evaluate of document.documentElement.requestFullscreen() as a user gesture.
// Page full screen shows no Chrome UI at all, and macOS takes the display the window is on. Tests replace it.
var PageFullscreen = func(ctx context.Context, profile, url string) error {
	ws, err := pageSocket(ctx, profile, url)
	if err != nil {
		return err
	}
	c, _, err := websocket.Dial(ctx, ws, nil)
	if err != nil {
		return fmt.Errorf("devtools: %w", err)
	}
	defer c.CloseNow()
	req, _ := json.Marshal(map[string]any{"id": 1, "method": "Runtime.evaluate", "params": map[string]any{
		"expression":    "document.documentElement.requestFullscreen().then(() => !!document.fullscreenElement)",
		"userGesture":   true,
		"awaitPromise":  true,
		"returnByValue": true,
	}})
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, req); err != nil {
		return fmt.Errorf("devtools: %w", err)
	}
	for {
		_, b, err := c.Read(ctx)
		if err != nil {
			return fmt.Errorf("devtools: %w", err)
		}
		var m struct {
			ID     int `json:"id"`
			Result struct {
				Result struct {
					Value any `json:"value"`
				} `json:"result"`
				Exception *struct {
					Text string `json:"text"`
				} `json:"exceptionDetails"`
			} `json:"result"`
		}
		if json.Unmarshal(b, &m) != nil || m.ID != 1 {
			continue
		}
		if m.Result.Exception != nil {
			return fmt.Errorf("the page refused full screen: %s", m.Result.Exception.Text)
		}
		if m.Result.Result.Value != true {
			return errors.New("the page did not go full screen")
		}
		return nil
	}
}

// pageSocket finds the DevTools WebSocket of the page whose URL starts with url.
func pageSocket(ctx context.Context, profile, url string) (string, error) {
	deadline := time.Now().Add(Wait)
	for {
		if port, err := devtoolsPort(profile); err == nil {
			var list []struct {
				Type string `json:"type"`
				URL  string `json:"url"`
				WS   string `json:"webSocketDebuggerUrl"`
			}
			req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("http://127.0.0.1:%d/json/list", port), nil)
			if res, err := http.DefaultClient.Do(req); err == nil {
				_ = json.NewDecoder(res.Body).Decode(&list)
				_ = res.Body.Close()
				for _, t := range list {
					if t.Type == "page" && strings.HasPrefix(t.URL, url) && t.WS != "" {
						return t.WS, nil
					}
				}
			}
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return "", errors.New("devtools: the output page never showed up")
		}
		time.Sleep(poll)
	}
}

// devtoolsPort reads the port Chrome listens on for DevTools (first line of DevToolsActivePort).
func devtoolsPort(profile string) (int, error) {
	b, err := os.ReadFile(filepath.Join(profile, "DevToolsActivePort"))
	if err != nil {
		return 0, err
	}
	line, _, _ := strings.Cut(string(b), "\n")
	return strconv.Atoi(strings.TrimSpace(line))
}
