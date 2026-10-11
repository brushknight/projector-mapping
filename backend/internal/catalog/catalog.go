// Package catalog embeds the built-in catalog (contract/catalog.json), the contract fixtures and the scenery photos.
// `make catalog` copies contract/catalog.json and contract/fixtures/*.json here, since go:embed cannot reach outside
// the module.
package catalog

import (
	"embed"
	"io/fs"
)

//go:embed catalog.json
var JSON []byte

//go:embed fixtures/*.json
var fixtures embed.FS

//go:embed assets
var assets embed.FS

// Fixture returns contract/fixtures/<name>.json.
func Fixture(name string) ([]byte, error) { return fixtures.ReadFile("fixtures/" + name + ".json") }

// Fixtures lists the fixture names (without .json).
func Fixtures() []string {
	ents, _ := fs.ReadDir(fixtures, "fixtures")
	out := make([]string, 0, len(ents))
	for _, e := range ents {
		n := e.Name()
		out = append(out, n[:len(n)-len(".json")])
	}
	return out
}

// Assets is the built-in files served at /catalog/assets/ (scenery/<id>.jpg).
func Assets() fs.FS {
	sub, _ := fs.Sub(assets, "assets")
	return sub
}

//go:embed docs/effects.md
var EffectAPI string
