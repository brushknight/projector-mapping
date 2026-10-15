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
	"sync"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/config"
)

// mcpBridge connects stdin/stdout (Claude Code, Codex) to the running server's /mcp, starting the server when it is
// not running. Messages pass through unchanged, so the daemon stays the only source of truth. When the server restarts
// (its MCP sessions are gone) the bridge reconnects, replays the client's initialize and resends the calls that had no
// answer; the client never sees the restart. It exits only when the client closes stdin.
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
	local, err := (&mcp.StdioTransport{}).Connect(ctx)
	if err != nil {
		return err
	}
	defer local.Close()
	b := newBridge(*url, &http.Client{Transport: bearer{token: *token, rt: http.DefaultTransport}}, local)
	b.ensure = func() { _ = ensureServer(*url) }
	b.log = func(format string, a ...any) { fmt.Fprintf(os.Stderr, "projmap mcp: "+format+"\n", a...) }
	err = b.run(ctx)
	if errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

// bridge relays one MCP client to the server, reconnecting upstream when the server's session goes away.
type bridge struct {
	url    string
	client *http.Client
	local  mcp.Connection
	ensure func() // starts the server when it is down (nil in tests)
	log    func(format string, a ...any)
	// Retry bounds how long a reconnect keeps trying before answering the waiting calls with an error.
	Retry time.Duration

	mu       sync.Mutex
	remote   mcp.Connection
	gen      int
	initReq  *jsonrpc.Request // the client's initialize, replayed on every new session
	inited   bool             // the client sent notifications/initialized
	pending  map[any]*jsonrpc.Request
	initSeq  int
	internal map[any]bool // ids of our replayed initialize requests (their answers are dropped)
	writeMu  sync.Mutex   // one writer on stdout
	recMu    sync.Mutex   // one reconnect at a time
	resent   map[any]bool // calls the last reconnect sent again
}

func newBridge(url string, client *http.Client, local mcp.Connection) *bridge {
	return &bridge{url: url, client: client, local: local, Retry: 30 * time.Second, log: func(string, ...any) {},
		pending: map[any]*jsonrpc.Request{}, internal: map[any]bool{}}
}

func (b *bridge) toClient(ctx context.Context, m jsonrpc.Message) error {
	b.writeMu.Lock()
	defer b.writeMu.Unlock()
	return b.local.Write(ctx, m)
}

// connect opens a new upstream session (replaying initialize when the client already sent one) and starts its reader.
func (b *bridge) connect(ctx context.Context) (mcp.Connection, int, error) {
	remote, err := (&mcp.StreamableClientTransport{Endpoint: b.url, HTTPClient: b.client}).Connect(ctx)
	if err != nil {
		return nil, 0, err
	}
	b.mu.Lock()
	initReq, inited := b.initReq, b.inited
	b.gen++
	gen := b.gen
	b.remote = remote
	b.mu.Unlock()
	if initReq != nil {
		b.mu.Lock()
		b.initSeq++
		id, _ := jsonrpc.MakeID(fmt.Sprintf("projmap-bridge-init-%d", b.initSeq))
		b.internal[id.Raw()] = true
		b.mu.Unlock()
		if err := remote.Write(ctx, &jsonrpc.Request{ID: id, Method: initReq.Method, Params: initReq.Params}); err != nil {
			_ = remote.Close()
			return nil, 0, err
		}
		if inited {
			n, _ := jsonrpc.MakeID(nil)
			if err := remote.Write(ctx, &jsonrpc.Request{ID: n, Method: "notifications/initialized"}); err != nil {
				_ = remote.Close()
				return nil, 0, err
			}
		}
	}
	go b.readRemote(ctx, remote, gen)
	return remote, gen, nil
}

// reconnect replaces the session of generation gen (unless someone already did) and resends unanswered calls.
func (b *bridge) reconnect(ctx context.Context, gen int, why error) error {
	b.recMu.Lock()
	defer b.recMu.Unlock()
	b.mu.Lock()
	if b.gen != gen {
		b.mu.Unlock()
		return nil
	}
	old := b.remote
	b.remote = nil
	b.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	b.log("the server session ended (%v); reconnecting", why)
	deadline := time.Now().Add(b.Retry)
	wait := 200 * time.Millisecond
	for {
		if b.ensure != nil {
			b.ensure()
		}
		remote, _, err := b.connect(ctx)
		if err == nil {
			b.mu.Lock()
			resend := make([]*jsonrpc.Request, 0, len(b.pending))
			b.resent = map[any]bool{}
			for id, r := range b.pending {
				resend = append(resend, r)
				b.resent[id] = true
			}
			b.mu.Unlock()
			for _, r := range resend {
				if err := remote.Write(ctx, r); err != nil {
					b.log("resend %s: %v", r.Method, err)
				}
			}
			b.log("reconnected; resent %d call(s)", len(resend))
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if time.Now().After(deadline) {
			b.failPending(ctx, fmt.Errorf("the projmap server at %s does not answer: %v", b.url, err))
			return err
		}
		time.Sleep(wait)
		wait = min(2*time.Second, wait*2)
	}
}

// failPending answers every waiting call with an error (the client keeps going; the next call reconnects).
func (b *bridge) failPending(ctx context.Context, err error) {
	b.mu.Lock()
	reqs := b.pending
	b.pending = map[any]*jsonrpc.Request{}
	b.mu.Unlock()
	for _, r := range reqs {
		_ = b.toClient(ctx, &jsonrpc.Response{ID: r.ID, Error: &jsonrpc.Error{Code: jsonrpc.CodeInternalError, Message: err.Error()}})
	}
}

func (b *bridge) readRemote(ctx context.Context, remote mcp.Connection, gen int) {
	for {
		m, err := remote.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			b.mu.Lock()
			current := b.gen == gen
			b.mu.Unlock()
			if current {
				go func() { _ = b.reconnect(ctx, gen, err) }()
			}
			return
		}
		if r, ok := m.(*jsonrpc.Response); ok {
			b.mu.Lock()
			internal := b.internal[r.ID.Raw()]
			delete(b.internal, r.ID.Raw())
			delete(b.pending, r.ID.Raw())
			b.mu.Unlock()
			if internal {
				continue
			}
		}
		if err := b.toClient(ctx, m); err != nil {
			return
		}
	}
}

// send writes one client message upstream; a failed write reconnects and tries once more.
func (b *bridge) send(ctx context.Context, m jsonrpc.Message) error {
	for attempt := 0; ; attempt++ {
		b.mu.Lock()
		remote, gen := b.remote, b.gen
		b.mu.Unlock()
		if remote == nil {
			// a reconnect is under way (or failed): start one ourselves
			if err := b.reconnect(ctx, gen, errors.New("no session")); err != nil {
				return err
			}
			continue
		}
		err := remote.Write(ctx, m)
		if err == nil || attempt >= 1 {
			return err
		}
		if err := b.reconnect(ctx, gen, err); err != nil {
			return err
		}
		if r, ok := m.(*jsonrpc.Request); ok && r.IsCall() {
			b.mu.Lock()
			done := b.resent[r.ID.Raw()]
			b.mu.Unlock()
			if done {
				return nil // the reconnect sent it again with the other unanswered calls
			}
		}
	}
}

func (b *bridge) run(ctx context.Context) error {
	if _, _, err := b.connect(ctx); err != nil {
		return fmt.Errorf("connect %s: %w", b.url, err)
	}
	for {
		m, err := b.local.Read(ctx)
		if err != nil {
			return err
		}
		if r, ok := m.(*jsonrpc.Request); ok {
			b.mu.Lock()
			switch {
			case r.Method == "initialize":
				b.initReq = r
			case r.Method == "notifications/initialized":
				b.inited = true
			}
			if r.IsCall() {
				b.pending[r.ID.Raw()] = r
			}
			b.mu.Unlock()
		}
		if err := b.send(ctx, m); err != nil {
			b.log("send: %v", err)
			if r, ok := m.(*jsonrpc.Request); ok && r.IsCall() {
				b.mu.Lock()
				delete(b.pending, r.ID.Raw())
				b.mu.Unlock()
				_ = b.toClient(ctx, &jsonrpc.Response{ID: r.ID, Error: &jsonrpc.Error{Code: jsonrpc.CodeInternalError,
					Message: fmt.Sprintf("projmap server unreachable: %v", err)}})
			}
		}
	}
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
