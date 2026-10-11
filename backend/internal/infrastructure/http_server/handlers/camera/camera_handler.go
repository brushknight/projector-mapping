// Package camera serves phone stills, the camera status and calibrations.
package camera

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	camerasvc "projmap/internal/application/services/camera"
	showsvc "projmap/internal/application/services/show"
	assetshttp "projmap/internal/infrastructure/http_server/handlers/assets"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the camera section.
type Handler struct {
	Camera       camerasvc.CameraService
	Calibrations camerasvc.CalibrationService
	Show         showsvc.ShowService
}

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.POST("/camera/stills", h.still, middleware.Control)
	api.GET("/camera/status", h.status)
	api.GET("/camera/preview.jpg", h.preview)
	api.POST("/calibrations", h.start, middleware.Control)
	api.GET("/calibrations/:id", h.get)
	api.GET("/calibrations/:id/candidates", h.candidates)
}

func (h *Handler) still(c echo.Context) error {
	b, err := assetshttp.ReadUpload(c)
	if err != nil {
		return err
	}
	a, err := h.Camera.StillUploaded(c.Request().Context(), c.QueryParam("request"), b)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, a)
}

func (h *Handler) status(c echo.Context) error {
	return c.JSON(http.StatusOK, h.Camera.Status(c.Request().Context()))
}

func (h *Handler) preview(c echo.Context) error {
	b, ok := h.Camera.Preview(c.Request().Context())
	if !ok {
		return app_errors.NotFound("No camera preview is streaming.")
	}
	c.Response().Header().Set("Cache-Control", "no-store")
	return c.Blob(http.StatusOK, "image/jpeg", b)
}

func (h *Handler) start(c echo.Context) error {
	var in struct {
		SetupID string `json:"setupId"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	if in.SetupID == "" {
		in.SetupID = h.Show.Get(c.Request().Context()).ActiveSetupID
	}
	cal, err := h.Calibrations.Start(c.Request().Context(), in.SetupID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, map[string]string{"id": cal.ID})
}

func (h *Handler) get(c echo.Context) error {
	cal, err := h.Calibrations.Get(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, cal)
}

func (h *Handler) candidates(c echo.Context) error {
	cal, err := h.Calibrations.Get(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	l, err := h.Calibrations.Detect(c.Request().Context(), cal.SetupID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, l)
}
