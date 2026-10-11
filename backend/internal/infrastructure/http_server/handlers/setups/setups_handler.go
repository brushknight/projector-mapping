// Package setups serves projector rigs.
package setups

import (
	"net/http"

	"github.com/labstack/echo/v4"

	setupssvc "projmap/internal/application/services/setups"
	"projmap/internal/domain/setup"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the setups section.
type Handler struct{ svc setupssvc.SetupService }

// New makes the handler.
func New(svc setupssvc.SetupService) *Handler { return &Handler{svc: svc} }

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/setups", h.list)
	api.POST("/setups", h.create, middleware.Editor)
	api.GET("/setups/:id", h.get)
	api.PATCH("/setups/:id", h.patch, middleware.Control)
	api.DELETE("/setups/:id", h.delete, middleware.Editor)
}

func (h *Handler) list(c echo.Context) error {
	l, err := h.svc.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) create(c echo.Context) error {
	var in setup.Setup
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	s, err := h.svc.Create(c.Request().Context(), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, s)
}

func (h *Handler) get(c echo.Context) error {
	s, _, err := h.svc.Get(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, s)
}

func (h *Handler) patch(c echo.Context) error {
	raw, err := httpx.Raw(c)
	if err != nil {
		return err
	}
	s, err := h.svc.Merge(c.Request().Context(), c.Param("id"), raw, middleware.Of(c).By())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, s)
}

func (h *Handler) delete(c echo.Context) error {
	if err := h.svc.Delete(c.Request().Context(), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
