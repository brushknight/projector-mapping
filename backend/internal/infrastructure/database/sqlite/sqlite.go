// Package sqlite opens the data folder's projmap.db with the pure-Go driver and migrates it with goose.
package sqlite

import (
	"fmt"

	"github.com/glebarez/sqlite"
	"github.com/pressly/goose/v3"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"projmap/internal/infrastructure/database/migrations"
)

// Open opens (and creates) the database at path and runs the migrations.
func Open(path string) (*gorm.DB, error) {
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1) // SQLite has one writer; one connection keeps writes serialized
	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("sqlite3"); err != nil {
		return nil, err
	}
	if err := goose.Up(sqlDB, "."); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}
