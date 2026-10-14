package faces

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	"projmap/internal/application/services/assets/assetsvc"
	"projmap/internal/domain/docpatch"
	"projmap/internal/domain/scene"
	"projmap/internal/domain/unfold"
	"projmap/internal/infrastructure/mcp/tools"
)

// MaxUpload is the largest picture asset_upload takes.
const MaxUpload = 16 << 20

// layerFields are the content layer fields a tool can set (nil = keep or default).
type layerFields struct {
	Name        *string              `json:"name,omitempty"`
	Visible     *bool                `json:"visible,omitempty"`
	Opacity     *float64             `json:"opacity,omitempty" jsonschema:"0..1, default 1"`
	Blend       *string              `json:"blend,omitempty" jsonschema:"normal (default), multiply, screen or add"`
	X           *float64             `json:"x,omitempty" jsonschema:"shift right in canvas fractions (-10..10), default 0"`
	Y           *float64             `json:"y,omitempty" jsonschema:"shift down in canvas fractions (-10..10), default 0"`
	Scale       *float64             `json:"scale,omitempty" jsonschema:"0.01..100 about the centre, default 1"`
	Rotation    *float64             `json:"rotation,omitempty" jsonschema:"degrees clockwise, default 0"`
	Reveal      *float64             `json:"reveal,omitempty" jsonschema:"0..1 wipe, default 1 (all shown)"`
	RevealAngle *float64             `json:"reveal_angle,omitempty" jsonschema:"wipe direction in degrees, 0 = left to right"`
	Src         *string              `json:"src,omitempty" jsonschema:"media: asset:<sha> (asset_upload) or a scenery id"`
	Media       *string              `json:"media,omitempty" jsonschema:"media: image (default) or video"`
	Fit         *string              `json:"fit,omitempty" jsonschema:"media: fill (cover, default), fit (contain) or stretch"`
	Crop        *scene.Crop          `json:"crop,omitempty" jsonschema:"media: {x, y, w, h} of the source in fractions"`
	Stops       []scene.GradientStop `json:"stops,omitempty" jsonschema:"gradient: 1..8 stops [{color: #rrggbb, pos: 0..1}]"`
	Angle       *float64             `json:"angle,omitempty" jsonschema:"gradient: degrees, 0 = left to right"`
	Offset      *float64             `json:"offset,omitempty" jsonschema:"gradient: shift in gradient lengths (-10..10)"`
	Repeat      *bool                `json:"repeat,omitempty" jsonschema:"gradient: tile it"`
}

func (f layerFields) apply(l *scene.ContentLayer) {
	set := func(dst *float64, v *float64) {
		if v != nil {
			*dst = *v
		}
	}
	if f.Name != nil {
		l.Name = *f.Name
	}
	if f.Visible != nil {
		l.Visible = *f.Visible
	}
	set(&l.Opacity, f.Opacity)
	if f.Blend != nil {
		l.Blend = *f.Blend
	}
	set(&l.X, f.X)
	set(&l.Y, f.Y)
	set(&l.Scale, f.Scale)
	set(&l.Rotation, f.Rotation)
	set(&l.Reveal, f.Reveal)
	set(&l.RevealAngle, f.RevealAngle)
	if f.Src != nil {
		l.Src = normSrc(*f.Src)
	}
	if f.Media != nil {
		l.Media = *f.Media
	}
	if f.Fit != nil {
		l.Fit = *f.Fit
	}
	if f.Crop != nil {
		l.Crop = f.Crop
	}
	if f.Stops != nil {
		l.Stops = f.Stops
	}
	if f.Angle != nil {
		l.Angle = f.Angle
	}
	if f.Offset != nil {
		l.Offset = f.Offset
	}
	if f.Repeat != nil {
		l.Repeat = f.Repeat
	}
}

var shaRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

func normSrc(s string) string {
	s = strings.TrimSpace(s)
	if shaRe.MatchString(s) {
		return "asset:" + s
	}
	return s
}

type layerAddIn struct {
	TargetKind string `json:"target_kind" jsonschema:"surface (the face's UV square) or object (across its atlas)"`
	TargetID   string `json:"target_id" jsonschema:"surface or object id (or name)"`
	Kind       string `json:"kind" jsonschema:"media or gradient"`
	layerFields
}

// layerTarget is where a layer list lives: its JSON pointer and current layers.
func layerTarget(sc *scene.Scene, kind, id string) (string, []scene.ContentLayer, *scene.Object, error) {
	switch kind {
	case "surface":
		o, sf, err := findSurface(sc, id)
		if err != nil {
			return "", nil, nil, err
		}
		if sf.Kind == "line" || sf.Kind == "mask" {
			return "", nil, nil, app_errors.BadRequest("%s is a %s; lines and masks draw no layers.", sf.ID, sf.Kind)
		}
		oi, si := surfaceIndex(sc, sf.ID)
		return fmt.Sprintf("/objects/%d/surfaces/%d/layers", oi, si), sf.Layers, o, nil
	case "object":
		o, err := findObject(sc, id)
		if err != nil {
			return "", nil, nil, err
		}
		return fmt.Sprintf("/objects/%d/layers", sc.FindObject(o.ID)), o.Layers, o, nil
	}
	return "", nil, nil, app_errors.BadRequest("target_kind must be surface or object.")
}

func layerAdd(ctx context.Context, e *tools.Env, in layerAddIn) (*mcp.CallToolResult, error) {
	sc, draft, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	path, list, o, err := layerTarget(sc, in.TargetKind, in.TargetID)
	if err != nil {
		return nil, err
	}
	l := scene.ContentLayer{ID: newID("cl"), Kind: in.Kind, Visible: true, Opacity: 1, Blend: "normal", Scale: 1, Reveal: 1}
	switch in.Kind {
	case scene.ContentMedia:
		l.Name, l.Media, l.Fit = "picture", "image", "fill"
	case scene.ContentGradient:
		l.Name = "gradient"
	default:
		return nil, app_errors.BadRequest("kind must be media (a picture) or gradient.")
	}
	in.apply(&l)
	if l.Kind == scene.ContentMedia {
		if l.Src == "" {
			return nil, app_errors.BadRequest("A media layer needs src: asset:<sha> from asset_upload, or a scenery id.")
		}
		if sha, ok := strings.CutPrefix(l.Src, "asset:"); ok {
			a, err := e.D.Assets.Get(ctx, sha)
			if err != nil {
				return nil, app_errors.NotFound("Asset %s does not exist. Upload it with asset_upload first.", sha)
			}
			if in.Media == nil && strings.HasPrefix(a.Mime, "video/") {
				l.Media = "video"
			}
		}
	}
	if l.Kind == scene.ContentGradient && len(l.Stops) == 0 {
		return nil, app_errors.BadRequest("A gradient layer needs stops, for example [{\"color\": \"#000000\", \"pos\": 0}, {\"color\": \"#ff3b30\", \"pos\": 1}].")
	}
	var ops []docpatch.Op
	if len(list) == 0 {
		ops = append(ops, docpatch.Add(path, []scene.ContentLayer{l}))
	} else {
		ops = append(ops, docpatch.Add(path+"/-", l))
	}
	if in.TargetKind == "object" && o.Atlas == nil {
		// pin the layout so the artwork stays put when the mapping moves (as the editor does)
		a := unfold.AutoAtlas(sc, o)
		ops = append(ops, docpatch.Add(fmt.Sprintf("/objects/%d/atlas", sc.FindObject(o.ID)), a))
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Added %s layer %s (%q) to %s %s in your draft %s. Look with face_render or object_unfold_render.", l.Kind, l.ID, l.Name, in.TargetKind, in.TargetID, draft), nil
}

// findLayer finds a content layer by id: its pointer and value.
func findLayer(sc *scene.Scene, id string) (string, scene.ContentLayer, error) {
	for oi := range sc.Objects {
		o := &sc.Objects[oi]
		for i, l := range o.Layers {
			if l.ID == id {
				return fmt.Sprintf("/objects/%d/layers/%d", oi, i), l, nil
			}
		}
		for si := range o.Surfaces {
			for i, l := range o.Surfaces[si].Layers {
				if l.ID == id {
					return fmt.Sprintf("/objects/%d/surfaces/%d/layers/%d", oi, si, i), l, nil
				}
			}
		}
	}
	return "", scene.ContentLayer{}, app_errors.NotFound("Content layer %s does not exist. object_unfold_get and face_get list the layers.", id)
}

type layerUpdateIn struct {
	LayerID string `json:"layer_id" jsonschema:"the content layer's id"`
	layerFields
}

func layerUpdate(ctx context.Context, e *tools.Env, in layerUpdateIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	path, l, err := findLayer(sc, in.LayerID)
	if err != nil {
		return nil, err
	}
	in.apply(&l)
	if err := e.Write(ctx, []docpatch.Op{docpatch.Replace(path, l)}); err != nil {
		return nil, err
	}
	return tools.Text("Updated layer %s in your draft.", l.ID), nil
}

type layerRemoveIn struct {
	LayerID string `json:"layer_id" jsonschema:"the content layer's id"`
}

func layerRemove(ctx context.Context, e *tools.Env, in layerRemoveIn) (*mcp.CallToolResult, error) {
	sc, _, err := e.WriteView(ctx)
	if err != nil {
		return nil, err
	}
	path, l, err := findLayer(sc, in.LayerID)
	if err != nil {
		return nil, err
	}
	ops := []docpatch.Op{docpatch.Remove(path)}
	// tracks that animate the layer go too, with their clips (highest index first)
	tracks := map[string]bool{}
	for i := len(sc.Timeline.Tracks) - 1; i >= 0; i-- {
		tr := sc.Timeline.Tracks[i]
		if tr.Target.Kind == "layer" && tr.Target.ID != nil && *tr.Target.ID == l.ID {
			tracks[tr.ID] = true
		}
	}
	for i := len(sc.Timeline.Clips) - 1; i >= 0; i-- {
		if tracks[sc.Timeline.Clips[i].TrackID] {
			ops = append(ops, docpatch.Remove(fmt.Sprintf("/timeline/clips/%d", i)))
		}
	}
	for i := len(sc.Timeline.Tracks) - 1; i >= 0; i-- {
		if tracks[sc.Timeline.Tracks[i].ID] {
			ops = append(ops, docpatch.Remove(fmt.Sprintf("/timeline/tracks/%d", i)))
		}
	}
	if err := e.Write(ctx, ops); err != nil {
		return nil, err
	}
	return tools.Text("Removed layer %s (%q) from your draft.", l.ID, l.Name), nil
}

// ---------------------------------------------------------------- asset_upload

type uploadIn struct {
	DataBase64 string `json:"data_base64,omitempty" jsonschema:"the file as base64 (a data: URL works too)"`
	Path       string `json:"path,omitempty" jsonschema:"a PNG, JPEG or SVG file under your home folder on this Mac (~ works)"`
}

var svgRootTag = regexp.MustCompile(`(?is)<svg\b[^>]*>`)
var svgHasSize = regexp.MustCompile(`(?is)\s(width|height)\s*=`)

// homeDir is the folder asset_upload may read from (a var for tests).
var homeDir = os.UserHomeDir

// readLocal reads a file under the user's home folder.
func readLocal(p string) ([]byte, error) {
	home, err := homeDir()
	if err != nil {
		return nil, app_errors.Forbidden("This server has no home folder to read from.")
	}
	if p == "~" || strings.HasPrefix(p, "~/") {
		p = filepath.Join(home, strings.TrimPrefix(p, "~"))
	}
	if !filepath.IsAbs(p) {
		return nil, app_errors.BadRequest("path must be absolute (or start with ~/).")
	}
	real, err := filepath.EvalSymlinks(p)
	if err != nil {
		return nil, app_errors.NotFound("%s does not exist.", p)
	}
	realHome, err := filepath.EvalSymlinks(home)
	if err != nil {
		realHome = home
	}
	rel, err := filepath.Rel(realHome, real)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil, app_errors.Forbidden("%s is outside your home folder (%s); projmap only reads files there.", p, home)
	}
	st, err := os.Stat(real)
	if err != nil || !st.Mode().IsRegular() {
		return nil, app_errors.BadRequest("%s is not a file.", p)
	}
	if st.Size() > MaxUpload {
		return nil, app_errors.BadRequest("%s is %d MB; the limit is %d MB.", p, st.Size()>>20, MaxUpload>>20)
	}
	f, err := os.Open(real)
	if err != nil {
		return nil, app_errors.Forbidden("%s cannot be read: %v", p, err)
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, MaxUpload+1))
}

func assetUpload(ctx context.Context, e *tools.Env, in uploadIn) (*mcp.CallToolResult, error) {
	var data []byte
	switch {
	case in.DataBase64 != "" && in.Path != "":
		return nil, app_errors.BadRequest("Pass data_base64 or path, not both.")
	case in.DataBase64 != "":
		s := strings.TrimSpace(in.DataBase64)
		if strings.HasPrefix(s, "data:") {
			if i := strings.Index(s, ","); i > 0 {
				s = s[i+1:]
			}
		}
		if len(s) > MaxUpload*4/3+16 {
			return nil, app_errors.BadRequest("The picture is larger than %d MB.", MaxUpload>>20)
		}
		s = strings.Map(func(r rune) rune {
			if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
				return -1
			}
			return r
		}, s)
		b, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			if b, err = base64.RawStdEncoding.DecodeString(s); err != nil {
				return nil, app_errors.BadRequest("data_base64 is not valid base64 (%v).", err)
			}
		}
		data = b
	case in.Path != "":
		if !e.S.P.Local {
			return nil, app_errors.Forbidden("Only a client on this Mac can upload by path; send data_base64 instead.")
		}
		b, err := readLocal(strings.TrimSpace(in.Path))
		if err != nil {
			return nil, err
		}
		data = b
	default:
		return nil, app_errors.BadRequest("Pass data_base64 (the file as base64) or path (a file under your home folder).")
	}
	if len(data) == 0 {
		return nil, app_errors.BadRequest("The picture is empty.")
	}
	if len(data) > MaxUpload {
		return nil, app_errors.BadRequest("The picture is larger than %d MB.", MaxUpload>>20)
	}
	mime := assetsvc.Sniff(data)
	switch mime {
	case "image/png", "image/jpeg":
		if _, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil {
			return nil, app_errors.BadRequest("The %s does not decode (%v).", mime, err)
		}
	case "image/svg+xml":
		w, h := assetsvc.SVGSize(data)
		if w == 0 || h == 0 {
			return nil, app_errors.BadRequest("The SVG needs width and height (in px) or a viewBox on its <svg> root.")
		}
		if root := svgRootTag.Find(data); root != nil && len(svgHasSize.FindAll(root, -1)) < 2 {
			// give the root an explicit size, so every browser knows its aspect
			sized := svgOpen.ReplaceAll(sizeAttr.ReplaceAll(root, nil), []byte(fmt.Sprintf(`<svg width="%d" height="%d"`, w, h)))
			data = bytes.Replace(data, root, sized, 1)
		}
	default:
		return nil, app_errors.BadRequest("That is %s; asset_upload takes PNG, JPEG or SVG.", mime)
	}
	a, err := e.D.Assets.Upload(ctx, data, "photo")
	if err != nil {
		return nil, err
	}
	return tools.JSON(fmt.Sprintf("Stored %s %d×%d as asset %s. Use src \"asset:%s\" in layer_add.", a.Mime, a.Width, a.Height, a.SHA, a.SHA),
		map[string]any{"sha": a.SHA, "src": "asset:" + a.SHA, "mime": a.Mime, "width": a.Width, "height": a.Height, "bytes": a.Bytes}), nil
}

var (
	sizeAttr = regexp.MustCompile(`(?is)\s(width|height)\s*=\s*["'][^"']*["']`)
	svgOpen  = regexp.MustCompile(`(?i)^<svg`)
)
