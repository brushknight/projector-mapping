import SwiftUI
import PMKit
import PMStore
import PMLive
import PMCamera

enum AppTab: String, CaseIterable, Hashable {
    case `static`, live, color, scenery, objects
}

/// Screens a launch argument can open (`-pm-screen <name>`), named after the boards in `design/boards/phone-*.png`.
enum DebugScreen: String {
    case `static`, staticfx, live, addlayer, color, scenery, objects, automap1, automap2, automap3, automap4, setup, connect

    var tab: AppTab {
        switch self {
        case .live, .addlayer: .live
        case .color: .color
        case .scenery: .scenery
        case .objects, .automap1, .automap2, .automap3, .automap4: .objects
        default: .static
        }
    }
}

/// The app's state: the local store (every screen reads from it), the hub connection, the paired server and the
/// phone's own settings. Screens read the store through the mirrored values here, which GRDB observations keep
/// current.
@MainActor
@Observable
final class AppModel {
    let db: AppDatabase
    let hub: LiveHub
    let tokens = TokenStore()
    private(set) var demo: Bool
    var pendingLink: ConnectLink?
    let debugScreen: DebugScreen?

    private(set) var credentials: Credentials?
    var tab: AppTab = .static
    var showSetup = false
    var showAutoMap = false
    var showAddLayer = false
    var autoMapStep = 0
    var toast: String?

    // Mirrors of the store (GRDB ValueObservation).
    private(set) var active = ActiveState()
    private(set) var catalog = Catalog.empty
    private(set) var scenes: [SceneSummary] = []
    private(set) var presets: [Preset] = []
    private(set) var devices: [Device] = []

    var haptics: Bool { didSet { UserDefaults.standard.set(haptics, forKey: "haptics") } }
    var keepAwake: Bool { didSet { UserDefaults.standard.set(keepAwake, forKey: "keepAwake"); applyKeepAwake() } }

    @ObservationIgnored let camera = CameraController()
    @ObservationIgnored private var observers: [Task<Void, Never>] = []

    init() {
        let args = ProcessInfo.processInfo.arguments
        let demoArg = args.contains("-pm-demo")
        demo = demoArg
        debugScreen = UserDefaults.standard.string(forKey: "pm-screen").flatMap(DebugScreen.init(rawValue:))
        haptics = UserDefaults.standard.object(forKey: "haptics") as? Bool ?? true
        keepAwake = UserDefaults.standard.object(forKey: "keepAwake") as? Bool ?? true
        if args.contains("-pm-reset") { TokenStore().clear() }
        let database: AppDatabase
        if demoArg {
            database = try! AppDatabase.inMemory()
        } else {
            database = (try? AppDatabase.open(directory: AppDatabase.defaultDirectory)) ?? (try! AppDatabase.inMemory())
            if args.contains("-pm-reset") { try? database.wipe() }
        }
        db = database
        hub = LiveHub(db: database, identity: .init(name: UIDevice.current.name, build: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"))
        credentials = demoArg ? nil : TokenStore().load()
        if let s = debugScreen { tab = s.tab }
        // -pm-connect 'projmap://connect?server=…&code=…' pairs at launch (UI tests, scripts).
        if let link = UserDefaults.standard.string(forKey: "pm-connect").flatMap(ConnectLink.init) {
            if credentials?.server != link.server || link.token != nil { credentials = nil; pendingLink = link }
        }
    }

    /// Starts the observations, the connection (or the demo) and the camera bridge.
    func start() {
        guard observers.isEmpty else { return }
        observe(db.observeActive()) { self.active = $0; self.syncTab() }
        observe(db.observeCatalog()) { self.catalog = $0 }
        observe(db.observeScenes()) { self.scenes = $0 }
        observe(db.observeAllPresets()) { self.presets = $0 }
        observe(db.observeDevices()) { self.devices = $0 }
        if demo {
            DemoData.seed(db, screen: debugScreen)
            hub.startDemo()
            DemoData.prepare(self, screen: debugScreen)
        } else if let c = credentials {
            hub.start(server: c.server, token: c.token)
        }
        CameraBridge.install(self)
        applyKeepAwake()
    }

    private func observe<T: Sendable & Equatable>(_ o: ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<T>>>, _ assign: @escaping @MainActor (T) -> Void) {
        let values = db.values(o)
        observers.append(Task { @MainActor in
            do { for try await v in values { assign(v) } } catch {}
        })
    }

    var isPaired: Bool { demo || credentials != nil }
    var api: APIClient? { hub.api }
    var serverName: String { demo ? "studio-mac" : credentials?.serverName ?? "projector" }

    func paired(_ c: Credentials) {
        try? tokens.save(c)
        if credentials?.server != c.server { try? db.wipe() }
        credentials = c
        hub.start(server: c.server, token: c.token)
    }

    /// "look around without a projector": the offline demo, without relaunching.
    func enterDemo() {
        demo = true
        DemoData.seed(db, screen: nil)
        hub.startDemo()
    }

    func unpair() {
        demo = false
        hub.stop()
        tokens.clear()
        try? db.wipe()
        credentials = nil
    }

    func applyKeepAwake() { UIApplication.shared.isIdleTimerDisabled = keepAwake }

    func flash(_ message: String) {
        toast = message
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.4))
            if toast == message { toast = nil }
        }
    }

    // MARK: Scene shortcuts

    var scene: PMKit.Scene? { active.scene }
    var sceneId: String? { active.scene?.id }
    var sceneChannel: String? { sceneId.map(Channel.scene) }
    var setupChannel: String? { active.setup.map { Channel.setup($0.id) } }
    /// The layers of one backdrop mode's stack.
    func layers(_ mode: String) -> [Layer] { active.scene?.layers(mode) ?? [] }
    /// What is on air: `static` | `live` | `color` | `scenery` | `objects`.
    var mode: String { active.scene?.mode ?? "static" }

    /// Opens a tab and puts its mode on air (`replace /mode`), so the phone's tab is what the wall shows.
    func select(_ t: AppTab) {
        tab = t
        tabSynced = true
        guard let scene, scene.mode != t.rawValue else { return }
        edit(.setMode(t.rawValue))
    }

    /// The first scene from the server opens the tab of its mode (launching the app never changes the wall).
    @ObservationIgnored private var tabSynced = false
    private func syncTab() {
        guard !tabSynced, debugScreen == nil, let scene = active.scene else { return }
        tabSynced = true
        if let t = AppTab(rawValue: scene.mode) { tab = t }
    }

    func presets(_ mode: String) -> [Preset] { presets.filter { $0.mode == mode } }

    /// Sends a drag value at a JSON Pointer of the active scene. Returns false when not connected.
    @discardableResult
    func param(_ path: String, _ value: JSONValue) -> Bool {
        guard let ch = sceneChannel else { return false }
        return hub.param(ch, path, value)
    }

    @discardableResult
    func setupParam(_ path: String, _ value: JSONValue) -> Bool {
        guard let ch = setupChannel else { return false }
        return hub.param(ch, path, value)
    }

    func edit(_ intent: SceneIntent) {
        guard let id = sceneId else { flash("No scene is active on the projector."); return }
        hub.edit(sceneId: id, intent)
    }

    /// Show control: commands go straight to the hub (never queued).
    func command(_ name: String, _ args: JSONValue = [:]) {
        Task {
            do { try await hub.command(name, args) } catch { flash(error.localizedDescription) }
        }
    }

    func toggleBlackout() {
        guard hub.isLive else { flash("Not connected to the projector."); return }
        command("show.blackout", ["on": .bool(active.onAir)])
    }

    // MARK: Presets

    func lastPreset(_ mode: String) -> String? { UserDefaults.standard.string(forKey: "preset.\(mode)") }

    func apply(_ preset: Preset) {
        guard let backdrop = try? JSONValue(encoding: preset.backdrop) else { return }
        edit(.applyPreset(mode: preset.mode, backdrop: backdrop))
        if let t = AppTab(rawValue: preset.mode) { tab = t }
        UserDefaults.standard.set(preset.id, forKey: "preset.\(preset.mode)")
        presetsVersion += 1
    }

    /// Saves `mode`'s stack as a preset (optimistic row, REST through the outbox).
    func savePreset(name: String, mode: String) {
        guard let sceneId, let scene else { return }
        let tempId = "tmp_\(UUID().uuidString.prefix(6).lowercased())"
        if !demo { try? db.addPendingPreset(Preset(id: tempId, name: name, mode: mode, backdrop: Backdrop(layers: scene.layers(mode)))) }
        hub.enqueue(.createPreset(name: name, mode: mode, sceneId: sceneId, tempId: tempId))
    }

    /// Bumps when the last applied preset changes (UserDefaults is not observed).
    var presetsVersion = 0
}

/// Client-made ids for new entities (protocol §8: `<prefix>_<8 base36 chars>`).
enum NewID {
    static func make(_ prefix: String) -> String {
        let chars = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        return prefix + "_" + String((0..<8).map { _ in chars.randomElement()! })
    }
}
