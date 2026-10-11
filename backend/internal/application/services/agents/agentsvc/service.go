// Package agentsvc implements the agents section: sessions, one draft each, a scoped agent token, the runner's
// events on agent:{id}, and the agent permission toggles.
package agentsvc

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	jsonpatch "github.com/evanphx/json-patch/v5"

	"projmap/internal/application/app_errors"
	agentport "projmap/internal/application/ports/out/agents"
	"projmap/internal/application/ports/out/realtime"
	agentrepo "projmap/internal/application/ports/repository/agents"
	showrepo "projmap/internal/application/ports/repository/show"
	"projmap/internal/application/services"
	agentssvc "projmap/internal/application/services/agents"
	devicessvc "projmap/internal/application/services/devices"
	scenessvc "projmap/internal/application/services/scenes"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/domain/agents"
)

// Channel is a session's channel.
func Channel(id string) string { return "agent:" + id }

const settingsKey = "settings"

// Config is where the runner points agents.
type Config struct {
	// MCPURL is this server's /mcp, as an agent on this Mac reaches it.
	MCPURL string
	// Self is this binary (codex attaches through `projmap mcp`).
	Self string
	// WorkDir is where agents run.
	WorkDir string
}

// Service implements AgentService.
type Service struct {
	repo    agentrepo.SessionRepository
	drafts  scenessvc.DraftService
	devices devicessvc.DeviceService
	show    showsvc.ShowService
	runner  agentport.Runner
	kv      showrepo.KV
	pub     realtime.Publisher
	log     *slog.Logger
	cfg     Config

	mu      sync.Mutex
	seq     map[string]int
	cancels map[string]context.CancelFunc
	owned   map[string]bool
}

var _ agentssvc.AgentService = (*Service)(nil)

// New makes the service.
func New(repo agentrepo.SessionRepository, drafts scenessvc.DraftService, dev devicessvc.DeviceService, show showsvc.ShowService,
	runner agentport.Runner, kv showrepo.KV, pub realtime.Publisher, log *slog.Logger, cfg Config) *Service {
	return &Service{repo: repo, drafts: drafts, devices: dev, show: show, runner: runner, kv: kv, pub: pub, log: log, cfg: cfg,
		seq: map[string]int{}, cancels: map[string]context.CancelFunc{}, owned: map[string]bool{}}
}

// Recover marks sessions that were running when the server stopped as failed.
func (s *Service) Recover(ctx context.Context) {
	list, err := s.repo.List(ctx)
	if err != nil {
		return
	}
	for i := range list {
		if list[i].Status == agents.Running {
			list[i].Status = agents.Failed
			_ = s.repo.Save(ctx, &list[i])
		}
	}
}

func (s *Service) sceneOr(ctx context.Context, id string) (string, error) {
	if id != "" {
		return id, nil
	}
	if a := s.show.Get(ctx).ActiveSceneID; a != "" {
		return a, nil
	}
	return "", app_errors.BadRequest("Pick a scene (sceneId); no scene is active.")
}

func (s *Service) create(ctx context.Context, agent, prompt, sceneID string) (*agents.Session, error) {
	id := services.NewID("agt")
	dr, err := s.drafts.Create(ctx, sceneID, "agent:"+agent+"#"+strings.TrimPrefix(id, "agt_"))
	if err != nil {
		return nil, err
	}
	sess := &agents.Session{ID: id, Agent: agent, Prompt: prompt, Status: agents.Running, SceneID: sceneID, DraftID: dr.ID,
		CreatedAt: time.Now().UTC()}
	if err := s.repo.Save(ctx, sess); err != nil {
		return nil, err
	}
	s.publishSession(sess)
	return sess, nil
}

func (s *Service) Start(ctx context.Context, in agentssvc.StartInput) (*agents.Session, error) {
	in.Prompt = strings.TrimSpace(in.Prompt)
	if !agents.IsValidAgent(in.Agent) {
		return nil, app_errors.BadRequest("agent must be codex or claude.")
	}
	if in.Prompt == "" {
		return nil, app_errors.BadRequest("Say what the agent should do (prompt).")
	}
	if why := s.runner.Available(in.Agent); why != "" {
		return nil, app_errors.Unavailable("%s", why)
	}
	sceneID, err := s.sceneOr(ctx, in.SceneID)
	if err != nil {
		return nil, err
	}
	sess, err := s.create(ctx, in.Agent, in.Prompt, sceneID)
	if err != nil {
		return nil, err
	}
	tok, dev, err := s.devices.AgentToken(ctx, sess.ID, in.Agent+" "+sess.ID)
	if err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancels[sess.ID], s.owned[sess.ID] = cancel, true
	s.mu.Unlock()
	spec := agentport.Spec{Agent: in.Agent, Prompt: prompt(in.Prompt, sess), MCPURL: s.cfg.MCPURL, Token: tok, WorkDir: s.cfg.WorkDir, Self: s.cfg.Self}
	go s.run(runCtx, sess.ID, spec, dev.ID)
	return sess, nil
}

// prompt wraps the user's request with what the agent needs to know about projmap.
func prompt(user string, sess *agents.Session) string {
	return "You are working in projmap, a projection mapping tool, through its MCP server (tools named scene_get, " +
		"surface_create, clip_add, output_render and so on). Your edits go into draft " + sess.DraftID + " of scene " + sess.SceneID +
		", never live. Start with scene_get, look before you write (reference_photo_get, camera_snapshot, output_render), " +
		"and finish with proposal_submit and a one-line summary.\n\nRequest: " + user
}

func (s *Service) run(ctx context.Context, id string, spec agentport.Spec, deviceID string) {
	s.Log(context.Background(), id, agents.Event{Kind: agents.KindStatus, Text: spec.Agent + " started"})
	err := s.runner.Run(ctx, spec, func(e agents.Event) { s.Log(context.Background(), id, e) })
	bg := context.Background()
	sess, gerr := s.repo.Get(bg, id)
	if gerr != nil {
		return
	}
	switch {
	case ctx.Err() != nil:
		sess.Status = agents.Cancelled
	case err != nil:
		sess.Status = agents.Failed
		s.Log(bg, id, agents.Event{Kind: agents.KindStatus, Text: "failed: " + err.Error()})
	default:
		sess.Status = agents.Done
	}
	if sess.Status != agents.Failed {
		s.Log(bg, id, agents.Event{Kind: agents.KindStatus, Text: sess.Status})
	}
	_ = s.repo.Save(bg, sess)
	s.publishSession(sess)
	_ = s.devices.Revoke(bg, deviceID)
	s.mu.Lock()
	delete(s.cancels, id)
	s.mu.Unlock()
}

func (s *Service) publishSession(sess *agents.Session) {
	s.pub.Publish(Channel(sess.ID), realtime.Message{T: "session", Ch: Channel(sess.ID), D: realtime.Data(sess)})
}

func (s *Service) List(ctx context.Context) ([]agents.Session, error) { return s.repo.List(ctx) }

func (s *Service) Get(ctx context.Context, id string) (*agents.Session, error) {
	return s.repo.Get(ctx, id)
}

func (s *Service) Events(ctx context.Context, id string) ([]agents.Event, error) {
	if _, err := s.repo.Get(ctx, id); err != nil {
		return nil, err
	}
	return s.repo.Events(ctx, id)
}

func (s *Service) Snapshot(ctx context.Context, id string) (*agentssvc.Snapshot, error) {
	sess, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	ev, err := s.repo.Events(ctx, id)
	if err != nil {
		return nil, err
	}
	return &agentssvc.Snapshot{Session: *sess, Events: ev}, nil
}

func (s *Service) Cancel(ctx context.Context, id string) (*agents.Session, error) {
	sess, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	cancel := s.cancels[id]
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if sess.Status == agents.Running {
		sess.Status = agents.Cancelled
		if err := s.repo.Save(ctx, sess); err != nil {
			return nil, err
		}
		s.publishSession(sess)
	}
	return sess, nil
}

func (s *Service) Attach(ctx context.Context, agent, sceneID string) (*agents.Session, error) {
	if !agents.IsValidAgent(agent) {
		agent = "claude"
	}
	sceneID, err := s.sceneOr(ctx, sceneID)
	if err != nil {
		return nil, err
	}
	return s.create(ctx, agent, "(connected over MCP)", sceneID)
}

func (s *Service) Log(ctx context.Context, id string, e agents.Event) {
	s.mu.Lock()
	n, ok := s.seq[id]
	if !ok {
		if ev, err := s.repo.Events(ctx, id); err == nil {
			n = len(ev)
		}
	}
	n++
	s.seq[id] = n
	s.mu.Unlock()
	e.Seq = n
	if e.TS.IsZero() {
		e.TS = time.Now().UTC()
	}
	if len(e.Text) > 4000 {
		e.Text = e.Text[:4000] + "…"
	}
	if err := s.repo.AppendEvent(ctx, id, e); err != nil {
		s.log.Warn("agent event", "err", err)
	}
	s.pub.Publish(Channel(id), realtime.Message{T: "event", Ch: Channel(id), V: realtime.Ver(int64(n)), D: realtime.Data(e)})
}

func (s *Service) Finish(ctx context.Context, id, status string) {
	if s.Owned(id) {
		return
	}
	sess, err := s.repo.Get(ctx, id)
	if err != nil || sess.Status != agents.Running {
		return
	}
	sess.Status = status
	if s.repo.Save(ctx, sess) == nil {
		s.Log(ctx, id, agents.Event{Kind: agents.KindStatus, Text: status})
		s.publishSession(sess)
	}
}

func (s *Service) Owned(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.owned[id]
}

func (s *Service) Settings(ctx context.Context) agents.Settings {
	var st agents.Settings
	if b, err := s.kv.Get(ctx, settingsKey); err == nil && b != nil {
		_ = json.Unmarshal(b, &st)
	}
	return st
}

func (s *Service) UpdateSettings(ctx context.Context, partial json.RawMessage) (agents.Settings, error) {
	cur := s.Settings(ctx)
	b, _ := json.Marshal(cur)
	merged, err := jsonpatch.MergePatch(b, partial)
	if err != nil {
		return cur, app_errors.BadRequest("The body must be an object of settings.")
	}
	var next agents.Settings
	if err := json.Unmarshal(merged, &next); err != nil {
		return cur, app_errors.BadRequest("agentMayPreview and agentMayGoLive must be true or false.")
	}
	out, _ := json.Marshal(next)
	if err := s.kv.Put(ctx, settingsKey, out); err != nil {
		return cur, err
	}
	return next, nil
}
