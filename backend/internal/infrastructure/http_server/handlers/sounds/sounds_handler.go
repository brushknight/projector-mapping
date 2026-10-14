// Package sounds serves the sound library and playing sounds on the audio output (protocol §14).
package sounds

import (
	"net/http"

	"github.com/labstack/echo/v4"

	showsvc "projmap/internal/application/services/show"
	soundssvc "projmap/internal/application/services/sounds"
	assetshttp "projmap/internal/infrastructure/http_server/handlers/assets"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the sounds section.
type Handler struct {
	Sounds soundssvc.SoundService
	Show   showsvc.ShowService
}

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/sounds", h.list)
	api.POST("/sounds", h.upload, middleware.Control)
	api.POST("/sounds/play", h.play, middleware.Control)
	api.POST("/sounds/stop", h.stop, middleware.Control)
	api.PATCH("/sounds/:sha", h.rename, middleware.Control)
	api.DELETE("/sounds/:sha", h.delete, middleware.Control)
}

func (h *Handler) list(c echo.Context) error {
	l, err := h.Sounds.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) upload(c echo.Context) error {
	in, data, err := assetshttp.SoundForm(c)
	if err != nil {
		return err
	}
	a, err := h.Sounds.Upload(c.Request().Context(), data, in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, a)
}

func (h *Handler) rename(c echo.Context) error {
	var in struct {
		Name string `json:"name"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	a, err := h.Sounds.Rename(c.Request().Context(), c.Param("sha"), in.Name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, a)
}

func (h *Handler) delete(c echo.Context) error {
	if err := h.Sounds.Delete(c.Request().Context(), c.Param("sha")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) play(c echo.Context) error {
	var in showsvc.PlayIn
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	ack, err := h.Show.PlaySound(c.Request().Context(), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ack)
}

func (h *Handler) stop(c echo.Context) error {
	var in showsvc.StopIn
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	ack, err := h.Show.StopSound(c.Request().Context(), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ack)
}
