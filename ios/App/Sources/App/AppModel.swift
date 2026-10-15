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
    /// Protocol §14 screens (no board): the scene picker, the sounds sheet, YouTube import, the scenery videos.
    case scenes, sounds, youtube, videos
    /// Protocol §15 screens: the static tab's motion card, the scene picker's long-press preview.
    case motion, scenepreview

    var tab: AppTab {
        switch self {
        case .live, .addlayer: .live
        case .color: .color
        case .scenery, .youtube, .videos: .scenery
        case .objects, .automap1, .automap2, .automap3, .automap4, .sounds: .objects
        case .scenepreview: .static
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
    var showScenes = false
    /// The scene the picker's long-press preview shows (`/preview?scene=<id>`).
    var previewScene: SceneSummary?
    var showSounds = false
    /// The "add from YouTube" sheet, with a link handed over by `projmap://youtube?url=…` or the clipboard.
    var showYouTube = false
    var youtubeLink = ""
    /// The scenery tab opens on this category (the "videos" category after an import).
    var sceneryCategory = "nature"
    var autoMapStep = 0
    var toast: String?

    // Mirrors of the store (GRDB ValueObservation).
    private(set) var active = ActiveState()
    private(set) var catalog = Catalog.empty
    private(set) var scenes: [SceneSummary] = []
    private(set) var presets: [Preset] = []
    private(set) var devices: [Device] = []
    private(set) var sounds: [Asset] = []
    private(set) var videos: [Video] = []

    var haptics: Bool { didSet { UserDefaults.standard.set(haptics, forKey: "haptics") } }
    var keepAwake: Bool { didSet { UserDefaults.standard.set(keepAwake, forKey: "keepAwake"); applyKeepAwake() } }

    @ObservationIgnored let camera = CameraController()
    @ObservationIgnored let audio = AudioOutput()
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
        if debugScreen == .videos { sceneryCategory = "videos" }
        // -pm-connect 'projmap://connect?server=…&code=…' pairs at launch (UI tests, scripts).
        if let link = UserDefaults.standard.string(forKey: "pm-connect").flatMap(ConnectLink.init) {
            if credentials?.server != link.server || link.token != nil { credentials = nil; pendingLink = link }
        }
    }

    /// Starts the observations, the connection (or the demo) and the camera bridge.
    func start() {
        guard observers.isEmpty else { return }
        observe(db.observeActive()) { self.active = $0; self.syncTab(); self.updateAudio() }
        observe(db.observeCatalog()) { self.catalog = $0 }
        observe(db.observeScenes()) { self.scenes = $0 }
        observe(db.observeAllPresets()) { self.presets = $0 }
        observe(db.observeDevices()) { self.devices = $0 }
        observe(db.observeSounds()) { self.sounds = $0; self.updateAudio() }
        observe(db.observeVideos()) { self.videos = $0 }
        startAudio()
        if demo {
            DemoData.seed(db, screen: debugScreen)
            hub.startDemo()
            DemoData.prepare(self, screen: debugScreen)
        } else if let c = credentials {
            hub.start(server: c.server, token: c.token)
            // Screenshots against a real server: the scene picker and its preview open too.
            if debugScreen == .scenes || debugScreen == .scenepreview { DemoData.prepare(self, screen: debugScreen) }
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

    // MARK: Audio output (the phone plays only while show.audio.output is "phone")

    private func startAudio() {
        audio.serverNowMs = { [hub] in hub.serverNowMs }
        audio.source = { [weak self] sha in
            guard let self else { return nil }
            if self.demo { return DemoData.soundFile(sha) }
            return await SoundCache.file(sha, api: self.api)
        }
        hub.onSound = { [audio] event in audio.handle(event) }
    }

    private func updateAudio() {
        var durations: [String: Double] = [:]
        for s in sounds { if let d = s.duration, d > 0 { durations[s.sha] = d } }
        audio.update(show: active.show, scene: active.scene, durations: durations)
    }

    var audioState: ShowAudio { active.show?.audio ?? ShowAudio() }

    /// The library entry of a sound sha.
    func sound(_ sha: String) -> Asset? { sounds.first { $0.sha == sha } }

    /// Plays a pad on the wall's audio output (cmd `sound.play`); a looping pad that plays stops instead.
    func playPad(_ pad: Pad) {
        guard hub.isLive else { flash("Not connected to the projector."); return }
        Task {
            do { try await hub.playPad(pad.id) } catch { flash(error.localizedDescription) }
        }
    }

    func stopPad(_ pad: Pad) {
        guard hub.isLive else { return }
        Task { try? await hub.stopSound(padId: pad.id) }
    }

    /// Previews a library sound on the wall's audio output.
    func preview(_ sound: Asset) {
        guard hub.isLive else { flash("Not connected to the projector."); return }
        Task {
            do { try await hub.playSound(sound.sha) } catch { flash(error.localizedDescription) }
        }
    }

    func setAudio(output: String? = nil, volume: Double? = nil, muted: Bool? = nil) {
        guard hub.isLive else { flash("Not connected to the projector."); return }
        Task {
            do { try await hub.setAudio(output: output, volume: volume, muted: muted) } catch { flash(error.localizedDescription) }
        }
    }

    // MARK: Scenes

    /// Puts a scene on the wall (cmd `show.activate`) and opens the tab of its kind. The server puts the kind's mode on
    /// air (§15); an older server does not, so the phone sends that `replace /mode` itself once the scene is active.
    func activate(_ sceneId: String) {
        let kind = scenes.first { $0.id == sceneId }?.kind
        if let kind, let t = AppTab(rawValue: SceneKind.mode(kind)) { tab = t; tabSynced = true }
        guard sceneId != self.sceneId else {
            if let kind, let scene, scene.mode != SceneKind.mode(kind) { edit(.setMode(SceneKind.mode(kind))) }
            return
        }
        Task {
            do {
                try await hub.command("show.activate", ["sceneId": .string(sceneId)])
                guard let kind else { return }
                for _ in 0..<30 where self.sceneId != sceneId { try? await Task.sleep(for: .milliseconds(50)) }
                if self.sceneId == sceneId, let scene, scene.mode != SceneKind.mode(kind) { edit(.setMode(SceneKind.mode(kind))) }
            } catch { flash(error.localizedDescription) }
        }
    }

    /// `POST /scenes { name, kind }`: the server builds it from the kind's template. Returns the new id.
    @discardableResult
    func createScene(name: String, kind: String) async -> String? {
        do { return try await hub.createScene(name: name, kind: kind) } catch { flash(error.localizedDescription); return nil }
    }

    // MARK: Scene shortcuts

    var scene: PMKit.Scene? { active.scene }
    var sceneId: String? { active.scene?.id }
    var sceneChannel: String? { sceneId.map(Channel.scene) }
    var setupChannel: String? { active.setup.map { Channel.setup($0.id) } }
    /// The layers of one backdrop mode's stack.
    func layers(_ mode: String) -> [Layer] { active.scene?.layers(mode) ?? [] }
    /// The stack light of `static` or `live` (nil in `live` without one).
    func light(_ mode: String) -> StackLight? { active.scene?.light(mode) }
    /// The attachments of `static` or `live`.
    func attachments(_ mode: String) -> [Attachment] { active.scene?.attachments(mode) ?? [] }

    // MARK: Light and attachments (protocol §15)

    /// A drag on a light field: `param` while the light exists, else a structural edit that creates it.
    func lightParam(_ mode: String, _ field: [String], _ value: JSONValue) {
        if light(mode) == nil || active.sceneDoc?.value(at: ScenePath.stackLight(mode))?.object == nil {
            edit(.setLight(mode: mode, field: field, value: value))
            return
        }
        guard param(ScenePath.stack(mode) + "/light" + field.map { "/" + JSONPointer.escape($0) }.joined(), value) else {
            flash("Not connected to the projector.")
            return
        }
    }

    /// A drag on an attachment field (by id, so a reorder elsewhere never moves the wrong one).
    func attachmentParam(_ mode: String, _ id: String, _ field: [String], _ value: JSONValue) {
        guard let i = attachments(mode).firstIndex(where: { $0.id == id }) else { return }
        let path = ScenePath.attachments(mode) + "/\(i)" + field.map { "/" + JSONPointer.escape($0) }.joined()
        if active.sceneDoc?.value(at: path) == nil { edit(.setAttachmentField(attachmentId: id, field: field, value: value)); return }
        param(path, value)
    }

    /// The server's clock now (Unix ms), for motion progress.
    var serverNowMs: Double { hub.status == .online ? hub.serverNowMs : Date().timeIntervalSince1970 * 1000 }

    /// Writes a whole motion (or nil) on the light or on an attachment.
    func setMotion(_ mode: String, attachment: String?, _ motion: Motion?) {
        let value: JSONValue = motion.flatMap { try? JSONValue(encoding: $0) } ?? .null
        if let attachment { edit(.setAttachmentField(attachmentId: attachment, field: ["motion"], value: value)) }
        else { edit(.setLight(mode: mode, field: ["motion"], value: value)) }
    }
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
        let stack = scene.backdrop.lightStack(mode) ?? Backdrop(layers: scene.layers(mode))
        if !demo { try? db.addPendingPreset(Preset(id: tempId, name: name, mode: mode, backdrop: stack)) }
        hub.enqueue(.createPreset(name: name, mode: mode, sceneId: sceneId, tempId: tempId))
    }

    /// Bumps when the last applied preset changes (UserDefaults is not observed).
    var presetsVersion = 0
}

/// Client-made ids for new entities (protocol §8: `<prefix>_<8 base36 chars>`).
enum NewID {
    static func make(_ prefix: String) -> String { ClientID.make(prefix) }
}
