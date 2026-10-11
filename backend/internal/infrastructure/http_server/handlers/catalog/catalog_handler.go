// Package catalog serves the catalog and the effect library.
package catalog

import (
	"net/http"

	"github.com/labstack/echo/v4"

	catalogsvc "projmap/internal/application/services/catalog"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the catalog section.
type Handler struct{ svc catalogsvc.CatalogService }

// New makes the handler.
func New(svc catalogsvc.CatalogService) *Handler { return &Handler{svc: svc} }

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/catalog", h.catalog)
	api.GET("/effects", h.list)
	api.POST("/effects", h.create, middleware.Editor)
	api.GET("/effects/:id", h.get)
	api.PUT("/effects/:id", h.update, middleware.Editor)
	api.DELETE("/effects/:id", h.delete, middleware.Editor)
}

func (h *Handler) catalog(c echo.Context) error {
	c.Response().Header().Set("Cache-Control", "no-cache")
	return c.JSONBlob(http.StatusOK, h.svc.JSON())
}

func (h *Handler) list(c echo.Context) error {
	l, err := h.svc.Effects(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) get(c echo.Context) error {
	e, err := h.svc.Effect(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, e)
}

func (h *Handler) create(c echo.Context) error {
	var in catalogsvc.EffectInput
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	e, _, err := h.svc.CreateEffect(c.Request().Context(), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, e)
}

func (h *Handler) update(c echo.Context) error {
	var in catalogsvc.EffectInput
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	e, _, err := h.svc.UpdateEffect(c.Request().Context(), c.Param("id"), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, e)
}

func (h *Handler) delete(c echo.Context) error {
	if err := h.svc.DeleteEffect(c.Request().Context(), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
