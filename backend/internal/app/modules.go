package app

import (
	"context"
	"log/slog"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	agentport "projmap/internal/application/ports/out/agents"
	"projmap/internal/application/ports/out/realtime"
	showrepo "projmap/internal/application/ports/repository/show"
	"projmap/internal/application/services/agents/agentsvc"
	assetsservices "projmap/internal/application/services/assets"
	"projmap/internal/application/services/assets/assetsvc"
	"projmap/internal/application/services/camera/camerasvc"
	"projmap/internal/application/services/catalog/catalogsvc"
	"projmap/internal/application/services/devices/devicesvc"
	scenesservices "projmap/internal/application/services/scenes"
	"projmap/internal/application/services/scenes/scenesvc"
	setupsservices "projmap/internal/application/services/setups"
	"projmap/internal/application/services/setups/setupsvc"
	showservices "projmap/internal/application/services/show"
	"projmap/internal/application/services/show/showsvc"
	builtin "projmap/internal/catalog"
	"projmap/internal/domain/show"
	"projmap/internal/infrastructure/clients/agentrunner"
	agentsql "projmap/internal/infrastructure/database/sql/agents"
	assetsql "projmap/internal/infrastructure/database/sql/assets"
	camerasql "projmap/internal/infrastructure/database/sql/camera"
	catalogsql "projmap/internal/infrastructure/database/sql/catalog"
	devicesql "projmap/internal/infrastructure/database/sql/devices"
	scenesql "projmap/internal/infrastructure/database/sql/scenes"
	setupsql "projmap/internal/infrastructure/database/sql/setups"
	"projmap/internal/infrastructure/filesystem/blobs"
	agentshttp "projmap/internal/infrastructure/http_server/handlers/agents"
	assetshttp "projmap/internal/infrastructure/http_server/handlers/assets"
	camerahttp "projmap/internal/infrastructure/http_server/handlers/camera"
	cataloghttp "projmap/internal/infrastructure/http_server/handlers/catalog"
	deviceshttp "projmap/internal/infrastructure/http_server/handlers/devices"
	sceneshttp "projmap/internal/infrastructure/http_server/handlers/scenes"
	setupshttp "projmap/internal/infrastructure/http_server/handlers/setups"
	showhttp "projmap/internal/infrastructure/http_server/handlers/show"
	"projmap/internal/infrastructure/realtime/hub"
	"projmap/internal/infrastructure/vision/adapter"
)

// CatalogModule is the catalog section: built-ins and the effect library.
type CatalogModule struct{ Service *catalogsvc.Service }

func NewCatalogModule(ctx context.Context, db *gorm.DB) (*CatalogModule, error) {
	svc, err := catalogsvc.New(ctx, builtin.JSON, catalogsql.New(db))
	if err != nil {
		return nil, err
	}
	return &CatalogModule{Service: svc}, nil
}

func (m *CatalogModule) Register(api *echo.Group) { cataloghttp.New(m.Service).RegisterRoutes(api) }

// SetupsModule is the setups section: projector rigs.
type SetupsModule struct{ Service *setupsvc.Service }

func NewSetupsModule(db *gorm.DB, pub realtime.Publisher, log *slog.Logger) *SetupsModule {
	return &SetupsModule{Service: setupsvc.New(setupsql.New(db), pub, log)}
}

func (m *SetupsModule) Register(api *echo.Group) { setupshttp.New(m.Service).RegisterRoutes(api) }

// ScenesModule is the scenes section: documents, drafts, presets.
type ScenesModule struct {
	Service *scenesvc.Service
	Drafts  *scenesvc.Drafts
	Presets *scenesvc.Presets
}

func NewScenesModule(db *gorm.DB, refs *catalogsvc.Service, pub realtime.Publisher, log *slog.Logger) *ScenesModule {
	s := scenesvc.New(scenesql.NewSceneRepository(db), refs, pub, log)
	return &ScenesModule{Service: s, Drafts: scenesvc.NewDrafts(scenesql.NewDraftRepository(db), s, pub),
		Presets: scenesvc.NewPresets(scenesql.NewPresetRepository(db), s, pub)}
}

// SetupInUse tells whether any scene uses the setup.
func (m *ScenesModule) SetupInUse(ctx context.Context, id string) bool {
	l, err := m.Service.List(ctx)
	if err != nil {
		return true
	}
	for _, s := range l {
		if s.SetupID == id {
			return true
		}
	}
	return false
}

func (m *ScenesModule) Register(api *echo.Group, setups setupsservices.SetupService, sh showservices.ShowService, as assetsservices.AssetService) {
	h := &sceneshttp.Handler{Scenes: m.Service, Drafts: m.Drafts, Presets: m.Presets, Setups: setups, Show: sh, Assets: as}
	h.RegisterRoutes(api)
}

var _ scenesservices.DraftService = (*scenesvc.Drafts)(nil)

// ShowModule is the show section: live state and transport.
type ShowModule struct{ Service *showsvc.Service }

func NewShowModule(ctx context.Context, kv showrepo.KV, scenes scenesservices.SceneService, pub realtime.Publisher, log *slog.Logger, seeded bool) (*ShowModule, error) {
	def := show.Show{OnAir: true, Transport: show.Transport{State: show.Stopped}}
	if seeded {
		def.ActiveSetupID, def.ActiveSceneID = SeedSetupID, SeedSceneID
	}
	svc, err := showsvc.New(ctx, kv, scenes, pub, log, def)
	if err != nil {
		return nil, err
	}
	return &ShowModule{Service: svc}, nil
}

func (m *ShowModule) Register(api *echo.Group) { showhttp.New(m.Service).RegisterRoutes(api) }

// AssetsModule is the assets section.
type AssetsModule struct{ Service *assetsvc.Service }

func NewAssetsModule(db *gorm.DB, root string) *AssetsModule {
	return &AssetsModule{Service: assetsvc.New(assetsql.New(db), blobs.New(root))}
}

func (m *AssetsModule) Register(root *echo.Echo, api *echo.Group) {
	assetshttp.New(m.Service, builtin.Assets()).RegisterRoutes(root, api)
}

// DevicesModule is the devices section: pairing and presence.
type DevicesModule struct {
	Service *devicesvc.Service
	port    int
}

func NewDevicesModule(db *gorm.DB, pub realtime.Publisher, presence realtime.Presence, port int) *DevicesModule {
	svc := devicesvc.New(devicesql.New(db), pub)
	svc.SetPresence(presence)
	return &DevicesModule{Service: svc, port: port}
}

func (m *DevicesModule) Register(public, api *echo.Group) {
	deviceshttp.New(m.Service, m.port).RegisterRoutes(public, api)
}

// CameraModule is the camera section: stills, preview, calibration.
type CameraModule struct {
	Camera       *camerasvc.Camera
	Calibrations *camerasvc.Calibrations
}

func NewCameraModule(db *gorm.DB, h *hub.Hub, as assetsservices.AssetService, setups setupsservices.SetupService, _ showservices.ShowService, log *slog.Logger) *CameraModule {
	cam := camerasvc.NewCamera(h, h, as)
	cal := camerasvc.NewCalibrations(camerasql.New(db), setups, cam, as, adapter.Vision{}, h, h, log)
	return &CameraModule{Camera: cam, Calibrations: cal}
}

func (m *CameraModule) Register(api *echo.Group, sh showservices.ShowService) {
	(&camerahttp.Handler{Camera: m.Camera, Calibrations: m.Calibrations, Show: sh}).RegisterRoutes(api)
}

// AgentConfig is where agents run.
type AgentConfig = agentsvc.Config

// AgentsModule is the agents section.
type AgentsModule struct{ Service *agentsvc.Service }

func NewAgentsModule(ctx context.Context, db *gorm.DB, kv showrepo.KV, drafts scenesservices.DraftService, dev *devicesvc.Service, sh showservices.ShowService,
	runner agentport.Runner, pub realtime.Publisher, log *slog.Logger, cfg AgentConfig) *AgentsModule {
	if runner == nil {
		runner = agentrunner.New()
	}
	svc := agentsvc.New(agentsql.New(db), drafts, dev, sh, runner, kv, pub, log, cfg)
	svc.Recover(ctx)
	return &AgentsModule{Service: svc}
}

func (m *AgentsModule) Register(api *echo.Group) { agentshttp.New(m.Service).RegisterRoutes(api) }
