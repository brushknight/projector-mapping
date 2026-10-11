// Package apitest drives the whole app over HTTP and WebSocket, the way the editor, the output and the phone do,
// against a fresh data folder. The section folders hold the tests; this file is the harness.
package apitest

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"projmap/internal/app"
	agentport "projmap/internal/application/ports/out/agents"
	"projmap/internal/config"
	"projmap/internal/domain/agents"
)

// H is one app on its own data folder, served on a local port.
type H struct {
	T      *testing.T
	App    *app.App
	Server *httptest.Server
	URL    string
	Runner *FakeRunner
	// DataDir is the app's data folder (Restart reopens it).
	DataDir string
}

// New starts an app (seeded with the desk setup, scene and presets).
func New(t *testing.T) *H {
	t.Helper()
	runner := &FakeRunner{}
	h := &H{T: t, Runner: runner}
	srv := httptest.NewUnstartedServer(nil)
	srv.Start()
	h.Server, h.URL = srv, srv.URL
	h.DataDir = t.TempDir()
	h.start()
	t.Cleanup(func() {
		srv.CloseClientConnections()
		srv.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		h.App.Stop(ctx)
	})
	return h
}

func (h *H) start() {
	h.T.Helper()
	cfg := config.Config{DataDir: h.DataDir, Port: 7400, Bind: "127.0.0.1", Seed: true}
	a, err := app.New(context.Background(), app.Options{Config: cfg, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Runner: h.Runner, MCPURL: h.URL + "/mcp"})
	if err != nil {
		h.T.Fatal(err)
	}
	h.App = a
	h.Server.Config.Handler = a.Handler()
}

// Restart stops the app, runs between (with the data folder, while nothing holds the database) and starts a new app
// on the same folder, like a server restart.
func (h *H) Restart(between func(dataDir string)) {
	h.T.Helper()
	h.Server.CloseClientConnections()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	h.App.Stop(ctx)
	cancel()
	if between != nil {
		between(h.DataDir)
	}
	h.start()
}

// Resp is one reply.
type Resp struct {
	Status int
	Body   []byte
	Header http.Header
}

// JSON decodes the body.
func (r *Resp) JSON(t *testing.T) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(r.Body, &v); err != nil {
		t.Fatalf("not JSON (%d): %s", r.Status, r.Body)
	}
	return v
}

// Map is the body as an object.
func (r *Resp) Map(t *testing.T) map[string]any {
	t.Helper()
	m, ok := r.JSON(t).(map[string]any)
	if !ok {
		t.Fatalf("not an object (%d): %s", r.Status, r.Body)
	}
	return m
}

// List is the body as an array.
func (r *Resp) List(t *testing.T) []any {
	t.Helper()
	l, ok := r.JSON(t).([]any)
	if !ok {
		t.Fatalf("not an array (%d): %s", r.Status, r.Body)
	}
	return l
}

// Into decodes the body into v.
func (r *Resp) Into(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decode (%d) %s: %v", r.Status, r.Body, err)
	}
}

// Do sends a request from this Mac (trusted editor). body is JSON-encoded unless it is a string or []byte.
func (h *H) Do(method, path string, body any) *Resp {
	h.T.Helper()
	return h.DoWith(method, path, body, nil)
}

// Remote sends a request as a LAN client (not trusted) with an optional token.
func (h *H) Remote(method, path string, body any, token string) *Resp {
	h.T.Helper()
	hd := map[string]string{"X-Forwarded-For": "192.168.1.20"}
	if token != "" {
		hd["Authorization"] = "Bearer " + token
	}
	return h.DoWith(method, path, body, hd)
}

// DoWith sends a request with headers.
func (h *H) DoWith(method, path string, body any, headers map[string]string) *Resp {
	h.T.Helper()
	var rd io.Reader
	ct := "application/json"
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	case []byte:
		rd = bytes.NewReader(b)
	case *Multipart:
		rd, ct = bytes.NewReader(b.body.Bytes()), b.ct
	default:
		j, _ := json.Marshal(b)
		rd = bytes.NewReader(j)
	}
	req, err := http.NewRequest(method, h.URL+path, rd)
	if err != nil {
		h.T.Fatal(err)
	}
	if rd != nil {
		req.Header.Set("Content-Type", ct)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		h.T.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return &Resp{Status: res.StatusCode, Body: b, Header: res.Header}
}

// Multipart is a file upload body.
type Multipart struct {
	body *bytes.Buffer
	ct   string
}

// File makes a multipart body with field "file" and extra fields.
func File(name string, data []byte, fields map[string]string) *Multipart {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	fw, _ := w.CreateFormFile("file", name)
	_, _ = fw.Write(data)
	_ = w.Close()
	return &Multipart{body: &buf, ct: w.FormDataContentType()}
}

// Expect fails unless the status matches.
func Expect(t *testing.T, r *Resp, status int) {
	t.Helper()
	if r.Status != status {
		t.Fatalf("status %d, want %d: %s", r.Status, status, r.Body)
	}
}

// ExpectErr fails unless the reply is the error {code, message} with that status.
func ExpectErr(t *testing.T, r *Resp, status int, code string) map[string]any {
	t.Helper()
	Expect(t, r, status)
	m := r.Map(t)
	if m["code"] != code || m["message"] == "" {
		t.Fatalf("error body %s, want code %s", r.Body, code)
	}
	return m
}

// Msg is a WebSocket message.
type Msg struct {
	T    string          `json:"t"`
	Ch   string          `json:"ch,omitempty"`
	ID   string          `json:"id,omitempty"`
	Re   string          `json:"re,omitempty"`
	V    *int64          `json:"v,omitempty"`
	Base *int64          `json:"base,omitempty"`
	D    json.RawMessage `json:"d,omitempty"`
}

// Into decodes d.
func (m Msg) Into(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(m.D, v); err != nil {
		t.Fatalf("decode %s d: %v (%s)", m.T, err, m.D)
	}
}

// WS is a WebSocket client.
type WS struct {
	t     *testing.T
	c     *websocket.Conn
	in    chan Msg
	mu    sync.Mutex
	Hello Msg
	// Handle, when set, answers rpc requests (return nil to ignore one).
	Handle func(m Msg) *Msg
}

// Dial connects with the header (nil = this Mac) and does not send hello.
func (h *H) Dial(header http.Header) *WS {
	h.T.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, strings.Replace(h.URL, "http://", "ws://", 1)+"/ws", &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		h.T.Fatal(err)
	}
	c.SetReadLimit(32 << 20)
	w := &WS{t: h.T, c: c, in: make(chan Msg, 1024)}
	go func() {
		for {
			_, b, err := c.Read(context.Background())
			if err != nil {
				close(w.in)
				return
			}
			var m Msg
			_ = json.Unmarshal(b, &m)
			w.mu.Lock()
			hd := w.Handle
			w.mu.Unlock()
			if m.T == "rpc" && hd != nil {
				if r := hd(m); r != nil {
					r.Re = m.ID
					w.Send(*r)
				}
				continue
			}
			w.in <- m
		}
	}()
	h.T.Cleanup(func() { c.CloseNow() })
	return w
}

// Connect dials from this Mac and says hello; it returns after welcome.
func (h *H) Connect(role, name string, caps ...string) *WS {
	h.T.Helper()
	w := h.Dial(nil)
	w.Send(Msg{T: "hello", D: data(map[string]any{"role": role, "name": name, "caps": caps, "build": "test"})})
	w.Hello = w.Next("welcome")
	return w
}

// OnRPC sets the rpc handler.
func (w *WS) OnRPC(f func(m Msg) *Msg) {
	w.mu.Lock()
	w.Handle = f
	w.mu.Unlock()
}

func data(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

// Data marshals v.
func Data(v any) json.RawMessage { return data(v) }

// Send writes a message.
func (w *WS) Send(m Msg) {
	b, _ := json.Marshal(m)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := w.c.Write(ctx, websocket.MessageText, b); err != nil {
		w.t.Errorf("ws write: %v", err)
	}
}

// Next waits (3 s) for the next message of type t, skipping others.
func (w *WS) Next(t string) Msg {
	w.t.Helper()
	return w.NextWhere(func(m Msg) bool { return m.T == t }, t)
}

// NextOn waits for a message of type t on channel ch.
func (w *WS) NextOn(t, ch string) Msg {
	w.t.Helper()
	return w.NextWhere(func(m Msg) bool { return m.T == t && m.Ch == ch }, t+" on "+ch)
}

// NextWhere waits for a matching message.
func (w *WS) NextWhere(ok func(Msg) bool, what string) Msg {
	w.t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case m, open := <-w.in:
			if !open {
				w.t.Fatalf("connection closed waiting for %s", what)
			}
			if ok(m) {
				return m
			}
		case <-deadline:
			w.t.Fatalf("no %s within 3 s", what)
		}
	}
}

// None asserts no matching message arrives within d.
func (w *WS) None(ok func(Msg) bool, d time.Duration, what string) {
	w.t.Helper()
	deadline := time.After(d)
	for {
		select {
		case m, open := <-w.in:
			if !open {
				return
			}
			if ok(m) {
				w.t.Fatalf("unexpected %s: %+v %s", what, m, m.D)
			}
		case <-deadline:
			return
		}
	}
}

// Sub subscribes and returns the snapshot.
func (w *WS) Sub(ch string) Msg {
	w.t.Helper()
	w.Send(Msg{T: "sub", Ch: ch, ID: "sub-" + ch})
	return w.NextOn("snapshot", ch)
}

// FakeRunner stands in for codex and claude.
type FakeRunner struct {
	Missing string
	// Block keeps Run going until the context ends.
	Block bool
	mu    sync.Mutex
	Specs []agentport.Spec
}

func (f *FakeRunner) Available(agent string) string {
	if agent == f.Missing {
		return agent + " is not installed on this Mac."
	}
	return ""
}

func (f *FakeRunner) Run(ctx context.Context, spec agentport.Spec, emit func(agents.Event)) error {
	f.mu.Lock()
	f.Specs = append(f.Specs, spec)
	f.mu.Unlock()
	ok := true
	emit(agents.Event{Kind: agents.KindMessage, Text: "looking at the scene"})
	emit(agents.Event{Kind: agents.KindTool, Tool: "scene_get", Text: "", DurationMs: 12, OK: &ok})
	if f.Block {
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}

// Both waits for two messages that may arrive in either order (ordered replies and coalesced snapshots travel
// separately).
func (w *WS) Both(a, b func(Msg) bool, what string) (Msg, Msg) {
	w.t.Helper()
	var ma, mb *Msg
	for ma == nil || mb == nil {
		m := w.NextWhere(func(m Msg) bool { return (ma == nil && a(m)) || (mb == nil && b(m)) }, what)
		if ma == nil && a(m) {
			ma = &m
		} else {
			mb = &m
		}
	}
	return *ma, *mb
}

// Is matches a message type, and a channel when ch is not empty.
func Is(t, ch string) func(Msg) bool {
	return func(m Msg) bool { return m.T == t && (ch == "" || m.Ch == ch) }
}
