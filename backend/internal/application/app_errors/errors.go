// Package app_errors holds the errors every layer shares. Each carries the wire code and HTTP status of protocol §2:
// { "code": "not_found", "message": "Scene scn_x does not exist." }.
package app_errors

import (
	"errors"
	"fmt"
	"net/http"
)

// Error is an error with a wire code.
type Error struct {
	Code    string
	Status  int
	Message string
	// Version is set on stale rejections.
	Version int64
}

func (e *Error) Error() string { return e.Message }

// Is matches by code, so errors.Is(err, ErrNotFound) works for any not_found.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

func mk(code string, status int) func(string, ...any) *Error {
	return func(format string, a ...any) *Error {
		return &Error{Code: code, Status: status, Message: fmt.Sprintf(format, a...)}
	}
}

var (
	NotFound     = mk("not_found", http.StatusNotFound)
	BadRequest   = mk("bad_request", http.StatusBadRequest)
	Invalid      = mk("invalid", http.StatusUnprocessableEntity)
	Conflict     = mk("conflict", http.StatusConflict)
	Forbidden    = mk("forbidden", http.StatusForbidden)
	Unauthorized = mk("unauthorized", http.StatusUnauthorized)
	Unavailable  = mk("unavailable", http.StatusServiceUnavailable)
	Timeout      = mk("timeout", http.StatusGatewayTimeout)
	NoScene      = mk("no_scene", http.StatusConflict)
	NoCue        = mk("no_cue", http.StatusConflict)
)

// Stale is the patch rejection of protocol §3.
func Stale(version int64) *Error {
	return &Error{Code: "stale", Status: http.StatusConflict, Version: version,
		Message: fmt.Sprintf("Scene changed; rebase on version %d.", version)}
}

// Sentinels for errors.Is.
var (
	ErrNotFound    = &Error{Code: "not_found"}
	ErrStale       = &Error{Code: "stale"}
	ErrForbidden   = &Error{Code: "forbidden"}
	ErrUnavailable = &Error{Code: "unavailable"}
	ErrTimeout     = &Error{Code: "timeout"}
)

// As returns the *Error in err's chain, or an internal error.
func As(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return &Error{Code: "internal", Status: http.StatusInternalServerError, Message: "Something went wrong on the server."}
}
