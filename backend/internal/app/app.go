// Package app wires everything together: the database, one module per section (repositories, services, handlers),
// the realtime hub, the MCP server, Bonjour and the web app.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	agentport "projmap/internal/application/ports/out/agents"
	"projmap/internal/application/services"
	"projmap/internal/catalog"
	"projmap/internal/config"
	showsql "projmap/internal/infrastructure/database/sql/show"
	"projmap/internal/infrastructure/database/sqlite"
	"projmap/internal/infrastructure/discovery"
	httpserver "projmap/internal/infrastructure/http_server"
	"projmap/internal/infrastructure/http_server/middleware"
	"projmap/internal/infrastructure/mcp"
	"projmap/internal/infrastructure/mcp/tools"
	"projmap/internal/infrastructure/realtime/hub"
	"projmap/internal/web"
)

// Options change how the app starts (tests).
type Options struct {
	Config config.Config
	Log    *slog.Logger
	// Runner replaces the agent CLI runner.
	Runner agentport.Runner
	// MCPURL is where agents reach /mcp (default http://127.0.0.1:<port>/mcp).
	MCPURL string
}

// App is the running server.
type App struct {
	cfg config.Config
	log *slog.Logger
	db  *gorm.DB
	Hub *hub.Hub
	e   *echo.Echo
	srv *http.Server

	Setups   *SetupsModule
	Catalog  *CatalogModule
	Scenes   *ScenesModule
	Show     *ShowModule
	Assets   *AssetsModule
	Devices  *DevicesModule
	Camera   *CameraModule
	Agents   *AgentsModule
	ServerID string

	stopBonjour func()
}

// New opens the data folder and builds every module.
func New(ctx context.Context, o Options) (*App, error) {
	cfg, log := o.Config, o.Log
	if log == nil {
		log = slog.Default()
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("data folder: %w", err)
	}
	db, err := sqlite.Open(filepath.Join(cfg.DataDir, "projmap.db"))
	if err != nil {
		return nil, err
	}
	a := &App{cfg: cfg, log: log, db: db, Hub: hub.New(log)}
	kv := showsql.New(db)
	if a.ServerID, err = serverID(ctx, kv); err != nil {
		return nil, err
	}
	pub := a.Hub
	if a.Catalog, err = NewCatalogModule(ctx, db); err != nil {
		return nil, err
	}
	a.Setups = NewSetupsModule(db, pub, log)
	a.Scenes = NewScenesModule(db, a.Catalog.Service, pub, log)
	a.Setups.Service.InUse = a.Scenes.SetupInUse
	if _, err := a.Scenes.Service.UpgradeStored(ctx); err != nil {
		return nil, fmt.Errorf("upgrade scenes: %w", err)
	}
	if err := a.Setups.Service.ExpireTestPatterns(ctx); err != nil {
		return nil, fmt.Errorf("test patterns: %w", err)
	}
	seeded := false
	if cfg.Seed {
		if seeded, err = Seed(ctx, a.Setups, a.Scenes, a.Catalog.Service.Catalog()); err != nil {
			return nil, fmt.Errorf("seed: %w", err)
		}
	}
	if a.Show, err = NewShowModule(ctx, kv, a.Scenes.Service, pub, log, seeded); err != nil {
		return nil, err
	}
	a.Assets = NewAssetsModule(db, filepath.Join(cfg.DataDir, "assets"))
	a.Devices = NewDevicesModule(db, pub, a.Hub, cfg.Port)
	a.Camera = NewCameraModule(db, a.Hub, a.Assets.Service, a.Setups.Service, a.Show.Service, log)
	mcpURL := o.MCPURL
	if mcpURL == "" {
		mcpURL = fmt.Sprintf("http://127.0.0.1:%d/mcp", cfg.Port)
	}
	self, _ := os.Executable()
	workDir := filepath.Join(cfg.DataDir, "agents")
	_ = os.MkdirAll(workDir, 0o755)
	a.Agents = NewAgentsModule(ctx, db, kv, a.Scenes.Drafts, a.Devices.Service, a.Show.Service, o.Runner, pub, log,
		AgentConfig{MCPURL: mcpURL, Self: self, WorkDir: workDir})
	a.Hub.SetServices(hub.Services{Devices: a.Devices.Service, Scenes: a.Scenes.Service, Drafts: a.Scenes.Drafts,
		Presets: a.Scenes.Presets, Setups: a.Setups.Service, Show: a.Show.Service, Agents: a.Agents.Service,
		Calibrations: a.Camera.Calibrations, Camera: a.Camera.Camera, CatalogVersion: a.Catalog.Service.Catalog().Version})

	a.e = httpserver.New(log)
	public := a.e.Group("/api/v1")
	api := a.e.Group("/api/v1", middleware.Auth(a.Devices.Service))
	a.Devices.Register(public, api)
	a.Catalog.Register(api)
	a.Setups.Register(api)
	a.Scenes.Register(api, a.Setups.Service, a.Show.Service, a.Assets.Service)
	a.Show.Register(api)
	a.Assets.Register(a.e, api)
	a.Camera.Register(api, a.Show.Service)
	a.Agents.Register(api)
	a.e.Any("/ws", echo.WrapHandler(a.Hub))
	mh := mcp.Handler(&tools.Deps{Scenes: a.Scenes.Service, Drafts: a.Scenes.Drafts, Presets: a.Scenes.Presets, Setups: a.Setups.Service,
		Show: a.Show.Service, Catalog: a.Catalog.Service, Assets: a.Assets.Service, Agents: a.Agents.Service, Camera: a.Camera.Camera,
		Calibrations: a.Camera.Calibrations, Caller: a.Hub, EffectAPI: catalog.EffectAPI, Port: cfg.Port}, a.Devices.Service)
	a.e.Any("/mcp", echo.WrapHandler(mh))
	a.e.Any("/mcp/*", echo.WrapHandler(mh))
	webApp := web.Handler()
	a.e.GET("/*", func(c echo.Context) error {
		p := c.Request().URL.Path
		if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/a/") || strings.HasPrefix(p, "/catalog/") {
			return echo.ErrNotFound
		}
		webApp.ServeHTTP(c.Response(), c.Request())
		return nil
	})
	return a, nil
}

func serverID(ctx context.Context, kv *showsql.Repository) (string, error) {
	b, err := kv.Get(ctx, "server_id")
	if err != nil {
		return "", err
	}
	if b != nil {
		return string(b), nil
	}
	id := strings.TrimPrefix(services.NewID("srv"), "srv_")
	return id, kv.Put(ctx, "server_id", []byte(id))
}

// Handler is the whole HTTP surface (REST, /ws, /mcp, assets, the web app).
func (a *App) Handler() http.Handler { return a.e }

// Start listens on the configured port and advertises over Bonjour.
func (a *App) Start() error {
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", a.cfg.Bind, a.cfg.Port))
	if err != nil {
		return fmt.Errorf("listen on port %d: %w (is projmap already running?)", a.cfg.Port, err)
	}
	a.srv = &http.Server{Handler: a.e, ReadHeaderTimeout: 10 * time.Second}
	if a.cfg.Bonjour {
		if stop, err := discovery.Advertise(a.cfg.Port, a.ServerID, config.Version); err != nil {
			a.log.Warn("bonjour", "err", err)
		} else {
			a.stopBonjour = stop
		}
	}
	a.log.Info("projmap listening", "port", a.cfg.Port, "data", a.cfg.DataDir)
	if err := a.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Stop shuts everything down.
func (a *App) Stop(ctx context.Context) {
	if a.stopBonjour != nil {
		a.stopBonjour()
	}
	a.Hub.Close()
	if a.srv != nil {
		_ = a.srv.Shutdown(ctx)
	}
	if sqlDB, err := a.db.DB(); err == nil {
		_ = sqlDB.Close()
	}
}
