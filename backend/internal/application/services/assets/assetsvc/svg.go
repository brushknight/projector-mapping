package assetsvc

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
)

var (
	svgRoot    = regexp.MustCompile(`(?is)<svg\b[^>]*>`)
	svgAttr    = regexp.MustCompile(`(?is)\s(width|height|viewBox)\s*=\s*["']([^"']*)["']`)
	svgLeading = regexp.MustCompile(`(?s)^(\s|<\?xml[^>]*\?>|<!--.*?-->|<!DOCTYPE[^>]*>)*`)
)

// IsSVG tells whether b is an SVG document: an <svg> root after an optional XML declaration, comments and doctype.
func IsSVG(b []byte) bool {
	head := b
	if len(head) > 4096 {
		head = head[:4096]
	}
	head = bytes.TrimPrefix(head, []byte("\xef\xbb\xbf"))
	rest := head[len(svgLeading.Find(head)):]
	return len(rest) >= 4 && strings.EqualFold(string(rest[:4]), "<svg")
}

// SVGSize reads the root's width and height (in px, or plain numbers), falling back to the viewBox; 0 when unknown.
func SVGSize(b []byte) (int, int) {
	root := svgRoot.Find(b)
	if root == nil {
		return 0, 0
	}
	var w, h float64
	var vb []float64
	for _, m := range svgAttr.FindAllSubmatch(root, -1) {
		v := strings.TrimSpace(string(m[2]))
		switch strings.ToLower(string(m[1])) {
		case "width":
			w = svgLength(v)
		case "height":
			h = svgLength(v)
		case "viewbox":
			for _, f := range strings.FieldsFunc(v, func(r rune) bool { return r == ' ' || r == ',' }) {
				if x, err := strconv.ParseFloat(f, 64); err == nil {
					vb = append(vb, x)
				}
			}
		}
	}
	if (w <= 0 || h <= 0) && len(vb) == 4 && vb[2] > 0 && vb[3] > 0 {
		switch {
		case w > 0:
			h = w * vb[3] / vb[2]
		case h > 0:
			w = h * vb[2] / vb[3]
		default:
			w, h = vb[2], vb[3]
		}
	}
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	return int(w + 0.5), int(h + 0.5)
}

// svgLength parses "120", "120px" or "120.5"; other units (%, em, mm) count as unknown.
func svgLength(v string) float64 {
	v = strings.TrimSuffix(strings.TrimSpace(v), "px")
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f <= 0 {
		return 0
	}
	return f
}
