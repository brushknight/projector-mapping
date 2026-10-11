// Package show serves the live state and the transport actions.
package show

import (
	"net/http"

	"github.com/labstack/echo/v4"

	showsvc "projmap/internal/application/services/show"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the show section.
type Handler struct{ svc showsvc.ShowService }

// New makes the handler.
func New(svc showsvc.ShowService) *Handler { return &Handler{svc: svc} }

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/show", h.get)
	api.POST("/show/:action", h.do, middleware.Control)
}

func (h *Handler) get(c echo.Context) error {
	return c.JSON(http.StatusOK, h.svc.Get(c.Request().Context()))
}

func (h *Handler) do(c echo.Context) error {
	raw, err := httpx.Raw(c)
	if err != nil {
		return err
	}
	s, err := h.svc.Do(c.Request().Context(), c.Param("action"), raw, middleware.Of(c).By())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, s)
}
