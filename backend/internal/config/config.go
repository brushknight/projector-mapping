// Package config is projmap's configuration: environment variables with defaults.
package config

import (
	"os"
	"path/filepath"
	"strconv"
)

// Version is the server build (set with -ldflags "-X projmap/internal/config.Version=…").
var Version = "0.1.0"

// Config is the server configuration.
type Config struct {
	// DataDir holds projmap.db and assets/ (PROJMAP_DATA, default ~/Library/Application Support/projmap).
	DataDir string
	// Port is the HTTP and WebSocket port (PROJMAP_PORT, default 7400).
	Port int
	// Bind is the listen address (PROJMAP_BIND, default all interfaces so the phone can reach it).
	Bind string
	// Bonjour advertises _projmap._tcp (PROJMAP_BONJOUR=0 turns it off).
	Bonjour bool
	// Seed fills an empty database with the desk setup, scene and presets (PROJMAP_SEED=0 turns it off).
	Seed bool
}

// DefaultDataDir is ~/Library/Application Support/projmap.
func DefaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".projmap"
	}
	return filepath.Join(home, "Library", "Application Support", "projmap")
}

// Load reads the environment.
func Load() Config {
	c := Config{DataDir: DefaultDataDir(), Port: 7400, Bind: "0.0.0.0", Bonjour: true, Seed: true}
	if v := os.Getenv("PROJMAP_DATA"); v != "" {
		c.DataDir = v
	}
	if v, err := strconv.Atoi(os.Getenv("PROJMAP_PORT")); err == nil && v > 0 {
		c.Port = v
	}
	if v := os.Getenv("PROJMAP_BIND"); v != "" {
		c.Bind = v
	}
	if os.Getenv("PROJMAP_BONJOUR") == "0" {
		c.Bonjour = false
	}
	if os.Getenv("PROJMAP_SEED") == "0" {
		c.Seed = false
	}
	return c
}
