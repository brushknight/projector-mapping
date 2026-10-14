// Package videos serves the video library, video uploads and YouTube imports (protocol §14).
package videos

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	assetssvc "projmap/internal/application/services/assets"
	videossvc "projmap/internal/application/services/videos"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the videos section.
type Handler struct {
	Videos videossvc.VideoService
	// TempDir is where uploads land before they move into the store (same volume as the store).
	TempDir func() (string, error)
}

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/videos", h.list)
	api.POST("/videos", h.upload, middleware.Control)
	api.GET("/videos/tools", h.tools)
	api.GET("/videos/import", h.jobs)
	api.POST("/videos/import", h.importYouTube, middleware.Control)
	api.GET("/videos/import/:id", h.job)
	api.PATCH("/videos/:id", h.rename, middleware.Control)
	api.DELETE("/videos/:id", h.delete, middleware.Control)
}

func (h *Handler) list(c echo.Context) error {
	l, err := h.Videos.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

// upload streams the multipart "file" (up to 512 MB) to a temporary file, then stores it.
func (h *Handler) upload(c echo.Context) error {
	r := c.Request()
	r.Body = http.MaxBytesReader(c.Response(), r.Body, assetssvc.MaxVideoBytes+1<<20)
	mr, err := r.MultipartReader()
	if err != nil {
		return app_errors.BadRequest("Send the video as multipart form field \"file\".")
	}
	dir, err := h.TempDir()
	if err != nil {
		return err
	}
	var path, fileName, name string
	defer func() {
		if path != "" {
			_ = os.Remove(path) // gone already when it moved into the store
		}
	}()
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return tooLarge(err)
		}
		switch {
		case part.FormName() == "name":
			b, _ := io.ReadAll(io.LimitReader(part, 1024))
			name = string(b)
		case part.FileName() != "" && path == "":
			f, err := os.CreateTemp(dir, "upload-*")
			if err != nil {
				return err
			}
			path, fileName = f.Name(), part.FileName()
			n, err := io.Copy(f, io.LimitReader(part, assetssvc.MaxVideoBytes+1))
			f.Close()
			if err != nil {
				return tooLarge(err)
			}
			if n > assetssvc.MaxVideoBytes {
				return app_errors.BadRequest("The video is larger than 512 MB.")
			}
			if n == 0 {
				return app_errors.BadRequest("The upload is empty.")
			}
		}
		part.Close()
	}
	if path == "" {
		return app_errors.BadRequest("Send the video as multipart form field \"file\".")
	}
	v, err := h.Videos.Upload(r.Context(), path, fileName, name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, v)
}

func tooLarge(err error) error {
	var mb *http.MaxBytesError
	if errors.As(err, &mb) || strings.Contains(err.Error(), "too large") {
		return app_errors.BadRequest("The video is larger than 512 MB.")
	}
	return app_errors.BadRequest("The upload could not be read: %v", err)
}

func (h *Handler) rename(c echo.Context) error {
	var in struct {
		Name string `json:"name"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	v, err := h.Videos.Rename(c.Request().Context(), c.Param("id"), in.Name)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, v)
}

func (h *Handler) delete(c echo.Context) error {
	if err := h.Videos.Delete(c.Request().Context(), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) tools(c echo.Context) error { return c.JSON(http.StatusOK, h.Videos.Tools()) }

func (h *Handler) importYouTube(c echo.Context) error {
	var in videossvc.ImportIn
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	j, err := h.Videos.Import(c.Request().Context(), in)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusAccepted, j)
}

func (h *Handler) job(c echo.Context) error {
	j, _, err := h.Videos.Job(c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, j)
}

func (h *Handler) jobs(c echo.Context) error {
	return c.JSON(http.StatusOK, httpx.Empty(h.Videos.Jobs()))
}
