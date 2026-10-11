// Package httpx holds what every handler shares.
package httpx

import (
	"encoding/json"
	"io"
	"strconv"

	"github.com/labstack/echo/v4"

	"projmap/internal/application/app_errors"
)

// Bind decodes a JSON body into v; an empty body leaves v as it is.
func Bind(c echo.Context, v any) error {
	b, err := io.ReadAll(io.LimitReader(c.Request().Body, 8<<20))
	if err != nil {
		return app_errors.BadRequest("The body could not be read.")
	}
	if len(b) == 0 {
		return nil
	}
	if err := json.Unmarshal(b, v); err != nil {
		return app_errors.BadRequest("The body is not valid JSON for this route: %v", err)
	}
	return nil
}

// Raw reads the body as JSON bytes ("{}" when empty).
func Raw(c echo.Context) (json.RawMessage, error) {
	b, err := io.ReadAll(io.LimitReader(c.Request().Body, 8<<20))
	if err != nil {
		return nil, app_errors.BadRequest("The body could not be read.")
	}
	if len(b) == 0 {
		return json.RawMessage("{}"), nil
	}
	if !json.Valid(b) {
		return nil, app_errors.BadRequest("The body is not valid JSON.")
	}
	return b, nil
}

// IntQuery reads an integer query parameter.
func IntQuery(c echo.Context, name string, def int) int {
	if v, err := strconv.Atoi(c.QueryParam(name)); err == nil {
		return v
	}
	return def
}

// Empty is a list that encodes as [] when nil.
func Empty[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}
