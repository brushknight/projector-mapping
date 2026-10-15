// Package docpatch applies RFC 6902 JSON Patches to JSON documents and computes the inverse patch, so every change
// can be undone. It also answers the protocol's "only replaces leaf values" question for the stale-base rule.
package docpatch

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	jsonpatch "github.com/evanphx/json-patch/v5"
)

// Op is one JSON Patch operation.
type Op struct {
	Op    string          `json:"op"`
	Path  string          `json:"path"`
	From  string          `json:"from,omitempty"`
	Value json.RawMessage `json:"value,omitempty"`
}

// MarshalJSON keeps "value" for add/replace/test even when it is JSON null.
func (o Op) MarshalJSON() ([]byte, error) {
	m := map[string]any{"op": o.Op, "path": o.Path}
	if o.From != "" {
		m["from"] = o.From
	}
	switch o.Op {
	case "add", "replace", "test":
		if len(o.Value) == 0 {
			m["value"] = nil
		} else {
			m["value"] = o.Value
		}
	}
	return json.Marshal(m)
}

// Replace is a replace op.
func Replace(path string, v any) Op { return Op{Op: "replace", Path: path, Value: raw(v)} }

// Add is an add op.
func Add(path string, v any) Op { return Op{Op: "add", Path: path, Value: raw(v)} }

// Remove is a remove op.
func Remove(path string) Op { return Op{Op: "remove", Path: path} }

func raw(v any) json.RawMessage {
	if r, ok := v.(json.RawMessage); ok {
		return r
	}
	b, _ := json.Marshal(v)
	return b
}

// ErrTestFailed is returned (wrapped) when a test op does not hold: the document is not what the sender expected
// (for example a point index that now names another point), so nothing is applied.
var ErrTestFailed = errors.New("the document does not match the expected value")

// Apply applies ops to doc and returns the new document and the inverse ops (which, applied to the result, give the
// original document back).
func Apply(doc []byte, ops []Op) (out []byte, inverse []Op, err error) {
	cur := doc
	inverse = make([]Op, 0, len(ops))
	for i, op := range ops {
		inv, err := invert(cur, op)
		if err != nil {
			return nil, nil, fmt.Errorf("op %d (%s %s): %w", i, op.Op, op.Path, err)
		}
		next, err := applyOne(cur, op)
		if err != nil {
			if op.Op == "test" {
				return nil, nil, fmt.Errorf("op %d (test %s): %w", i, op.Path, ErrTestFailed)
			}
			return nil, nil, fmt.Errorf("op %d (%s %s): %w", i, op.Op, op.Path, err)
		}
		inverse = append(inverse, inv...)
		cur = next
	}
	// the inverse runs in reverse order
	for l, r := 0, len(inverse)-1; l < r; l, r = l+1, r-1 {
		inverse[l], inverse[r] = inverse[r], inverse[l]
	}
	return cur, inverse, nil
}

// ApplyPlain applies ops without computing an inverse.
func ApplyPlain(doc []byte, ops []Op) ([]byte, error) {
	b, err := json.Marshal(ops)
	if err != nil {
		return nil, err
	}
	p, err := jsonpatch.DecodePatch(b)
	if err != nil {
		return nil, err
	}
	return p.ApplyWithOptions(doc, opts())
}

func opts() *jsonpatch.ApplyOptions {
	o := jsonpatch.NewApplyOptions()
	o.EnsurePathExistsOnAdd = false
	return o
}

func applyOne(doc []byte, op Op) ([]byte, error) {
	if op.Path == "" && (op.Op == "replace" || op.Op == "add") {
		return nil, fmt.Errorf("replacing the whole document is not allowed")
	}
	return ApplyPlain(doc, []Op{op})
}

// invert returns the ops that undo op on doc.
func invert(doc []byte, op Op) ([]Op, error) {
	var root any
	if err := json.Unmarshal(doc, &root); err != nil {
		return nil, err
	}
	switch op.Op {
	case "replace":
		old, err := Get(root, op.Path)
		if err != nil {
			return nil, err
		}
		return []Op{Replace(op.Path, old)}, nil
	case "remove":
		old, err := Get(root, op.Path)
		if err != nil {
			return nil, err
		}
		return []Op{Add(op.Path, old)}, nil
	case "add":
		parentPath, last := split(op.Path)
		parent, err := Get(root, parentPath)
		if err != nil {
			return nil, err
		}
		switch p := parent.(type) {
		case []any:
			if last == "-" {
				return []Op{Remove(parentPath + "/" + strconv.Itoa(len(p)))}, nil
			}
			return []Op{Remove(op.Path)}, nil
		case map[string]any:
			if old, ok := p[unescape(last)]; ok {
				return []Op{Replace(op.Path, old)}, nil
			}
			return []Op{Remove(op.Path)}, nil
		}
		return nil, fmt.Errorf("parent is not a container")
	case "test":
		return nil, nil
	case "move", "copy":
		// undo by restoring the top-level members both paths touch
		var out []Op
		seen := map[string]bool{}
		for _, p := range []string{op.From, op.Path} {
			top := topLevel(p)
			if top == "" || seen[top] {
				continue
			}
			seen[top] = true
			old, err := Get(root, top)
			if err != nil {
				return nil, err
			}
			out = append(out, Replace(top, old))
		}
		return out, nil
	}
	return nil, fmt.Errorf("unknown op %q", op.Op)
}

func topLevel(p string) string {
	if p == "" {
		return ""
	}
	parts := strings.SplitN(strings.TrimPrefix(p, "/"), "/", 2)
	return "/" + parts[0]
}

func split(p string) (string, string) {
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return "", p
	}
	return p[:i], p[i+1:]
}

func unescape(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~1", "/"), "~0", "~")
}

// Escape escapes a JSON Pointer token.
func Escape(s string) string { return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1") }

// Get resolves a JSON Pointer in a decoded document.
func Get(root any, ptr string) (any, error) {
	if ptr == "" {
		return root, nil
	}
	if !strings.HasPrefix(ptr, "/") {
		return nil, fmt.Errorf("path %q must start with /", ptr)
	}
	cur := root
	for _, tok := range strings.Split(ptr[1:], "/") {
		tok = unescape(tok)
		switch c := cur.(type) {
		case map[string]any:
			v, ok := c[tok]
			if !ok {
				return nil, fmt.Errorf("path %s does not exist", ptr)
			}
			cur = v
		case []any:
			i, err := strconv.Atoi(tok)
			if err != nil || i < 0 || i >= len(c) {
				return nil, fmt.Errorf("path %s does not exist", ptr)
			}
			cur = c[i]
		default:
			return nil, fmt.Errorf("path %s does not exist", ptr)
		}
	}
	return cur, nil
}

// GetRaw resolves a JSON Pointer in a JSON document.
func GetRaw(doc []byte, ptr string) (any, error) {
	var root any
	if err := json.Unmarshal(doc, &root); err != nil {
		return nil, err
	}
	return Get(root, ptr)
}

// LeafOnly tells whether every op replaces an existing scalar with a scalar (the protocol's stale-base exception).
func LeafOnly(doc []byte, ops []Op) bool {
	if len(ops) == 0 {
		return true
	}
	var root any
	if err := json.Unmarshal(doc, &root); err != nil {
		return false
	}
	for _, op := range ops {
		if op.Op == "test" {
			// a guard, not a change: it holds or the whole patch fails
			continue
		}
		if op.Op != "replace" || isContainer(op.Value) {
			return false
		}
		old, err := Get(root, op.Path)
		if err != nil {
			return false
		}
		switch old.(type) {
		case map[string]any, []any:
			return false
		}
	}
	return true
}

func isContainer(v json.RawMessage) bool {
	t := bytes.TrimSpace(v)
	return len(t) > 0 && (t[0] == '{' || t[0] == '[')
}

// Touches tells whether any op writes to path or below it.
func Touches(ops []Op, path string) bool {
	for _, op := range ops {
		for _, p := range []string{op.Path, op.From} {
			if p != "" && (p == path || strings.HasPrefix(p, path+"/") || strings.HasPrefix(path, p+"/")) {
				return true
			}
		}
	}
	return false
}
