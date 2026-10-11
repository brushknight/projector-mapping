// Package http_server builds Echo: recovery, private-network-only access, error replies as
// { "code": "...", "message": "..." } (protocol §2).
package http_server

import (
	"errors"
	"log/slog"
	"net"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"projmap/internal/application/app_errors"
)

// New makes the Echo instance.
func New(log *slog.Logger) *echo.Echo {
	e := echo.New()
	e.HideBanner, e.HidePort = true, true
	e.Use(middleware.Recover())
	e.Use(PrivateOnly)
	e.HTTPErrorHandler = func(err error, c echo.Context) {
		if c.Response().Committed {
			return
		}
		var he *echo.HTTPError
		if errors.As(err, &he) {
			code := map[int]string{404: "not_found", 405: "method_not_allowed", 413: "too_large", 400: "bad_request", 401: "unauthorized"}[he.Code]
			if code == "" {
				code = "error"
			}
			msg, _ := he.Message.(string)
			if msg == "" {
				msg = http.StatusText(he.Code)
			}
			_ = c.JSON(he.Code, map[string]string{"code": code, "message": msg})
			return
		}
		ae := app_errors.As(err)
		if ae.Code == "internal" {
			log.Error("request failed", "method", c.Request().Method, "path", c.Request().URL.Path, "err", err)
		}
		body := map[string]any{"code": ae.Code, "message": ae.Message}
		if ae.Code == "stale" {
			body["version"] = ae.Version
		}
		_ = c.JSON(ae.Status, body)
	}
	return e
}

// PrivateOnly answers loopback, private-range and link-local addresses only (plan §11).
func PrivateOnly(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		host, _, err := net.SplitHostPort(c.Request().RemoteAddr)
		if err != nil {
			host = c.Request().RemoteAddr
		}
		ip := net.ParseIP(host)
		if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
			return next(c)
		}
		return c.JSON(http.StatusForbidden, map[string]string{"code": "forbidden", "message": "projmap answers the local network only."})
	}
}
