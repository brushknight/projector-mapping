// Package assets serves uploads, /a/{sha} and the built-in catalog files.
package assets

import (
	"io"
	"io/fs"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	assetssvc "projmap/internal/application/services/assets"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the assets section.
type Handler struct {
	svc     assetssvc.AssetService
	catalog fs.FS
}

// New makes the handler; catalog is the built-in files (scenery/<id>.jpg).
func New(svc assetssvc.AssetService, catalog fs.FS) *Handler {
	return &Handler{svc: svc, catalog: catalog}
}

// RegisterRoutes adds /api/v1/assets to api, and /a/{sha} and /catalog/assets/* to root.
func (h *Handler) RegisterRoutes(root *echo.Echo, api *echo.Group) {
	api.POST("/assets", h.upload, middleware.Roles("editor", "remote", "output", "agent"))
	api.GET("/assets/:sha", h.meta)
	root.GET("/a/:sha", h.bytes)
	root.HEAD("/a/:sha", h.bytes)
	root.GET("/catalog/assets/*", h.catalogFile)
}

// ReadUpload reads the multipart "file" (or the first file part) of a request.
func ReadUpload(c echo.Context) ([]byte, error) {
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, assetssvc.MaxBytes+1<<20)
	f, err := c.FormFile("file")
	if err != nil {
		form, ferr := c.MultipartForm()
		if ferr != nil {
			return nil, app_errors.BadRequest("Send the file as multipart form field \"file\".")
		}
		for _, fs := range form.File {
			if len(fs) > 0 {
				f = fs[0]
				break
			}
		}
		if f == nil {
			return nil, app_errors.BadRequest("Send the file as multipart form field \"file\".")
		}
	}
	r, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(io.LimitReader(r, assetssvc.MaxBytes+1))
}

func (h *Handler) upload(c echo.Context) error {
	b, err := ReadUpload(c)
	if err != nil {
		return err
	}
	a, err := h.svc.Upload(c.Request().Context(), b, c.FormValue("kind"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, a)
}

func (h *Handler) meta(c echo.Context) error {
	a, err := h.svc.Get(c.Request().Context(), c.Param("sha"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, a)
}

func (h *Handler) bytes(c echo.Context) error {
	f, a, err := h.svc.Open(c.Request().Context(), c.Param("sha"))
	if err != nil {
		return err
	}
	defer f.Close()
	w := c.Response()
	w.Header().Set("Content-Type", a.Mime)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+a.SHA+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if a.Mime == "image/svg+xml" {
		// an SVG opened as a page must not run scripts on this origin
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	}
	http.ServeContent(w, c.Request(), "", time.Time{}, f)
	return nil
}

func (h *Handler) catalogFile(c echo.Context) error {
	name := c.Param("*")
	if !fs.ValidPath(name) {
		return app_errors.NotFound("Catalog file %s does not exist.", name)
	}
	if _, err := fs.Stat(h.catalog, name); err != nil {
		return app_errors.NotFound("Catalog file %s does not exist.", name)
	}
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFileFS(c.Response(), c.Request(), h.catalog, name)
	return nil
}
