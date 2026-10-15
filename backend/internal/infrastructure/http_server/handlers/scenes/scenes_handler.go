// Package scenes serves scenes (patches, undo, history), drafts, presets and "new scene from photo".
package scenes

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/ports/out/realtime"
	assetssvc "projmap/internal/application/services/assets"
	scenessvc "projmap/internal/application/services/scenes"
	setupssvc "projmap/internal/application/services/setups"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/domain/docpatch"
	"projmap/internal/infrastructure/http_server/handlers/httpx"
	"projmap/internal/infrastructure/http_server/middleware"
)

// Handler serves the scenes section.
type Handler struct {
	Scenes  scenessvc.SceneService
	Drafts  scenessvc.DraftService
	Presets scenessvc.PresetService
	Setups  setupssvc.SetupService
	Show    showsvc.ShowService
	Assets  assetssvc.AssetService
}

// RegisterRoutes adds the routes.
func (h *Handler) RegisterRoutes(api *echo.Group) {
	api.GET("/scenes", h.list)
	api.POST("/scenes", h.create, middleware.Control)
	api.POST("/scenes/from-photo", h.fromPhoto, middleware.Control)
	api.GET("/scenes/:id", h.get)
	api.PATCH("/scenes/:id", h.rename, middleware.Control)
	api.DELETE("/scenes/:id", h.delete, middleware.Control)
	api.POST("/scenes/:id/patch", h.patch, middleware.Control)
	api.POST("/scenes/:id/undo", h.undo, middleware.Control)
	api.POST("/scenes/:id/redo", h.redo, middleware.Control)
	api.GET("/scenes/:id/history", h.history)

	api.GET("/presets", h.presets)
	api.POST("/presets", h.createPreset, middleware.Control)
	api.POST("/presets/:id/apply", h.applyPreset, middleware.Control)
	api.DELETE("/presets/:id", h.deletePreset, middleware.Control)

	api.GET("/drafts", h.drafts)
	api.POST("/drafts", h.createDraft, middleware.Control)
	api.GET("/drafts/:id", h.draft)
	api.GET("/drafts/:id/scene", h.draftScene)
	api.POST("/drafts/:id/apply", h.applyDraft, middleware.Control)
	api.POST("/drafts/:id/discard", h.discardDraft, middleware.Control)
}

func (h *Handler) list(c echo.Context) error {
	l, err := h.Scenes.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) create(c echo.Context) error {
	var in struct {
		scenessvc.CreateIn
		Duplicate string `json:"duplicate"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	if in.Duplicate != "" {
		s, err := h.Scenes.Duplicate(c.Request().Context(), in.Duplicate, in.Name)
		if err != nil {
			return err
		}
		return c.JSON(http.StatusCreated, s)
	}
	if in.SetupID == "" {
		in.SetupID = h.Show.Get(c.Request().Context()).ActiveSetupID
	}
	if _, _, err := h.Setups.Get(c.Request().Context(), in.SetupID); err != nil {
		return err
	}
	s, err := h.Scenes.Create(c.Request().Context(), in.CreateIn)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, s)
}

// fromPhoto makes a scene for a photo: taken next to the lens it becomes the setup's reference photo.
func (h *Handler) fromPhoto(c echo.Context) error {
	ctx := c.Request().Context()
	var in struct {
		Asset    string `json:"asset"`
		Position string `json:"position"`
		Name     string `json:"name"`
		SetupID  string `json:"setupId"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	if in.Position == "" {
		in.Position = "lens"
	}
	if in.Position != "lens" && in.Position != "anywhere" {
		return app_errors.BadRequest("position must be lens or anywhere.")
	}
	if _, err := h.Assets.Get(ctx, in.Asset); err != nil {
		return err
	}
	if in.SetupID == "" {
		in.SetupID = h.Show.Get(ctx).ActiveSetupID
	}
	if strings.TrimSpace(in.Name) == "" {
		in.Name = "From photo"
	}
	if in.Position == "lens" {
		if _, err := h.Setups.Merge(ctx, in.SetupID, realtime.Data(map[string]any{"referenceAsset": in.Asset}), middleware.Of(c).By()); err != nil {
			return err
		}
	}
	// the flow exists to map objects from the photo: a mapping scene (mode objects, the mapping-empty template)
	s, err := h.Scenes.Create(ctx, scenessvc.CreateIn{Name: in.Name, SetupID: in.SetupID, Kind: "mapping"})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, s)
}

func (h *Handler) get(c echo.Context) error {
	doc, _, err := h.Scenes.Get(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSONBlob(http.StatusOK, doc)
}

func (h *Handler) rename(c echo.Context) error {
	var in struct {
		Name *string `json:"name"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	if in.Name == nil {
		return app_errors.BadRequest("PATCH /scenes/{id} takes {name}.")
	}
	sum, err := h.Scenes.Rename(c.Request().Context(), c.Param("id"), *in.Name, middleware.Of(c).By())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, sum)
}

func (h *Handler) delete(c echo.Context) error {
	if h.Show.Get(c.Request().Context()).ActiveSceneID == c.Param("id") {
		return app_errors.SceneActive("Activate another scene first.")
	}
	if err := h.Scenes.Delete(c.Request().Context(), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// PatchRequest is POST /scenes/{id}/patch.
type PatchRequest struct {
	Base int64         `json:"base"`
	Ops  []docpatch.Op `json:"ops"`
}

func (h *Handler) patch(c echo.Context) error {
	var in PatchRequest
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	v, err := h.Scenes.Patch(c.Request().Context(), scenessvc.PatchCmd{SceneID: c.Param("id"), Base: in.Base, Ops: in.Ops, By: middleware.Of(c).By()})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]int64{"version": v})
}

func (h *Handler) undo(c echo.Context) error {
	v, err := h.Scenes.Undo(c.Request().Context(), c.Param("id"), middleware.Of(c).By())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]int64{"version": v})
}

func (h *Handler) redo(c echo.Context) error {
	v, err := h.Scenes.Redo(c.Request().Context(), c.Param("id"), middleware.Of(c).By())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]int64{"version": v})
}

func (h *Handler) history(c echo.Context) error {
	l, err := h.Scenes.History(c.Request().Context(), c.Param("id"), httpx.IntQuery(c, "limit", 50))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) presets(c echo.Context) error {
	l, err := h.Presets.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) createPreset(c echo.Context) error {
	var in struct {
		Name    string `json:"name"`
		Mode    string `json:"mode"`
		SceneID string `json:"sceneId"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	if in.SceneID == "" {
		in.SceneID = h.Show.Get(c.Request().Context()).ActiveSceneID
	}
	p, err := h.Presets.Create(c.Request().Context(), in.Name, in.Mode, in.SceneID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, p)
}

func (h *Handler) applyPreset(c echo.Context) error {
	var in struct {
		SceneID string `json:"sceneId"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	if in.SceneID == "" {
		in.SceneID = h.Show.Get(c.Request().Context()).ActiveSceneID
	}
	v, err := h.Presets.Apply(c.Request().Context(), c.Param("id"), in.SceneID, middleware.Of(c).By())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]int64{"version": v})
}

func (h *Handler) deletePreset(c echo.Context) error {
	if err := h.Presets.Delete(c.Request().Context(), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) drafts(c echo.Context) error {
	l, err := h.Drafts.List(c.Request().Context(), c.QueryParam("sceneId"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, httpx.Empty(l))
}

func (h *Handler) createDraft(c echo.Context) error {
	var in struct {
		SceneID string `json:"sceneId"`
		Author  string `json:"author"`
	}
	if err := httpx.Bind(c, &in); err != nil {
		return err
	}
	if in.Author == "" {
		in.Author = "user:" + middleware.Of(c).By()
	}
	d, err := h.Drafts.Create(c.Request().Context(), in.SceneID, in.Author)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, d)
}

func (h *Handler) draft(c echo.Context) error {
	d, err := h.Drafts.Get(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, d)
}

func (h *Handler) draftScene(c echo.Context) error {
	s, err := h.Drafts.View(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	b, _ := json.Marshal(s)
	return c.JSONBlob(http.StatusOK, b)
}

func (h *Handler) applyDraft(c echo.Context) error {
	d, v, err := h.Drafts.Apply(c.Request().Context(), c.Param("id"), middleware.Of(c).By())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"draft": d, "version": v})
}

func (h *Handler) discardDraft(c echo.Context) error {
	d, err := h.Drafts.Discard(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, d)
}
