// Package shared holds what every SQL repository uses.
package shared

import (
	"errors"

	"gorm.io/gorm"

	"projmap/internal/application/app_errors"
)

// NotFound maps gorm's not-found to the app error.
func NotFound(err error, format string, a ...any) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return app_errors.NotFound(format, a...)
	}
	return err
}
