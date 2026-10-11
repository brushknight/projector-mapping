// Package devicesvc implements the devices section.
package devicesvc

import (
	"context"
	"crypto/subtle"
	"strings"
	"sync"
	"time"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	devicerepo "projmap/internal/application/ports/repository/devices"
	"projmap/internal/application/services"
	devicessvc "projmap/internal/application/services/devices"
	"projmap/internal/domain/devices"
)

// Channel carries the device list.
const Channel = "devices"

// Service implements DeviceService.
type Service struct {
	repo     devicerepo.DeviceRepository
	pub      realtime.Publisher
	presence realtime.Presence
	now      func() time.Time

	mu    sync.Mutex
	code  devices.PairCode
	login map[string]time.Time
}

var _ devicessvc.DeviceService = (*Service)(nil)

// New makes the service.
func New(repo devicerepo.DeviceRepository, pub realtime.Publisher) *Service {
	return &Service{repo: repo, pub: pub, now: time.Now, login: map[string]time.Time{}}
}

// SetPresence connects the hub (it is built after the services).
func (s *Service) SetPresence(p realtime.Presence) { s.presence = p }

func (s *Service) PairCode(context.Context) devices.PairCode {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.code.Code == "" || s.now().After(s.code.ExpiresAt) {
		s.code = devices.NewCode(s.now())
	}
	return s.code
}

func cleanName(n string, def string) string {
	n = strings.TrimSpace(n)
	if n == "" {
		return def
	}
	if len(n) > 80 {
		n = n[:80]
	}
	return n
}

func (s *Service) Pair(ctx context.Context, code, name string, role devices.Role) (string, *devices.Device, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if role == "" {
		role = devices.RoleRemote
	}
	if !role.IsValid() || role == devices.RoleAgent {
		return "", nil, app_errors.BadRequest("role must be remote, output or editor.")
	}
	s.mu.Lock()
	ok := s.code.Code != "" && s.now().Before(s.code.ExpiresAt) && subtle.ConstantTimeCompare([]byte(code), []byte(s.code.Code)) == 1
	if ok {
		s.code = devices.NewCode(s.now()) // one code, one device
	}
	s.mu.Unlock()
	if !ok {
		return "", nil, app_errors.Unauthorized("The code is wrong or expired. Check the code on the projector.")
	}
	return s.issue(ctx, cleanName(name, "device"), role, "")
}

func (s *Service) issue(ctx context.Context, name string, role devices.Role, sessionID string) (string, *devices.Device, error) {
	tok, hash := devices.NewToken()
	d := &devices.Device{ID: services.NewID("dev"), Name: name, Role: role, LastSeen: s.now().UTC(), TokenHash: hash, SessionID: sessionID}
	if err := s.repo.Save(ctx, d); err != nil {
		return "", nil, err
	}
	s.Broadcast(ctx)
	return tok, d, nil
}

func (s *Service) LoginLink(context.Context) devices.PairCode {
	c := devices.NewCode(s.now())
	c.Code = strings.ToLower(c.Code) + strings.ToLower(devices.NewCode(s.now()).Code) + strings.ToLower(devices.NewCode(s.now()).Code)
	s.mu.Lock()
	s.login[c.Code] = c.ExpiresAt
	s.mu.Unlock()
	return c
}

func (s *Service) Login(ctx context.Context, code, name string) (string, *devices.Device, error) {
	s.mu.Lock()
	exp, ok := s.login[code]
	delete(s.login, code)
	s.mu.Unlock()
	if !ok || s.now().After(exp) {
		return "", nil, app_errors.Unauthorized("The login link is used or expired. Run projmap open again.")
	}
	return s.issue(ctx, cleanName(name, "editor"), devices.RoleEditor, "")
}

func (s *Service) Authenticate(ctx context.Context, token string) (*devices.Device, error) {
	if token == "" {
		return nil, app_errors.Unauthorized("Pair this device first.")
	}
	d, err := s.repo.ByTokenHash(ctx, devices.HashToken(token))
	if err != nil {
		return nil, app_errors.Unauthorized("The device token is unknown or revoked. Pair again.")
	}
	return d, nil
}

func (s *Service) Local(ctx context.Context, name string, role devices.Role) (*devices.Device, error) {
	if !role.IsValid() {
		role = devices.RoleEditor
	}
	name = cleanName(name, string(role)+" (this Mac)")
	if d, err := s.repo.ByLocal(ctx, name, role); err == nil {
		return d, nil
	}
	d := &devices.Device{ID: services.NewID("dev"), Name: name, Role: role, LastSeen: s.now().UTC(), Local: true}
	if err := s.repo.Save(ctx, d); err != nil {
		return nil, err
	}
	return d, nil
}

func (s *Service) AgentToken(ctx context.Context, sessionID, name string) (string, *devices.Device, error) {
	return s.issue(ctx, cleanName(name, "agent"), devices.RoleAgent, sessionID)
}

func (s *Service) decorate(d *devices.Device) {
	if s.presence == nil {
		return
	}
	d.Online = s.presence.Online(d.ID)
	if t, ok := s.presence.Telemetry(d.ID).(*devices.Telemetry); ok && t != nil {
		d.Telemetry = t
	}
}

func (s *Service) List(ctx context.Context) ([]devices.Device, error) {
	list, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range list {
		s.decorate(&list[i])
	}
	return list, nil
}

func (s *Service) Get(ctx context.Context, id string) (*devices.Device, error) {
	d, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.decorate(d)
	return d, nil
}

func (s *Service) Touch(ctx context.Context, id string) {
	d, err := s.repo.Get(ctx, id)
	if err != nil {
		return
	}
	d.LastSeen = s.now().UTC()
	_ = s.repo.Save(ctx, d)
}

func (s *Service) Revoke(ctx context.Context, id string) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	if s.presence != nil {
		s.presence.Kick(id)
	}
	s.Broadcast(ctx)
	return nil
}

func (s *Service) Broadcast(ctx context.Context) {
	list, err := s.List(ctx)
	if err != nil {
		return
	}
	s.pub.Publish(Channel, realtime.Message{T: "snapshot", Ch: Channel, V: realtime.Ver(s.now().UnixMilli()), D: realtime.Data(list)})
}
