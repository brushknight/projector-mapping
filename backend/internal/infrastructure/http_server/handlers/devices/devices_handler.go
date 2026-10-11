// Package devices serves /info, pairing, login links and the device list.
package devices

import (
	"net/http"
	"os"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	devicessvc "projmap/internal/application/services/devices"
	"projmap/internal/config"
	"projmap/internal/domain/devices"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
	"projmap/internal/infrastructure/realtime/hub"
)

// Handler serves the devices section.
type Handler struct {
	svc  devicessvc.DeviceService
	port int
}

// New makes the handler.
func New(svc devicessvc.DeviceService, port int) *Handler { return &Handler{svc: svc, port: port} }

// RegisterRoutes adds the routes; public needs no token, api does.
func (h *Handler) RegisterRoutes(public, api *echo.Group) {
	public.GET("/info", h.info)
	public.GET("/pair/code", h.code, middleware.LocalOnly)
	public.POST("/pair", h.pair)
	public.POST("/login-links", h.loginLink, middleware.LocalOnly)
	public.POST("/login", h.login)
	api.GET("/devices", h.list)
	api.DELETE("/devices/:id", h.revoke, middleware.Editor)
}

// Info is GET /info.
type Info struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	Port            int    `json:"port"`
	Hostname        string `json:"hostname"`
	PairingRequired bool   `json:"pairingRequired"`
}

func (h *Handler) info(c echo.Context) error {
	host, _ := os.Hostname()
	required := !hub.IsLocal(c.Request())
	if tok := middleware.Token(c.Request()); tok != "" {
		if _, err := h.svc.Authenticate(c.Request().Context(), tok); err == nil {
			required = false
		}
	}
	return c.JSON(http.StatusOK, Info{Name: "projmap", Version: config.Version, Port: h.port, Hostname: host, PairingRequired: required})
}

func (h *Handler) code(c echo.Context) error {
	return c.JSON(http.StatusOK, h.svc.PairCode(c.Request().Context()))
}

// PairRequest is POST /pair.
type PairRequest struct {
	Code string       `json:"code"`
	Name string       `json:"name"`
	Role devices.Role `json:"role"`
}

// PairResponse answers a pairing or login.
type PairResponse struct {
	Token  string         `json:"token"`
	Device devices.Device `json:"device"`
}

func (h *Handler) pair(c echo.Context) error {
	var req PairRequest
	if err := httpx.Bind(c, &req); err != nil {
		return err
	}
	if req.Code == "" {
		return app_errors.BadRequest("Send the 4-character code shown on the projector.")
	}
	tok, d, err := h.svc.Pair(c.Request().Context(), req.Code, req.Name, req.Role)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, PairResponse{Token: tok, Device: *d})
}

func (h *Handler) loginLink(c echo.Context) error {
	code := h.svc.LoginLink(c.Request().Context())
	return c.JSON(http.StatusOK, map[string]any{"code": code.Code, "expiresAt": code.ExpiresAt, "path": "/editor?login=" + code.Code})
}

func (h *Handler) login(c echo.Context) error {
	var req struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := httpx.Bind(c, &req); err != nil {
		return err
	}
	tok, d, err := h.svc.Login(c.Request().Context(), req.Code, req.Name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, PairResponse{Token: tok, Device: *d})
}

func (h *Handler) list(c echo.Context) error {
	l, err := h.svc.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) revoke(c echo.Context) error {
	if err := h.svc.Revoke(c.Request().Context(), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
