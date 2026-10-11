package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/config"
)

// mcpBridge connects stdin/stdout (Claude Code, Codex) to the running server's /mcp, starting the server when it is
// not running. Messages pass through unchanged, so the daemon stays the only source of truth.
func mcpBridge(args []string) error {
	fs := flag.NewFlagSet("mcp", flag.ExitOnError)
	token := fs.String("token", os.Getenv("PROJMAP_TOKEN"), "device or agent token (not needed on this Mac)")
	url := fs.String("url", base()+"/mcp", "the server's MCP endpoint")
	_ = fs.Parse(args)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := ensureServer(*url); err != nil {
		return err
	}
	client := &http.Client{Transport: bearer{token: *token, rt: http.DefaultTransport}}
	remote, err := (&mcp.StreamableClientTransport{Endpoint: *url, HTTPClient: client}).Connect(ctx)
	if err != nil {
		return fmt.Errorf("connect %s: %w", *url, err)
	}
	local, err := (&mcp.StdioTransport{}).Connect(ctx)
	if err != nil {
		return err
	}
	errc := make(chan error, 2)
	pump := func(from, to mcp.Connection) {
		for {
			msg, err := from.Read(ctx)
			if err != nil {
				errc <- err
				return
			}
			if err := to.Write(ctx, msg); err != nil {
				errc <- err
				return
			}
		}
	}
	go pump(local, remote)
	go pump(remote, local)
	err = <-errc
	cancel()
	_ = remote.Close()
	_ = local.Close()
	if errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

type bearer struct {
	token string
	rt    http.RoundTripper
}

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	if b.token != "" {
		r = r.Clone(r.Context())
		r.Header.Set("Authorization", "Bearer "+b.token)
	}
	return b.rt.RoundTrip(r)
}

// ensureServer starts `projmap serve` in the background when /api/v1/info does not answer.
func ensureServer(mcpURL string) error {
	info := mcpURL[:len(mcpURL)-len("/mcp")] + "/api/v1/info"
	ok := func() bool {
		c := http.Client{Timeout: time.Second}
		res, err := c.Get(info)
		if err != nil {
			return false
		}
		res.Body.Close()
		return res.StatusCode == http.StatusOK
	}
	if ok() {
		return nil
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	cfg := config.Load()
	_ = os.MkdirAll(cfg.DataDir, 0o755)
	logf, _ := os.OpenFile(filepath.Join(cfg.DataDir, "projmap.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	cmd := exec.Command(self, "serve")
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start the server: %w", err)
	}
	_ = cmd.Process.Release()
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		if ok() {
			return nil
		}
	}
	return fmt.Errorf("the server did not start; see %s", filepath.Join(cfg.DataDir, "projmap.log"))
}
