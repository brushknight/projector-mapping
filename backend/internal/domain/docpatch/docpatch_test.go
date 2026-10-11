package docpatch

import (
	"encoding/json"
	"reflect"
	"testing"
)

func eq(t *testing.T, a, b []byte) {
	t.Helper()
	var x, y any
	_ = json.Unmarshal(a, &x)
	_ = json.Unmarshal(b, &y)
	if !reflect.DeepEqual(x, y) {
		t.Fatalf("documents differ:\n%s\n%s", a, b)
	}
}

func TestApplyAndInverse(t *testing.T) {
	doc := []byte(`{"name":"a","points":[{"id":"p1","x":1},{"id":"p2","x":2}],"m":{"k":1}}`)
	cases := [][]Op{
		{Replace("/name", "b")},
		{Add("/points/-", map[string]any{"id": "p3", "x": 3})},
		{Add("/points/0", map[string]any{"id": "p0", "x": 0})},
		{Remove("/points/1")},
		{Add("/m/k", 5), Add("/m/j", 6)},
		{{Op: "move", From: "/points/0", Path: "/points/1"}},
		{Replace("/points/0/x", 9), Remove("/points/1"), Add("/points/-", map[string]any{"id": "p9"})},
	}
	for i, ops := range cases {
		out, inv, err := Apply(doc, ops)
		if err != nil {
			t.Fatalf("case %d: %v", i, err)
		}
		back, err := ApplyPlain(out, inv)
		if err != nil {
			t.Fatalf("case %d inverse: %v", i, err)
		}
		eq(t, back, doc)
	}
}

func TestLeafOnly(t *testing.T) {
	doc := []byte(`{"a":{"b":1},"c":[1,2]}`)
	if !LeafOnly(doc, []Op{Replace("/a/b", 2), Replace("/c/0", 3)}) {
		t.Fatal("scalar replaces are leaf-only")
	}
	if LeafOnly(doc, []Op{Replace("/a", map[string]any{})}) {
		t.Fatal("replacing an object is structural")
	}
	if LeafOnly(doc, []Op{Add("/c/-", 1)}) {
		t.Fatal("add is structural")
	}
	if LeafOnly(doc, []Op{Replace("/x", 1)}) {
		t.Fatal("missing path is not leaf")
	}
}

func TestErrors(t *testing.T) {
	if _, _, err := Apply([]byte(`{"a":1}`), []Op{Replace("/b", 1)}); err == nil {
		t.Fatal("replace of a missing path must fail")
	}
	if _, _, err := Apply([]byte(`{"a":1}`), []Op{Replace("", 1)}); err == nil {
		t.Fatal("root replace must fail")
	}
}
