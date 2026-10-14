// Package assets serves uploads, /a/{sha} and the built-in catalog files.
package assets

import (
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	assetssvc "projmap/internal/application/services/assets"
	soundssvc "projmap/internal/application/services/sounds"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the assets section.
type Handler struct {
	svc     assetssvc.AssetService
	catalog fs.FS
	// sounds takes POST /assets with kind=sound (so the sounds channel hears of it)
	sounds soundssvc.SoundService
}

// WithSounds routes kind=sound uploads through the sound library.
func (h *Handler) WithSounds(s soundssvc.SoundService) *Handler { h.sounds = s; return h }

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
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, assetssvc.MaxBytes+1<<20)
	if c.FormValue("kind") == "sound" && h.sounds != nil {
		in, data, err := SoundForm(c)
		if err != nil {
			return err
		}
		a, err := h.sounds.Upload(c.Request().Context(), data, in)
		if err != nil {
			return err
		}
		return c.JSON(http.StatusCreated, a)
	}
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

// SoundForm reads an upload's sound fields: the file name, name, and the uploader's duration and peaks.
func SoundForm(c echo.Context) (assetssvc.SoundIn, []byte, error) {
	data, err := ReadUpload(c)
	if err != nil {
		return assetssvc.SoundIn{}, nil, err
	}
	in := assetssvc.SoundIn{Name: c.FormValue("name")}
	if f, err := c.FormFile("file"); err == nil {
		in.FileName = f.Filename
	}
	if d := strings.TrimSpace(c.FormValue("duration")); d != "" {
		if v, err := strconv.ParseFloat(d, 64); err == nil {
			in.Duration = &v
		}
	}
	if p := strings.TrimSpace(c.FormValue("peaks")); p != "" {
		var peaks []float64
		if err := json.Unmarshal([]byte(p), &peaks); err != nil {
			return in, nil, app_errors.BadRequest("peaks must be a JSON array of numbers.")
		}
		in.Peaks = peaks
	}
	return in, data, nil
}
