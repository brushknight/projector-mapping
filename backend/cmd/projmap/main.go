// Command projmap is the projector backdrop and projection-mapping server.
//
//	projmap [serve]           run the server on :7400 (HTTP, WebSocket, MCP, the web app)
//	projmap open [--out]      print a one-time editor login link and open the editor (--out: Chrome kiosk on a display)
//	projmap pair              print the current pairing code
//	projmap mcp [--token t]   stdio MCP bridge to the running server (for Claude Code and Codex)
//	projmap sim               fake phone + fake camera + fake output for testing calibration without hardware
//	projmap install           install as a login item (launchd) and start it
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"projmap/internal/app"
	"projmap/internal/config"
	"projmap/internal/infrastructure/browser"
	"projmap/internal/sim"
)

func main() {
	cmd := "serve"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve(args)
	case "open":
		err = open(args)
	case "pair":
		err = pair(args)
	case "mcp":
		err = mcpBridge(args)
	case "sim":
		err = runSim(args)
	case "install":
		err = install(args)
	case "version":
		fmt.Println(config.Version)
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		err = fmt.Errorf("unknown command %q", cmd)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "projmap:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `projmap: projector backdrops and projection mapping

  projmap [serve]            run the server (port 7400, data in ~/Library/Application Support/projmap or $PROJMAP_DATA)
  projmap open [--out] [--display N]
                             print a one-time editor login link and open the editor; --out opens /out in Chrome kiosk
  projmap pair               print the pairing code the projector shows
  projmap mcp [--token T] [--url U]
                             stdio MCP bridge to the running server (starts it when it is not running)
  projmap sim [--url U]      fake phone camera and projector output, for calibration without hardware
  projmap install            install as a launchd login item and start it
`)
}

func base() string {
	if u := os.Getenv("PROJMAP_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return fmt.Sprintf("http://127.0.0.1:%d", config.Load().Port)
}

// serverPort is the port of the server the CLI talks to: the one in PROJMAP_URL when it names one, else the
// configured port (PROJMAP_PORT or 7400).
func serverPort() int {
	if u, err := url.Parse(base()); err == nil && u.Port() != "" {
		if p, err := strconv.Atoi(u.Port()); err == nil && p > 0 {
			return p
		}
	}
	return config.Load().Port
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fs.Int("port", 0, "port (default 7400 or $PROJMAP_PORT)")
	data := fs.String("data", "", "data folder")
	noBonjour := fs.Bool("no-bonjour", false, "do not advertise over Bonjour")
	_ = fs.Parse(args)
	cfg := config.Load()
	if *port > 0 {
		cfg.Port = *port
	}
	if *data != "" {
		cfg.DataDir = *data
	}
	if *noBonjour {
		cfg.Bonjour = false
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	a, err := app.New(ctx, app.Options{Config: cfg, Log: log})
	if err != nil {
		return err
	}
	errc := make(chan error, 1)
	go func() { errc <- a.Start() }()
	select {
	case err = <-errc:
	case <-ctx.Done():
	}
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	a.Stop(sctx)
	return err
}

func getJSON(method, path string, out any) error {
	req, _ := http.NewRequest(method, base()+path, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("the server is not running at %s (start it with projmap serve): %w", base(), err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return fmt.Errorf("%s %s: %d %s", method, path, res.StatusCode, b)
	}
	return json.Unmarshal(b, out)
}

func pair(_ []string) error {
	var c struct {
		Code      string    `json:"code"`
		ExpiresAt time.Time `json:"expiresAt"`
	}
	if err := getJSON("GET", "/api/v1/pair/code", &c); err != nil {
		return err
	}
	fmt.Printf("%s  (valid until %s)\n", c.Code, c.ExpiresAt.Local().Format("15:04:05"))
	return nil
}

func lanHost() string {
	h, _ := os.Hostname()
	h = strings.TrimSuffix(h, ".local")
	return h + ".local"
}

func open(args []string) error {
	fs := flag.NewFlagSet("open", flag.ExitOnError)
	out := fs.Bool("out", false, "open /out fullscreen in Chrome (kiosk) instead of the editor")
	display := fs.Int("display", 2, "display number for --out (1 = main)")
	noBrowser := fs.Bool("print", false, "only print the links")
	_ = fs.Parse(args)
	if *out {
		return openKiosk(*display)
	}
	var l struct {
		Code      string    `json:"code"`
		ExpiresAt time.Time `json:"expiresAt"`
		Path      string    `json:"path"`
	}
	if err := getJSON("POST", "/api/v1/login-links", &l); err != nil {
		return err
	}
	local := base() + "/editor"
	lan := fmt.Sprintf("http://%s:%d%s", lanHost(), serverPort(), l.Path)
	fmt.Println("editor on this Mac:   ", local)
	fmt.Println("editor on another Mac (one-time link, valid 5 minutes):")
	fmt.Println("  ", lan)
	if !*noBrowser {
		_ = exec.Command("open", local).Run()
	}
	return nil
}

// openKiosk opens /out full screen on the given display in the output's own Chrome profile, and checks with the
// server that /out reports that display's size (internal/infrastructure/browser).
func openKiosk(display int) error {
	ctx := context.Background()
	list, err := browser.Displays(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v; opening on the main display\n", err)
	}
	var d *browser.Display
	if display >= 1 && display <= len(list) {
		d = &list[display-1]
	} else if display > 1 {
		fmt.Fprintf(os.Stderr, "display %d not found; opening on the main display\n", display)
	}
	size := func(context.Context) (int, int, bool) {
		var devs []struct {
			Role      string `json:"role"`
			Online    bool   `json:"online"`
			Telemetry *struct {
				Width  int `json:"width"`
				Height int `json:"height"`
			} `json:"telemetry"`
		}
		if getJSON("GET", "/api/v1/devices", &devs) != nil {
			return 0, 0, false
		}
		for _, v := range devs {
			if v.Role == "output" && v.Online && v.Telemetry != nil && v.Telemetry.Width > 0 {
				return v.Telemetry.Width, v.Telemetry.Height, true
			}
		}
		return 0, 0, false
	}
	return browser.Open(ctx, base()+"/out", d, list, config.Load().DataDir, size)
}

func runSim(args []string) error {
	fs := flag.NewFlagSet("sim", flag.ExitOnError)
	url := fs.String("url", base(), "server URL")
	token := fs.String("token", "", "device token (not needed on this Mac)")
	noOutput := fs.Bool("no-output", false, "do not act as the projector output (use a real /out)")
	fps := fs.Float64("fps", 6, "camera preview frames per second")
	_ = fs.Parse(args)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err := sim.Run(ctx, sim.Options{URL: *url, Token: *token, Output: !*noOutput, FPS: *fps, Log: slog.New(slog.NewTextHandler(os.Stderr, nil))})
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

const plistLabel = "dev.projmap.server"

func install(_ []string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self, _ = filepath.EvalSymlinks(self)
	cfg := config.Load()
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return err
	}
	home, _ := os.UserHomeDir()
	logPath := filepath.Join(cfg.DataDir, "projmap.log")
	plist := filepath.Join(home, "Library", "LaunchAgents", plistLabel+".plist")
	content := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>%s</string>
	<key>ProgramArguments</key>
	<array><string>%s</string><string>serve</string></array>
	<key>EnvironmentVariables</key>
	<dict><key>PATH</key><string>%s/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ProcessType</key><string>Interactive</string>
	<key>StandardOutPath</key><string>%s</string>
	<key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, plistLabel, self, home, logPath, logPath)
	uid := fmt.Sprint(os.Getuid())
	job := "gui/" + uid + "/" + plistLabel
	// the same login item already registered: restart it (it picks up a rebuilt binary)
	if cur, err := os.ReadFile(plist); err == nil && string(cur) == content && exec.Command("launchctl", "print", job).Run() == nil {
		if out, err := exec.Command("launchctl", "kickstart", "-k", job).CombinedOutput(); err != nil {
			return fmt.Errorf("launchctl kickstart: %v: %s", err, out)
		}
		fmt.Println("restarted", plistLabel)
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(plist), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(plist, []byte(content), 0o644); err != nil {
		return err
	}
	_ = exec.Command("launchctl", "bootout", job).Run()
	time.Sleep(500 * time.Millisecond)
	if out, err := exec.Command("launchctl", "bootstrap", "gui/"+uid, plist).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl bootstrap: %v: %s", err, out)
	}
	fmt.Println("installed", plist, "; logs in", logPath)
	return nil
}
