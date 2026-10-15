// Package hub is the WebSocket hub at /ws (protocol §3): hello/welcome, clock pings, channels with snapshots,
// params, patches and commands, server → client RPC, telemetry and the phone's camera preview. Each connection has a
// bounded send queue; continuous messages (params, camera frames, snapshot-only channels) are coalesced to the newest,
// and a connection whose queue overflows is resynced with fresh snapshots instead of growing a backlog.
package hub

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"projmap/internal/application/app_errors"
	cameraport "projmap/internal/application/ports/out/camera"
	"projmap/internal/application/ports/out/realtime"
	"projmap/internal/application/services"
	agentssvc "projmap/internal/application/services/agents"
	camerasvc "projmap/internal/application/services/camera"
	devicessvc "projmap/internal/application/services/devices"
	scenessvc "projmap/internal/application/services/scenes"
	setupssvc "projmap/internal/application/services/setups"
	showsvc "projmap/internal/application/services/show"
	soundssvc "projmap/internal/application/services/sounds"
	videossvc "projmap/internal/application/services/videos"
	"projmap/internal/domain/camera"
	"projmap/internal/domain/devices"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
)

// Services are what the hub calls.
type Services struct {
	Devices      devicessvc.DeviceService
	Scenes       scenessvc.SceneService
	Drafts       scenessvc.DraftService
	Presets      scenessvc.PresetService
	Setups       setupssvc.SetupService
	Show         showsvc.ShowService
	Agents       agentssvc.AgentService
	Calibrations camerasvc.CalibrationService
	Camera       camerasvc.CameraService
	Sounds       soundssvc.SoundService
	Videos       videossvc.VideoService
	// CatalogVersion goes in welcome.
	CatalogVersion int
}

// QueueSize is a connection's ordered send queue.
const QueueSize = 256

// Hub keeps every connection.
type Hub struct {
	svc Services
	log *slog.Logger

	mu    sync.RWMutex
	conns map[string]*conn
	subs  map[string]map[*conn]bool

	rpcMu   sync.Mutex
	rpcs    map[string]*pendingRPC
	rpcSeq  atomic.Int64
	connSeq atomic.Int64

	camMu     sync.RWMutex
	camFrame  *cameraport.Frame
	camFrameM []byte // the frame message as relayed
	camStat   *camera.Status
	camStatAt time.Time
	camStatM  []byte
	camDevice string
	camTimes  []time.Time // arrival times of the last preview frames

	telMu     sync.RWMutex
	telemetry map[string]*devices.Telemetry

	draftMu     sync.Mutex
	draftParams map[string]*services.Coalescer
}

type pendingRPC struct {
	ch   chan rpcReply
	conn string
}

type rpcReply struct {
	ok   bool
	data json.RawMessage
}

// New makes a hub; call SetServices before serving.
func New(log *slog.Logger) *Hub {
	return &Hub{log: log, conns: map[string]*conn{}, subs: map[string]map[*conn]bool{}, rpcs: map[string]*pendingRPC{},
		telemetry: map[string]*devices.Telemetry{}, draftParams: map[string]*services.Coalescer{}}
}

// SetServices connects the services (they are built with the hub as their publisher).
func (h *Hub) SetServices(s Services) { h.svc = s }

var (
	_ realtime.Publisher = (*Hub)(nil)
	_ realtime.Caller    = (*Hub)(nil)
	_ realtime.Presence  = (*Hub)(nil)
	_ realtime.Direct    = (*Hub)(nil)
	_ cameraport.Feed    = (*Hub)(nil)
)

// conn is one WebSocket client.
type conn struct {
	id          string
	ws          *websocket.Conn
	dev         *devices.Device
	role        devices.Role
	caps        map[string]bool
	local       bool
	connectedAt time.Time

	out    chan []byte
	wake   chan struct{}
	mu     sync.Mutex
	latest map[string][]byte
	order  []string
	subs   map[string]bool
	resync atomic.Bool
	cancel context.CancelFunc
}

// IsLocal tells whether the request comes from this machine (and not through a proxy).
func IsLocal(r *http.Request) bool {
	if r.Header.Get("X-Forwarded-For") != "" {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// ServeHTTP upgrades /ws.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	ws.SetReadLimit(8 << 20) // camera frames are base64 JPEGs
	ctx, cancel := context.WithCancel(context.Background())
	c := &conn{id: fmt.Sprintf("c%d", h.connSeq.Add(1)), ws: ws, local: IsLocal(r), connectedAt: time.Now(),
		out: make(chan []byte, QueueSize), wake: make(chan struct{}, 1), latest: map[string][]byte{}, subs: map[string]bool{},
		caps: map[string]bool{}, cancel: cancel}
	go h.writer(ctx, c)
	h.reader(ctx, c, r.URL.Query().Get("token"))
	cancel()
	h.drop(c)
	_ = ws.Close(websocket.StatusNormalClosure, "")
}

func (h *Hub) writer(ctx context.Context, c *conn) {
	write := func(b []byte) bool {
		wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err := c.ws.Write(wctx, websocket.MessageText, b); err != nil {
			c.cancel()
			return false
		}
		return true
	}
	for {
		if c.resync.Swap(false) {
			h.resyncConn(ctx, c, write)
		}
		select {
		case <-ctx.Done():
			return
		case b := <-c.out:
			if !write(b) {
				return
			}
		case <-c.wake:
			for {
				c.mu.Lock()
				if len(c.order) == 0 {
					c.mu.Unlock()
					break
				}
				k := c.order[0]
				c.order = c.order[1:]
				b := c.latest[k]
				delete(c.latest, k)
				c.mu.Unlock()
				if !write(b) {
					return
				}
			}
		}
	}
}

// resyncConn drops the backlog and sends fresh snapshots of every subscribed channel.
func (h *Hub) resyncConn(ctx context.Context, c *conn, write func([]byte) bool) {
	for {
		select {
		case <-c.out:
			continue
		default:
		}
		break
	}
	c.mu.Lock()
	c.latest, c.order = map[string][]byte{}, nil
	chs := make([]string, 0, len(c.subs))
	for ch := range c.subs {
		chs = append(chs, ch)
	}
	c.mu.Unlock()
	for _, ch := range chs {
		if m, err := h.snapshot(ctx, ch); err == nil && m != nil {
			b, _ := json.Marshal(m)
			if !write(b) {
				return
			}
		}
	}
}

// coalesceKey is the key under which only the newest message is kept ("" = ordered).
func coalesceKey(m *realtime.Message) string {
	switch m.T {
	case "param":
		var p struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(m.D, &p)
		return "param|" + m.Ch + "|" + p.Path
	case "camera.frame", "camera.status":
		return m.T
	case "snapshot":
		if m.Ch == "show" || m.Ch == "devices" || m.Ch == "presets" || m.Ch == "scenes" || m.Ch == "sounds" || m.Ch == "videos" ||
			strings.HasPrefix(m.Ch, "draft:") || strings.HasPrefix(m.Ch, "calib:") || strings.HasPrefix(m.Ch, "import:") {
			return "snapshot|" + m.Ch
		}
	}
	return ""
}

// send queues b; key != "" keeps only the newest per key.
func (c *conn) send(b []byte, key string) {
	if key != "" {
		c.mu.Lock()
		if _, ok := c.latest[key]; !ok {
			c.order = append(c.order, key)
		}
		c.latest[key] = b
		c.mu.Unlock()
		select {
		case c.wake <- struct{}{}:
		default:
		}
		return
	}
	select {
	case c.out <- b:
	default:
		c.resync.Store(true) // the client is too slow: drop the backlog, resend snapshots
		select {
		case c.wake <- struct{}{}:
		default:
		}
	}
}

func (h *Hub) sendTo(c *conn, m realtime.Message) {
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	c.send(b, coalesceKey(&m))
}

// Publish implements realtime.Publisher.
func (h *Hub) Publish(ch string, m realtime.Message) { h.PublishExcept(ch, m, "") }

// PublishExcept implements realtime.Publisher.
func (h *Hub) PublishExcept(ch string, m realtime.Message, except string) {
	if m.Ch == "" {
		m.Ch = ch
	}
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	key := coalesceKey(&m)
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.subs[ch] {
		if c.id != except {
			c.send(b, key)
		}
	}
}

func (h *Hub) drop(c *conn) {
	h.mu.Lock()
	delete(h.conns, c.id)
	for ch := range c.subs {
		if s := h.subs[ch]; s != nil {
			delete(s, c)
			if len(s) == 0 {
				delete(h.subs, ch)
			}
		}
	}
	h.mu.Unlock()
	h.rpcMu.Lock()
	for id, p := range h.rpcs {
		if p.conn == c.id {
			p.ch <- rpcReply{ok: false, data: realtime.Data(map[string]string{"code": "disconnected", "message": "The client disconnected."})}
			delete(h.rpcs, id)
		}
	}
	h.rpcMu.Unlock()
	if c.dev != nil {
		h.camMu.Lock()
		if h.camDevice == c.dev.ID && !h.online(c.dev.ID) {
			h.camDevice, h.camStat = "", nil
		}
		h.camMu.Unlock()
		if h.svc.Devices != nil {
			ctx := context.Background()
			h.svc.Devices.Touch(ctx, c.dev.ID)
			h.svc.Devices.Broadcast(ctx)
		}
	}
}

func (h *Hub) reader(ctx context.Context, c *conn, queryToken string) {
	for {
		typ, b, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		var m realtime.Message
		if err := json.Unmarshal(b, &m); err != nil {
			h.sendTo(c, errMsg("", app_errors.BadRequest("Send one JSON object per frame.")))
			continue
		}
		if c.dev == nil {
			if m.T != "hello" {
				h.sendTo(c, errMsg(m.ID, app_errors.Unauthorized("Send hello first.")))
				continue
			}
			if err := h.hello(ctx, c, m, queryToken); err != nil {
				h.sendTo(c, errMsg(m.ID, err))
				time.Sleep(100 * time.Millisecond)
				return
			}
			continue
		}
		h.handle(ctx, c, m)
	}
}

func errMsg(re string, err error) realtime.Message {
	e := app_errors.As(err)
	return realtime.Message{T: "error", Re: re, D: realtime.Data(map[string]string{"code": e.Code, "message": e.Message})}
}

// Hello is the client's first message.
type Hello struct {
	Token string   `json:"token,omitempty"`
	Role  string   `json:"role"`
	Name  string   `json:"name"`
	Caps  []string `json:"caps"`
	Build string   `json:"build"`
}

// Welcome is the server's answer.
type Welcome struct {
	Device         devices.Device `json:"device"`
	ServerTime     int64          `json:"serverTime"`
	Show           any            `json:"show"`
	CatalogVersion int            `json:"catalogVersion"`
}

func (h *Hub) hello(ctx context.Context, c *conn, m realtime.Message, queryToken string) error {
	var hi Hello
	if err := json.Unmarshal(m.D, &hi); err != nil {
		return app_errors.BadRequest("hello needs {role, name, caps}.")
	}
	if hi.Token == "" {
		hi.Token = queryToken
	}
	var dev *devices.Device
	var err error
	role := devices.Role(hi.Role)
	switch {
	case hi.Token != "":
		dev, err = h.svc.Devices.Authenticate(ctx, hi.Token)
		if err != nil {
			return err
		}
		role = dev.Role
		// an editor token may connect as any role (the editor opens /out on a second display)
		if dev.Role == devices.RoleEditor && devices.Role(hi.Role).IsValid() && hi.Role != string(devices.RoleAgent) {
			role = devices.Role(hi.Role)
		}
	case c.local:
		if !role.IsValid() {
			role = devices.RoleEditor
		}
		dev, err = h.svc.Devices.Local(ctx, hi.Name, role)
		if err != nil {
			return err
		}
	default:
		return app_errors.Unauthorized("Pair this device first: POST /api/v1/pair with the code on the projector.")
	}
	c.dev, c.role = dev, role
	for _, cp := range hi.Caps {
		c.caps[cp] = true
	}
	h.mu.Lock()
	h.conns[c.id] = c
	h.mu.Unlock()
	h.svc.Devices.Touch(ctx, dev.ID)
	d, _ := h.svc.Devices.Get(ctx, dev.ID)
	if d == nil {
		d = dev
	}
	d.Online = true
	h.sendTo(c, realtime.Message{T: "welcome", Re: m.ID, D: realtime.Data(Welcome{Device: *d, ServerTime: time.Now().UnixNano(),
		Show: h.svc.Show.Get(ctx), CatalogVersion: h.svc.CatalogVersion})})
	h.svc.Devices.Broadcast(ctx)
	return nil
}

func (h *Hub) handle(ctx context.Context, c *conn, m realtime.Message) {
	switch m.T {
	case "ping":
		var p struct {
			T0 json.Number `json:"t0"`
		}
		_ = json.Unmarshal(m.D, &p)
		h.sendTo(c, realtime.Message{T: "pong", Re: m.ID, D: realtime.Data(map[string]any{"t0": p.T0, "ts": time.Now().UnixNano()})})
	case "sub":
		h.subscribe(ctx, c, m)
	case "unsub":
		h.mu.Lock()
		c.mu.Lock()
		delete(c.subs, m.Ch)
		c.mu.Unlock()
		if s := h.subs[m.Ch]; s != nil {
			delete(s, c)
		}
		h.mu.Unlock()
		if m.ID != "" {
			h.sendTo(c, realtime.Message{T: "ack", Re: m.ID})
		}
	case "param":
		h.param(ctx, c, m)
	case "patch":
		h.patch(ctx, c, m)
	case "cmd":
		h.command(ctx, c, m)
	case "rpc.result", "rpc.error":
		h.rpcMu.Lock()
		p, ok := h.rpcs[m.Re]
		if ok {
			delete(h.rpcs, m.Re)
		}
		h.rpcMu.Unlock()
		if ok {
			p.ch <- rpcReply{ok: m.T == "rpc.result", data: m.D}
		}
	case "telemetry":
		var t devices.Telemetry
		if json.Unmarshal(m.D, &t) == nil {
			h.telMu.Lock()
			h.telemetry[c.dev.ID] = &t
			h.telMu.Unlock()
			h.svc.Devices.Broadcast(ctx)
		}
	case "camera.frame", "camera.status":
		h.camera(c, m)
	default:
		h.sendTo(c, errMsg(m.ID, app_errors.BadRequest("Message type %q is unknown.", m.T)))
	}
}

// canSee tells whether a role may subscribe to a channel.
func canSee(role devices.Role, ch string) bool {
	if role == devices.RoleAgent {
		return false
	}
	if role == devices.RoleOutput {
		return ch == "show" || strings.HasPrefix(ch, "scene:") || strings.HasPrefix(ch, "setup:") || strings.HasPrefix(ch, "draft:") || ch == "presets"
	}
	return true
}

func (h *Hub) subscribe(ctx context.Context, c *conn, m realtime.Message) {
	if m.Ch == "" {
		h.sendTo(c, errMsg(m.ID, app_errors.BadRequest("sub needs ch.")))
		return
	}
	if !canSee(c.role, m.Ch) {
		h.sendTo(c, errMsg(m.ID, app_errors.Forbidden("Role %s cannot subscribe to %s.", c.role, m.Ch)))
		return
	}
	snap, err := h.snapshot(ctx, m.Ch)
	if err != nil {
		h.sendTo(c, errMsg(m.ID, err))
		return
	}
	h.mu.Lock()
	c.mu.Lock()
	c.subs[m.Ch] = true
	c.mu.Unlock()
	if h.subs[m.Ch] == nil {
		h.subs[m.Ch] = map[*conn]bool{}
	}
	h.subs[m.Ch][c] = true
	h.mu.Unlock()
	if snap != nil {
		snap.Re = m.ID
		h.sendTo(c, *snap)
	}
	if m.Ch == "camera" {
		h.camMu.RLock()
		st, fr := h.camStatM, h.camFrameM
		h.camMu.RUnlock()
		if st != nil {
			c.send(st, "camera.status")
		}
		if fr != nil {
			c.send(fr, "camera.frame")
		}
	}
}

// snapshot is the full content of a channel.
func (h *Hub) snapshot(ctx context.Context, ch string) (*realtime.Message, error) {
	kind, id, _ := strings.Cut(ch, ":")
	snap := func(v int64, d any) *realtime.Message {
		return &realtime.Message{T: "snapshot", Ch: ch, V: realtime.Ver(v), D: realtime.Data(d)}
	}
	now := time.Now().UnixMilli()
	switch kind {
	case "show":
		s := h.svc.Show.Get(ctx)
		return snap(s.Version, s), nil
	case "scene":
		doc, v, err := h.svc.Scenes.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		return &realtime.Message{T: "snapshot", Ch: ch, V: realtime.Ver(v), D: doc}, nil
	case "setup":
		s, v, err := h.svc.Setups.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		return snap(v, s), nil
	case "presets":
		l, err := h.svc.Presets.List(ctx)
		if err != nil {
			return nil, err
		}
		return snap(now, l), nil
	case "devices":
		l, err := h.svc.Devices.List(ctx)
		if err != nil {
			return nil, err
		}
		return snap(now, l), nil
	case "draft":
		d, err := h.svc.Drafts.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		return snap(int64(len(d.Ops)), d), nil
	case "agent":
		s, err := h.svc.Agents.Snapshot(ctx, id)
		if err != nil {
			return nil, err
		}
		return snap(int64(len(s.Events)), s), nil
	case "calib":
		p, err := h.svc.Calibrations.Progress(ctx, id)
		if err != nil {
			return nil, err
		}
		return snap(int64(p.Done), p), nil
	case "scenes":
		l, err := h.svc.Scenes.List(ctx)
		if err != nil {
			return nil, err
		}
		if l == nil {
			l = []scene.Summary{}
		}
		return snap(now, l), nil
	case "sounds":
		if h.svc.Sounds == nil {
			break
		}
		l, err := h.svc.Sounds.List(ctx)
		if err != nil {
			return nil, err
		}
		return snap(now, l), nil
	case "videos":
		if h.svc.Videos == nil {
			break
		}
		l, err := h.svc.Videos.List(ctx)
		if err != nil {
			return nil, err
		}
		return snap(now, l), nil
	case "import":
		if h.svc.Videos == nil {
			break
		}
		j, seq, err := h.svc.Videos.Job(id)
		if err != nil {
			return nil, err
		}
		return snap(seq, j), nil
	case "camera":
		return nil, nil
	}
	return nil, app_errors.NotFound("Channel %s does not exist.", ch)
}

func (h *Hub) param(ctx context.Context, c *conn, m realtime.Message) {
	if !c.role.CanControl() {
		h.sendTo(c, errMsg(m.ID, app_errors.Forbidden("Role %s cannot change scenes.", c.role)))
		return
	}
	var p struct {
		Path  string          `json:"path"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(m.D, &p); err != nil || p.Path == "" {
		h.sendTo(c, errMsg(m.ID, app_errors.BadRequest("param needs {path, value}.")))
		return
	}
	kind, id, _ := strings.Cut(m.Ch, ":")
	var err error
	switch kind {
	case "scene":
		err = h.svc.Scenes.Param(ctx, scenessvc.ParamCmd{SceneID: id, Path: p.Path, Value: p.Value, By: c.dev.ID, Conn: c.id})
	case "setup":
		err = h.svc.Setups.Param(ctx, id, p.Path, p.Value, c.dev.ID, c.id)
	case "draft":
		err = h.draftParam(ctx, c, id, p.Path, p.Value)
	default:
		err = app_errors.BadRequest("param goes on a scene, setup or draft channel.")
	}
	if err != nil {
		h.sendTo(c, errMsg(m.ID, err))
	}
}

func (h *Hub) patch(ctx context.Context, c *conn, m realtime.Message) {
	if !c.role.CanControl() {
		h.sendTo(c, errMsg(m.ID, app_errors.Forbidden("Role %s cannot change scenes.", c.role)))
		return
	}
	var ops []docpatch.Op
	if err := json.Unmarshal(m.D, &ops); err != nil {
		h.sendTo(c, errMsg(m.ID, app_errors.BadRequest("patch d must be a JSON Patch array.")))
		return
	}
	var base int64
	if m.Base != nil {
		base = *m.Base
	}
	kind, id, _ := strings.Cut(m.Ch, ":")
	var err error
	switch kind {
	case "scene":
		_, err = h.svc.Scenes.Patch(ctx, scenessvc.PatchCmd{SceneID: id, Base: base, Ops: ops, By: c.dev.ID, Re: m.ID})
	case "setup":
		_, err = h.svc.Setups.Patch(ctx, id, base, ops, c.dev.ID, m.ID)
	case "draft":
		if _, err = h.svc.Drafts.AddOps(ctx, id, ops); err == nil {
			h.sendTo(c, realtime.Message{T: "ack", Ch: m.Ch, Re: m.ID})
		}
	default:
		err = app_errors.BadRequest("patch goes on a scene, setup or draft channel.")
	}
	if err == nil {
		return
	}
	if e := app_errors.As(err); e.Code == "stale" {
		h.sendTo(c, realtime.Message{T: "reject", Ch: m.Ch, Re: m.ID, V: realtime.Ver(e.Version),
			D: realtime.Data(map[string]string{"code": "stale", "message": e.Message})})
		return
	}
	h.sendTo(c, errMsg(m.ID, err))
}

func (h *Hub) command(ctx context.Context, c *conn, m realtime.Message) {
	var cmd struct {
		Name string          `json:"name"`
		Args json.RawMessage `json:"args"`
	}
	if err := json.Unmarshal(m.D, &cmd); err != nil || cmd.Name == "" {
		h.sendTo(c, errMsg(m.ID, app_errors.BadRequest("cmd needs {name, args}.")))
		return
	}
	if !c.role.CanControl() {
		h.sendTo(c, errMsg(m.ID, app_errors.Forbidden("Role %s cannot send commands.", c.role)))
		return
	}
	var err error
	switch {
	case strings.HasPrefix(cmd.Name, "show."):
		_, err = h.svc.Show.Do(ctx, strings.TrimPrefix(cmd.Name, "show."), cmd.Args, c.dev.ID)
	case cmd.Name == "setup.testPattern":
		var a struct {
			SetupID string `json:"setupId"`
			Pattern string `json:"pattern"`
			Seconds int    `json:"seconds"`
		}
		_ = json.Unmarshal(cmd.Args, &a)
		if a.SetupID == "" {
			a.SetupID = h.svc.Show.Get(ctx).ActiveSetupID
		}
		_, err = h.svc.Setups.SetTestPattern(ctx, a.SetupID, a.Pattern, a.Seconds, c.dev.ID)
	case cmd.Name == "scene.mode":
		var a struct {
			SceneID string `json:"sceneId"`
			Mode    string `json:"mode"`
		}
		_ = json.Unmarshal(cmd.Args, &a)
		if a.SceneID == "" {
			a.SceneID = h.svc.Show.Get(ctx).ActiveSceneID
		}
		if a.SceneID == "" {
			err = app_errors.NoScene("No active scene.")
			break
		}
		_, err = h.svc.Scenes.Patch(ctx, scenessvc.PatchCmd{SceneID: a.SceneID, Ops: []docpatch.Op{docpatch.Replace("/mode", a.Mode)}, By: c.dev.ID})
	case cmd.Name == "sound.play" || cmd.Name == "sound.stop":
		var ack showsvc.SoundAck
		if cmd.Name == "sound.play" {
			var a showsvc.PlayIn
			if len(cmd.Args) > 0 && string(cmd.Args) != "null" {
				if err := json.Unmarshal(cmd.Args, &a); err != nil {
					h.sendTo(c, errMsg(m.ID, app_errors.BadRequest("sound.play needs {padId | soundId, volume?, sceneId?}.")))
					return
				}
			}
			ack, err = h.svc.Show.PlaySound(ctx, a)
		} else {
			var a showsvc.StopIn
			if len(cmd.Args) > 0 && string(cmd.Args) != "null" {
				_ = json.Unmarshal(cmd.Args, &a)
			}
			ack, err = h.svc.Show.StopSound(ctx, a)
		}
		if err != nil {
			h.sendTo(c, errMsg(m.ID, err))
			return
		}
		h.sendTo(c, realtime.Message{T: "ack", Re: m.ID, D: realtime.Data(ack)})
		return
	case cmd.Name == "calibration.aim":
		var a struct {
			On        bool         `json:"on"`
			CameraROI *camera.Rect `json:"cameraRoi"`
		}
		_ = json.Unmarshal(cmd.Args, &a)
		if h.svc.Calibrations == nil {
			err = app_errors.Unavailable("Calibration is not available.")
			break
		}
		// the output answers after 3 frames; don't hold the reader
		go func() {
			if err := h.svc.Calibrations.Aim(context.Background(), a.On, a.CameraROI); err != nil {
				h.sendTo(c, errMsg(m.ID, err))
				return
			}
			h.sendTo(c, realtime.Message{T: "ack", Re: m.ID, D: realtime.Data(map[string]bool{"on": a.On})})
		}()
		return
	case cmd.Name == "output.outline":
		// The editor keeps the faces' outlines on the wall while mapping: forward {surfaceIds, color, width, ms} to the
		// projector output as the output.outline RPC (the same one alignment checks use). Renewed by the editor.
		if !h.Has(realtime.Target{Role: "output"}) {
			h.sendTo(c, realtime.Message{T: "error", Re: m.ID, D: realtime.Data(map[string]string{"code": "no_output",
				"message": "No projector output is connected. Open /out on the projector."})})
			return
		}
		var args map[string]any
		_ = json.Unmarshal(cmd.Args, &args)
		go func() {
			cctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			if _, err := h.Call(cctx, realtime.Target{Role: "output"}, "output.outline", args); err != nil {
				h.sendTo(c, errMsg(m.ID, err))
				return
			}
			h.sendTo(c, realtime.Message{T: "ack", Re: m.ID})
		}()
		return
	case cmd.Name == "camera.capture":
		if h.svc.Camera == nil || !h.Has(realtime.Target{Cap: "camera"}) {
			h.sendTo(c, realtime.Message{T: "error", Re: m.ID, D: realtime.Data(map[string]string{"code": "no_phone",
				"message": "No phone with a camera is connected. Open projmap on the phone."})})
			return
		}
		go func() {
			a, err := h.svc.Camera.Capture(context.Background(), "photo")
			if err != nil {
				h.sendTo(c, errMsg(m.ID, err))
				return
			}
			h.sendTo(c, realtime.Message{T: "ack", Re: m.ID, D: realtime.Data(map[string]string{"sha": a.SHA})})
		}()
		return
	default:
		err = app_errors.NotFound("Command %s does not exist.", cmd.Name)
	}
	if err != nil {
		h.sendTo(c, errMsg(m.ID, err))
		return
	}
	h.sendTo(c, realtime.Message{T: "ack", Re: m.ID})
}

// draftParam forwards a continuous value on a draft channel and appends it to the draft once it settles.
func (h *Hub) draftParam(ctx context.Context, c *conn, id, path string, value json.RawMessage) error {
	if _, err := h.svc.Drafts.Get(ctx, id); err != nil {
		return err
	}
	ch := "draft:" + id
	h.PublishExcept(ch, realtime.Message{T: "param", Ch: ch, D: realtime.Data(map[string]any{"path": path, "value": value, "by": c.dev.ID})}, c.id)
	h.draftMu.Lock()
	co, ok := h.draftParams[id]
	if !ok {
		co = services.NewCoalescer(services.ParamDelay, func(p string, v json.RawMessage, _ string) {
			if _, err := h.svc.Drafts.AddOps(context.Background(), id, []docpatch.Op{{Op: "replace", Path: p, Value: v}}); err != nil {
				h.log.Warn("draft param commit failed", "draft", id, "path", p, "err", err)
			}
		})
		h.draftParams[id] = co
	}
	h.draftMu.Unlock()
	co.Put(path, value, c.dev.ID)
	return nil
}

func (h *Hub) camera(c *conn, m realtime.Message) {
	if !c.role.CanControl() {
		return
	}
	m.Ch = "camera"
	b, _ := json.Marshal(m)
	h.camMu.Lock()
	h.camDevice = c.dev.ID
	if m.T == "camera.frame" {
		var f struct {
			Seq    int64  `json:"seq"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
			JPEG   string `json:"jpeg"`
		}
		if json.Unmarshal(m.D, &f) == nil {
			if raw, err := base64.StdEncoding.DecodeString(f.JPEG); err == nil {
				now := time.Now()
				h.camFrame = &cameraport.Frame{Seq: f.Seq, Width: f.Width, Height: f.Height, JPEG: raw, At: now}
				h.camFrameM = b
				h.camTimes = append(h.camTimes, now)
				if len(h.camTimes) > 64 {
					h.camTimes = append(h.camTimes[:0], h.camTimes[len(h.camTimes)-64:]...)
				}
			} else {
				h.log.Warn("camera frame is not base64", "err", err)
			}
		} else {
			h.log.Warn("camera frame is malformed")
		}
	} else {
		var st camera.Status
		if err := json.Unmarshal(m.D, &st); err == nil {
			h.camStat, h.camStatAt, h.camStatM = &st, time.Now(), b
		} else {
			h.log.Warn("camera status is malformed", "err", err)
		}
	}
	h.camMu.Unlock()
	h.mu.RLock()
	for s := range h.subs["camera"] {
		if s != c {
			s.send(b, m.T)
		}
	}
	h.mu.RUnlock()
}

// Call implements realtime.Caller.
func (h *Hub) Call(ctx context.Context, to realtime.Target, method string, args any) (json.RawMessage, error) {
	c := h.pick(to)
	if c == nil {
		return nil, app_errors.Unavailable("No connected client can answer %s (%s).", method, describe(to))
	}
	id := fmt.Sprintf("r-%d", h.rpcSeq.Add(1))
	p := &pendingRPC{ch: make(chan rpcReply, 1), conn: c.id}
	h.rpcMu.Lock()
	h.rpcs[id] = p
	h.rpcMu.Unlock()
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
	}
	h.sendTo(c, realtime.Message{T: "rpc", ID: id, D: realtime.Data(map[string]any{"method": method, "args": args})})
	select {
	case r := <-p.ch:
		if !r.ok {
			var e struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			_ = json.Unmarshal(r.data, &e)
			if e.Message == "" {
				e.Message = string(r.data)
			}
			return nil, app_errors.Unavailable("%s failed on %s: %s", method, c.dev.Name, e.Message)
		}
		return r.data, nil
	case <-ctx.Done():
		h.rpcMu.Lock()
		delete(h.rpcs, id)
		h.rpcMu.Unlock()
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, app_errors.Timeout("%s on %s did not answer in time.", method, c.dev.Name)
		}
		return nil, ctx.Err()
	}
}

func describe(t realtime.Target) string {
	var parts []string
	if t.Role != "" {
		parts = append(parts, "role "+t.Role)
	}
	if t.Cap != "" {
		parts = append(parts, "cap "+t.Cap)
	}
	if t.DeviceID != "" {
		parts = append(parts, "device "+t.DeviceID)
	}
	return strings.Join(parts, ", ")
}

// pick returns the newest connection matching the target.
func (h *Hub) pick(t realtime.Target) *conn {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var best *conn
	for _, c := range h.conns {
		if t.Role != "" && string(c.role) != t.Role {
			continue
		}
		if t.Cap != "" && !c.caps[t.Cap] {
			continue
		}
		if t.DeviceID != "" && c.dev.ID != t.DeviceID {
			continue
		}
		if best == nil || c.connectedAt.After(best.connectedAt) {
			best = c
		}
	}
	return best
}

// SendDirect implements realtime.Direct.
func (h *Hub) SendDirect(t realtime.Target, m realtime.Message) int {
	b, err := json.Marshal(m)
	if err != nil {
		return 0
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, c := range h.conns {
		if (t.Role != "" && string(c.role) != t.Role) || (t.Cap != "" && !c.caps[t.Cap]) {
			continue
		}
		c.send(b, "")
		n++
	}
	return n
}

// Has implements realtime.Caller.
func (h *Hub) Has(t realtime.Target) bool { return h.pick(t) != nil }

func (h *Hub) online(id string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.conns {
		if c.dev != nil && c.dev.ID == id {
			return true
		}
	}
	return false
}

// Online implements realtime.Presence.
func (h *Hub) Online(id string) bool { return h.online(id) }

// Telemetry implements realtime.Presence.
func (h *Hub) Telemetry(id string) any {
	if !h.online(id) {
		return nil
	}
	h.telMu.RLock()
	defer h.telMu.RUnlock()
	if t, ok := h.telemetry[id]; ok {
		return t
	}
	return nil
}

// Kick implements realtime.Presence.
func (h *Hub) Kick(id string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.conns {
		if c.dev != nil && c.dev.ID == id {
			c.cancel()
		}
	}
}

// LatestFrame implements camera.Feed.
func (h *Hub) LatestFrame() (cameraport.Frame, bool) {
	h.camMu.RLock()
	defer h.camMu.RUnlock()
	if h.camFrame == nil {
		return cameraport.Frame{}, false
	}
	return *h.camFrame, true
}

// Status implements camera.Feed.
func (h *Hub) Status() (camera.Status, time.Time, bool) {
	h.camMu.RLock()
	defer h.camMu.RUnlock()
	if h.camStat == nil {
		return camera.Status{}, time.Time{}, false
	}
	return *h.camStat, h.camStatAt, true
}

// FrameRate implements camera.Feed: frames received in the last 2 s, per second.
func (h *Hub) FrameRate() float64 {
	h.camMu.RLock()
	defer h.camMu.RUnlock()
	cut := time.Now().Add(-2 * time.Second)
	n := 0
	var first time.Time
	for _, t := range h.camTimes {
		if t.After(cut) {
			if n == 0 {
				first = t
			}
			n++
		}
	}
	if n < 2 {
		return 0
	}
	span := time.Since(first).Seconds()
	if span < 0.5 {
		span = 0.5
	}
	return float64(n-1) / span
}

// ProjectorOutput implements camera.Feed.
func (h *Hub) ProjectorOutput() (cameraport.Output, bool) {
	c := h.pick(realtime.Target{Role: string(devices.RoleOutput)})
	if c == nil {
		return cameraport.Output{}, false
	}
	o := cameraport.Output{DeviceID: c.dev.ID, Name: c.dev.Name}
	h.telMu.RLock()
	if t, ok := h.telemetry[c.dev.ID]; ok && t != nil {
		o.Width, o.Height, o.FPS = t.Width, t.Height, t.FPS
	}
	h.telMu.RUnlock()
	return o, true
}

// CameraDevice implements camera.Feed.
func (h *Hub) CameraDevice() string {
	h.camMu.RLock()
	defer h.camMu.RUnlock()
	return h.camDevice
}

// Close ends every connection.
func (h *Hub) Close() {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.conns {
		c.cancel()
	}
}
