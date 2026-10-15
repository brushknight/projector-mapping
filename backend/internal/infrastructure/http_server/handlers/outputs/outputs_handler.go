// Package outputs puts the projector output on a display as a clean Chrome kiosk window (protocol §17). Both routes
// answer requests from this Mac only: they start a program on it.
package outputs

import (
	"context"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	devicessvc "projmap/internal/application/services/devices"
	"projmap/internal/domain/devices"
	"projmap/internal/infrastructure/browser"
	"projmap/internal/infrastructure/realtime/hub"
)

// Handler serves /outputs.
type Handler struct {
	// DataDir holds the kiosk window's own Chrome profile.
	DataDir string
	// Port is the server's port: the window opens http://127.0.0.1:<Port>/<route>.
	Port int
	// Devices reads the /out telemetry, to check the output landed on the chosen display (nil: no check).
	Devices devicessvc.DeviceService
}

// outputSize is the size the projector output reports (protocol §1 telemetry), from any online output device.
func (h *Handler) outputSize(route string) browser.Size {
	if h.Devices == nil || route != "out" {
		return nil
	}
	return func(ctx context.Context) (int, int, bool) {
		list, err := h.Devices.List(ctx)
		if err != nil {
			return 0, 0, false
		}
		for _, d := range list {
			if d.Role == devices.RoleOutput && d.Online && d.Telemetry != nil && d.Telemetry.Width > 0 {
				return d.Telemetry.Width, d.Telemetry.Height, true
			}
		}
		return 0, 0, false
	}
}

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/outputs/displays", h.displays, localOnly)
	api.POST("/outputs/launch", h.launch, localOnly)
}

func localOnly(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !hub.IsLocal(c.Request()) {
			return app_errors.Forbidden("Put the output on a projector from the editor on the Mac that runs projmap.")
		}
		return next(c)
	}
}

func (h *Handler) displays(c echo.Context) error {
	list, err := browser.Displays(c.Request().Context())
	if err != nil {
		return app_errors.Unavailable("This Mac did not list its displays: %v", err)
	}
	return c.JSON(http.StatusOK, list)
}

// LaunchRequest is the body of POST /outputs/launch.
type LaunchRequest struct {
	Display int    `json:"display"`
	Route   string `json:"route"`
}

// LaunchResult says what opened where.
type LaunchResult struct {
	Launched bool            `json:"launched"`
	URL      string          `json:"url"`
	Display  browser.Display `json:"display"`
}

func (h *Handler) launch(c echo.Context) error {
	var req LaunchRequest
	if err := c.Bind(&req); err != nil {
		return app_errors.BadRequest("Send { display, route }.")
	}
	if req.Route == "" {
		req.Route = "out"
	}
	if req.Route != "out" && req.Route != "view" {
		return app_errors.BadRequest("route must be out or view.")
	}
	ctx := c.Request().Context()
	list, err := browser.Displays(ctx)
	if err != nil {
		return app_errors.Unavailable("This Mac did not list its displays: %v", err)
	}
	if req.Display < 1 || req.Display > len(list) {
		return app_errors.NotFound("Display %d is not connected. This Mac has %d.", req.Display, len(list))
	}
	d := list[req.Display-1]
	// loopback is trusted, so neither page needs a token
	url := fmt.Sprintf("http://127.0.0.1:%d/%s", h.Port, req.Route)
	if err := browser.Open(ctx, url, &d, list, h.DataDir, h.outputSize(req.Route)); err != nil {
		return app_errors.Unavailable("%v. Open %s yourself if it keeps failing.", err, url)
	}
	return c.JSON(http.StatusAccepted, LaunchResult{Launched: true, URL: url, Display: d})
}
