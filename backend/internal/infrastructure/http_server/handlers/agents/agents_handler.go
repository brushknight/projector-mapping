// Package agents serves agent sessions and the agent permission settings.
package agents

import (
	"net/http"

	"github.com/labstack/echo/v4"

	agentssvc "projmap/internal/application/services/agents"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the agents section.
type Handler struct{ svc agentssvc.AgentService }

// New makes the handler.
func New(svc agentssvc.AgentService) *Handler { return &Handler{svc: svc} }

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/agents/sessions", h.list)
	api.POST("/agents/sessions", h.start, middleware.Control)
	api.GET("/agents/sessions/:id", h.get)
	api.GET("/agents/sessions/:id/events", h.events)
	api.POST("/agents/sessions/:id/cancel", h.cancel, middleware.Control)
	api.GET("/agents/available", h.available)
	api.GET("/settings", h.settings)
	api.PATCH("/settings", h.patchSettings, middleware.Editor)
}

func (h *Handler) list(c echo.Context) error {
	l, err := h.svc.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) start(c echo.Context) error {
	var in agentssvc.StartInput
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	s, err := h.svc.Start(c.Request().Context(), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, s)
}

func (h *Handler) get(c echo.Context) error {
	s, err := h.svc.Get(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, s)
}

func (h *Handler) events(c echo.Context) error {
	l, err := h.svc.Events(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) cancel(c echo.Context) error {
	s, err := h.svc.Cancel(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, s)
}

func (h *Handler) available(c echo.Context) error {
	return c.JSON(http.StatusOK, h.svc.Available(c.Request().Context()))
}

func (h *Handler) settings(c echo.Context) error {
	return c.JSON(http.StatusOK, h.svc.Settings(c.Request().Context()))
}

func (h *Handler) patchSettings(c echo.Context) error {
	raw, err := httpx.Raw(c)
	if err != nil {
		return err
	}
	s, err := h.svc.UpdateSettings(c.Request().Context(), raw)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, s)
}
