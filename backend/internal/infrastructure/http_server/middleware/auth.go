// Package middleware resolves who is calling: requests from this Mac are a trusted editor, others carry a device
// token (Authorization: Bearer, or ?token= for the embedded preview).
package middleware

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	devicessvc "projmap/internal/application/services/devices"
	"projmap/internal/domain/devices"
	"projmap/internal/infrastructure/realtime/hub"
)

// Principal is the caller.
type Principal struct {
	Role     devices.Role
	DeviceID string
	Name     string
	Local    bool
	// SessionID is set for agent tokens.
	SessionID string
}

// By is how history and patched messages name the caller.
func (p Principal) By() string {
	if p.DeviceID != "" {
		return p.DeviceID
	}
	return "editor"
}

const key = "principal"

// Token reads the bearer token or ?token=.
func Token(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return r.URL.Query().Get("token")
}

// Resolve finds the principal of a request (nil when it has none).
func Resolve(r *http.Request, svc devicessvc.DeviceService) (*Principal, error) {
	if tok := Token(r); tok != "" {
		d, err := svc.Authenticate(r.Context(), tok)
		if err != nil {
			return nil, err
		}
		return &Principal{Role: d.Role, DeviceID: d.ID, Name: d.Name, SessionID: d.SessionID, Local: hub.IsLocal(r)}, nil
	}
	if hub.IsLocal(r) {
		return &Principal{Role: devices.RoleEditor, Name: "editor", Local: true}, nil
	}
	return nil, app_errors.Unauthorized("Pair this device first: POST /api/v1/pair with the code on the projector.")
}

// Auth requires a principal.
func Auth(svc devicessvc.DeviceService) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			p, err := Resolve(c.Request(), svc)
			if err != nil {
				return err
			}
			c.Set(key, p)
			return next(c)
		}
	}
}

// Of returns the request's principal.
func Of(c echo.Context) Principal {
	if p, ok := c.Get(key).(*Principal); ok {
		return *p
	}
	return Principal{}
}

// Roles allows only the given roles.
func Roles(roles ...devices.Role) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			p := Of(c)
			for _, r := range roles {
				if p.Role == r {
					return next(c)
				}
			}
			return app_errors.Forbidden("Role %s cannot do this.", p.Role)
		}
	}
}

// Control is editor or remote.
var Control = Roles(devices.RoleEditor, devices.RoleRemote)

// Editor is editor only.
var Editor = Roles(devices.RoleEditor)

// LocalOnly allows requests from this Mac only.
func LocalOnly(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !hub.IsLocal(c.Request()) {
			return app_errors.Forbidden("Only the projector output on this Mac can read this.")
		}
		return next(c)
	}
}
