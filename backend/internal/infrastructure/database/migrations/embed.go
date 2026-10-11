// Package migrations holds the versioned schema (goose), the schema's source of truth.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
