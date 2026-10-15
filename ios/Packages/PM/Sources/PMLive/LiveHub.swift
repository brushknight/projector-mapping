import Foundation
import Observation
import PMKit
import PMStore

public enum LiveError: Error, LocalizedError, Equatable {
    case notConnected
    case timeout
    public var errorDescription: String? {
        switch self {
        case .notConnected: "Not connected to the projector."
        case .timeout: "The projector did not answer."
        }
    }
}

/// The phone's WebSocket to the hub (protocol §3): hello/welcome, reconnect with backoff, clock sync, channel
/// subscriptions, snapshots/patches/params into the store, the outbox for structural edits, throttled params for
/// drags, commands with ack, and RPC from the server.
@MainActor
@Observable
public final class LiveHub {
    public enum Status: String, Sendable { case offline, connecting, online, demo }

    public struct Identity: Sendable {
        public var name: String
        public var build: String
        public var caps: [String]
        public init(name: String, build: String, caps: [String] = ["haptics", "camera", "audio"]) { self.name = name; self.build = build; self.caps = caps }
    }

    public private(set) var status: Status = .offline
    public private(set) var lastError: String?
    public private(set) var device: Device?
    public private(set) var clock = ClockSync()
    public private(set) var agentEvents: [String: [AgentEvent]] = [:]
    public private(set) var agentStatus: [String: String] = [:]
    public private(set) var calibration: [String: CalibrationProgress] = [:]
    public private(set) var subscribed: Set<String> = []
    /// YouTube imports this phone started, from `import:{id}` snapshots or polling (protocol §14).
    public internal(set) var imports: [String: ImportJob] = [:]
    /// `sound.play` / `sound.stop` for the phone's audio output (it plays only while `show.audio.output` is `phone`).
    public var onSound: (@MainActor (SoundEvent) -> Void)?

    /// Drags and show control work only when this is true; offline controls say "not connected".
    public var isLive: Bool { status == .online || status == .demo }

    public let db: AppDatabase
    public private(set) var api: APIClient?
    let transport: any HubTransport
    let identity: Identity

    /// Seconds since 1970; replaced in tests.
    public var now: @MainActor () -> Double = { Date().timeIntervalSince1970 }
    /// Reconnect delays in seconds (the last one repeats).
    public var backoff: [Double] = [0.5, 1, 2, 4, 8, 15]
    public var commandTimeout: Double = 6

    private var conn: (any HubConnection)?
    private var outgoing: AsyncStream<String>.Continuation?
    private var runTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var throttle = ParamThrottle()
    private var throttleTask: Task<Void, Never>?
    private var activeScene: String?
    private var activeSetup: String?
    private var pendingCmds: [String: CheckedContinuation<JSONValue?, Error>] = [:]
    private var rpcHandlers: [String: @MainActor (JSONValue) async throws -> JSONValue] = [:]
    private var listDocs: [String: JSONValue] = [:]
    private var staleCounts: [String: Int] = [:]
    private var seq = 0
    private var attempt = 0
    private var stopped = true
    private var frameSlot: String?
    private var frameBusy = false
    var demo: DemoState?

    public init(db: AppDatabase, transport: any HubTransport = URLSessionHubTransport(), identity: Identity) {
        self.db = db
        self.transport = transport
        self.identity = identity
    }

    // MARK: Lifecycle

    /// Connects to `server` and keeps the connection up until `stop()`.
    public func start(server: URL, token: String?) {
        stop()
        api = APIClient(server: server, token: token)
        stopped = false
        runTask = Task { await self.run() }
    }

    public func stop() {
        stopped = true
        runTask?.cancel()
        runTask = nil
        dropConnection()
        status = .offline
    }

    /// Offline demo: every edit and command applies to the local store as if the server confirmed it.
    public func startDemo() {
        stop()
        demo = DemoState()
        status = .demo
    }

    private func run() async {
        while !stopped, !Task.isCancelled, let api {
            status = .connecting
            do {
                let c = try await transport.connect(url: api.webSocketURL, token: api.token)
                guard !stopped else { c.close(); return }
                open(c)
                emit(Envelope(t: MessageType.hello, d: try JSONValue(encoding: Hello(token: api.token, name: identity.name, caps: identity.caps, build: identity.build))))
                while !stopped {
                    let text = try await c.receive()
                    handle(text)
                }
            } catch {
                if !stopped { lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
            }
            dropConnection()
            if stopped { return }
            status = .offline
            let delay = backoff[min(attempt, backoff.count - 1)] * Double.random(in: 0.85...1.15)
            attempt += 1
            try? await Task.sleep(for: .seconds(delay))
        }
    }

    private func open(_ c: any HubConnection) {
        conn = c
        let (stream, cont) = AsyncStream<String>.makeStream()
        outgoing = cont
        Task {
            for await text in stream {
                do { try await c.send(text) } catch {
                    // A failed send used to end this pump silently: the socket stayed open (camera frames, which go
                    // out on their own path, kept arriving) while every later status, sub and cmd was dropped.
                    // Closing makes receive() fail, so run() reconnects and resubscribes.
                    c.close()
                    break
                }
            }
        }
    }

    private func dropConnection() {
        frameSlot = nil
        outgoing?.finish()
        outgoing = nil
        conn?.close()
        conn = nil
        syncTask?.cancel()
        syncTask = nil
        throttleTask?.cancel()
        throttleTask = nil
        throttle.drop()
        subscribed = []
        activeScene = nil
        activeSetup = nil
        listDocs = [:]
        for (_, c) in pendingCmds { c.resume(throwing: LiveError.notConnected) }
        pendingCmds = [:]
        try? db.requeueAll()
    }

    func emit(_ env: Envelope) {
        outgoing?.yield(env.text)
    }

    private func nextId(_ prefix: String) -> String {
        seq += 1
        return "\(prefix)-\(seq)"
    }

    // MARK: Subscriptions

    public func subscribe(_ ch: String) {
        guard status == .online || status == .connecting, conn != nil else { return }
        subscribed.insert(ch)
        emit(Envelope(t: MessageType.sub, ch: ch))
    }

    public func unsubscribe(_ ch: String) {
        guard subscribed.remove(ch) != nil else { return }
        emit(Envelope(t: MessageType.unsub, ch: ch))
    }

    /// Asks for a fresh snapshot of a channel this copy has fallen behind on.
    func resync(_ ch: String) {
        emit(Envelope(t: MessageType.sub, ch: ch))
    }

    /// Keeps the active scene and setup subscribed as the show changes.
    private func follow(_ show: Show) {
        if show.activeSceneId != activeScene {
            if let old = activeScene { unsubscribe(Channel.scene(old)) }
            activeScene = show.activeSceneId
            if let id = activeScene { subscribe(Channel.scene(id)) }
        }
        if show.activeSetupId != activeSetup {
            if let old = activeSetup { unsubscribe(Channel.setup(old)) }
            activeSetup = show.activeSetupId
            if let id = activeSetup { subscribe(Channel.setup(id)) }
        }
    }

    // MARK: Incoming

    func handle(_ text: String) {
        guard let env = try? Envelope.decode(text) else { return }
        switch env.t {
        case MessageType.welcome: welcome(env)
        case MessageType.pong: pong(env)
        case MessageType.snapshot: snapshot(env)
        case MessageType.param: param(env)
        case MessageType.patched: patched(env)
        case MessageType.reject: reject(env)
        case MessageType.ack:
            if let re = env.re { pendingCmds.removeValue(forKey: re)?.resume(returning: env.d) }
        case MessageType.error:
            let err = (try? env.d?.decode(WireError.self)) ?? WireError(code: "error", message: "")
            if let re = env.re, let c = pendingCmds.removeValue(forKey: re) { c.resume(throwing: err) } else { lastError = err.errorDescription }
        case MessageType.rpc: rpc(env)
        case MessageType.soundPlay:
            if let p = try? env.d?.decode(SoundPlay.self) { onSound?(.play(p)) }
        case MessageType.soundStop:
            onSound?(.stop((try? env.d?.decode(SoundStop.self)) ?? SoundStop()))
        default: push(env)
        }
    }

    private func welcome(_ env: Envelope) {
        guard let w = try? env.d?.decode(Welcome.self) else { return }
        status = .online
        attempt = 0
        lastError = nil
        device = w.device
        clock.reset()
        let nowMs = now() * 1000
        if w.serverTime > 0 { clock.add(t0: nowMs, t1: nowMs, serverNs: w.serverTime) }
        subscribe(Channel.show)
        subscribe(Channel.presets)
        subscribe(Channel.devices)
        subscribe(Channel.scenes)
        subscribe(Channel.sounds)
        subscribe(Channel.videos)
        if let show = w.show {
            try? db.saveShow(show)
            follow(show)
        }
        startClockSync()
        try? db.requeueAll()
        pumpOutbox()
        let version = w.catalogVersion
        Task { await self.refreshREST(catalogVersion: version) }
    }

    /// Catalog (when its version changed), the scene list and presets over REST.
    func refreshREST(catalogVersion: Int) async {
        guard let api else { return }
        let have = try? db.catalogVersion()
        if have == nil || have != catalogVersion || catalogVersion == 0, let data = try? await api.catalogData() {
            let v = (try? JSONValue(jsonText: String(decoding: data, as: UTF8.self)))?["version"]?.int ?? catalogVersion
            try? db.saveCatalog(data, version: v)
        }
        if let list = try? await api.scenes() { try? db.saveSceneList(list) }
        if listDocs[Channel.presets] == nil, let presets = try? await api.presets() { try? db.savePresets(presets) }
        if listDocs[Channel.sounds] == nil, let sounds = try? await api.sounds() { try? db.saveSounds(sounds) }
        if listDocs[Channel.videos] == nil, let videos = try? await api.videos() { try? db.saveVideos(videos) }
    }

    private func snapshot(_ env: Envelope) {
        guard let ch = env.ch, let d = env.d else { return }
        let (kind, id) = Channel.split(ch)
        switch kind {
        case "show":
            if let show = try? d.decode(Show.self) {
                listDocs[ch] = d
                try? db.saveShow(show)
                follow(show)
            }
        case "scene":
            try? db.saveSceneSnapshot(d, version: env.v ?? d["version"]?.int ?? 0)
            pumpOutbox()
        case "setup":
            try? db.saveSetup(d, version: env.v ?? 0)
        case "presets", "devices", "scenes", "sounds", "videos":
            list(ch, d)
        case "import":
            if let id, let job = try? d.decode(ImportJob.self) { imports[id] = job }
        case "agent":
            if let id { agentPush(id, d) }
        case "calib":
            if let id { calibPush(id, d) }
        default:
            break
        }
    }

    /// Channel pushes other than snapshot/param/patched (agent events, calibration progress, show updates).
    private func push(_ env: Envelope) {
        guard let ch = env.ch, let d = env.d else { return }
        let (kind, id) = Channel.split(ch)
        switch kind {
        case "agent": if let id { agentPush(id, d) }
        case "calib": if let id { calibPush(id, d) }
        case "show": snapshot(Envelope(t: MessageType.snapshot, ch: ch, v: env.v, d: d))
        case "presets", "devices", "scenes", "sounds", "videos": list(ch, d)
        case "import": snapshot(Envelope(t: MessageType.snapshot, ch: ch, v: env.v, d: d))
        default: break
        }
    }

    private func list(_ ch: String, _ d: JSONValue) {
        guard case .array = d else { return }
        listDocs[ch] = d
        if ch == Channel.presets, let presets = try? d.decode([Preset].self) { try? db.savePresets(presets) }
        if ch == Channel.devices, let devices = try? d.decode([Device].self) { try? db.saveDevices(devices) }
        if ch == Channel.scenes, let scenes = try? d.decode([SceneSummary].self) {
            try? db.saveSceneList(scenes, prune: true, keep: activeScene)
        }
        if ch == Channel.sounds, let sounds = try? d.decode([Asset].self) { try? db.saveSounds(sounds) }
        if ch == Channel.videos, let videos = try? d.decode([Video].self) { try? db.saveVideos(videos) }
    }

    /// Agent channel (protocol §8): `snapshot` with the event array or `{ session, events }`, live `event { AgentEvent }`
    /// and `session { AgentSession }`.
    private func agentPush(_ id: String, _ d: JSONValue) {
        func merge(_ events: [AgentEvent]) {
            var merged = Dictionary((agentEvents[id] ?? []).map { ($0.seq, $0) }, uniquingKeysWith: { $1 })
            for e in events { merged[e.seq] = e }
            agentEvents[id] = merged.values.sorted { $0.seq < $1.seq }
        }
        if case .array = d {
            merge((try? d.decode([AgentEvent].self)) ?? [])
        } else if d["seq"] != nil, let e = try? d.decode(AgentEvent.self) {
            merge([e])
            if e.kind == "status" { agentStatus[id] = e.text }
        } else {
            if let events = d["events"], let list = try? events.decode([AgentEvent].self) { merge(list) }
            if let status = d["session"]?["status"]?.string ?? d["status"]?.string { agentStatus[id] = status }
        }
    }

    private func calibPush(_ id: String, _ d: JSONValue) {
        if let p = try? d.decode(CalibrationProgress.self), d["total"] != nil || d["step"] != nil { calibration[id] = p }
    }

    /// Live values from other devices, coalesced: the latest value per channel and path, written at most 10×/s.
    private var incomingParams: [String: (channel: String, path: String, value: JSONValue)] = [:]
    private var incomingFlush: Task<Void, Never>?

    private func param(_ env: Envelope) {
        guard let ch = env.ch, let p = try? env.d?.decode(ParamMessage.self) else { return }
        incomingParams[ch + "\u{1}" + p.path] = (ch, p.path, p.value)
        guard incomingFlush == nil else { return }
        incomingFlush = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(100))
            guard let self else { return }
            let pending = self.incomingParams
            self.incomingParams = [:]
            self.incomingFlush = nil
            for (_, v) in pending { try? self.db.applyParam(channel: v.channel, path: v.path, value: v.value) }
        }
    }

    private func patched(_ env: Envelope) {
        guard let ch = env.ch, let msg = PatchedMessage(env.d) else { return }
        let (kind, id) = Channel.split(ch)
        switch kind {
        case "scene":
            guard let id else { return }
            if let re = env.re { staleCounts[re] = nil }
            let ok = (try? db.applyScenePatch(id, ops: msg.ops, version: env.v ?? 0, ack: env.re)) ?? false
            if !ok { resync(ch) }
            pumpOutbox()
        case "setup":
            guard let id else { return }
            try? db.applySetupPatch(id, ops: msg.ops, version: env.v)
        case "show", "presets", "devices", "scenes", "sounds", "videos":
            guard let doc = listDocs[ch], let next = try? doc.applying(msg.ops) else { resync(ch); return }
            if kind == "show" { snapshot(Envelope(t: MessageType.snapshot, ch: ch, v: env.v, d: next)) } else { list(ch, next) }
        default:
            break
        }
    }

    private func reject(_ env: Envelope) {
        guard let re = env.re else { return }
        let err = try? env.d?.decode(WireError.self)
        guard err?.code == "stale" || err == nil else {
            try? db.removeOutbox(re)
            lastError = err?.errorDescription
            pumpOutbox()
            return
        }
        staleCounts[re, default: 0] += 1
        if staleCounts[re, default: 0] > 5 {
            staleCounts[re] = nil
            try? db.removeOutbox(re)
            lastError = "An edit could not be applied because the scene kept changing."
            pumpOutbox()
            return
        }
        try? db.markQueued(re)
        if let target = try? db.outboxTarget(re), case ("scene", let sid?) = Channel.split(target),
           let v = env.v, (try? db.sceneVersion(sid)).flatMap({ $0 }) ?? -1 < v {
            resync(target)  // the snapshot replays the intent and pumps again
        } else {
            pumpOutbox()
        }
    }

    // MARK: Clock

    private func startClockSync() {
        syncTask?.cancel()
        syncTask = Task {
            while !Task.isCancelled {
                for _ in 0..<8 {
                    emit(Envelope(t: MessageType.ping, d: ["t0": .number(now() * 1000)]))
                    try? await Task.sleep(for: .milliseconds(120))
                }
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func pong(_ env: Envelope) {
        guard let t0 = env.d?["t0"]?.double, let ts = env.d?["ts"]?.double else { return }
        clock.add(t0: t0, t1: now() * 1000, serverNs: Int64(ts))
    }

    /// The server's clock now (Unix ms).
    public var serverNowMs: Double { clock.serverNowMs(localMs: now() * 1000) }

    // MARK: Params (drags)

    /// Sends a live value on `channel` (`scene:…` or `setup:…`). Returns false when not connected; the caller shows
    /// "not connected" and nothing is queued.
    @discardableResult
    public func param(_ channel: String, _ path: String, _ value: JSONValue) -> Bool {
        guard isLive else { return false }
        for out in throttle.submit(channel: channel, path: path, value: value, now: now()) { deliver(out) }
        scheduleThrottle()
        return true
    }

    private func deliver(_ out: ParamThrottle.Out) {
        // No local database write per drag tick: the scene can be hundreds of KB (agent drawings), and rewriting it
        // 60×/s on the main thread made every slider lag. The control shows its own value while dragging; the server's
        // commit (`patched`, ~200 ms after the drag settles) updates the store once. Offline/demo still applies locally.
        if status != .online { try? db.applyParam(channel: out.channel, path: out.path, value: out.value) }
        if status == .online {
            emit(Envelope(t: MessageType.param, ch: out.channel, d: ["path": .string(out.path), "value": out.value]))
        }
    }

    private func scheduleThrottle() {
        guard throttleTask == nil, let deadline = throttle.nextDeadline() else { return }
        let wait = max(0.001, deadline - now())
        throttleTask = Task {
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled else { return }
            throttleTask = nil
            for out in throttle.due(now: now()) { deliver(out) }
            scheduleThrottle()
        }
    }

    // MARK: Structural edits (outbox)

    /// Applies `intent` to the scene at once and queues it for the server.
    public func edit(sceneId: String, _ intent: SceneIntent) {
        let clientId = (try? db.enqueue(sceneId: sceneId, intent)) ?? ""
        if status == .demo { demoCommit(sceneId: sceneId, clientId: clientId); return }
        pumpOutbox()
    }

    /// Queues a REST write (applied optimistically by the caller).
    public func enqueue(_ intent: RestIntent) {
        if status == .demo { demoRest(intent); return }
        try? db.enqueue(intent)
        pumpOutbox()
    }

    public var pendingEdits: Int { (try? db.pendingItems().count) ?? 0 }

    func pumpOutbox() {
        guard status == .online, let items = try? db.sendable() else { return }
        var again = false
        for item in items {
            if let intent = item.scene, case ("scene", let sid?) = Channel.split(item.target) {
                guard let base = (try? db.sceneVersion(sid)).flatMap({ $0 }), let doc = (try? db.confirmedScene(sid)).flatMap({ $0 }) else { continue }
                guard let ops = intent.ops(on: doc), !ops.isEmpty, (try? doc.applying(ops)) != nil,
                      let opsJSON = try? JSONValue(encoding: ops) else {
                    try? db.removeOutbox(item.clientId)
                    again = true
                    continue
                }
                try? db.markSent(item.clientId)
                emit(Envelope(t: MessageType.patch, ch: item.target, id: item.clientId, base: base, d: opsJSON))
            } else if let rest = item.rest {
                try? db.markSent(item.clientId)
                let id = item.clientId
                Task { await self.perform(rest, clientId: id) }
            } else {
                try? db.removeOutbox(item.clientId)
            }
        }
        if again { pumpOutbox() }
    }

    private func perform(_ rest: RestIntent, clientId: String) async {
        guard let api else { return }
        do {
            switch rest {
            case .createPreset(let name, let mode, let sceneId, let tempId):
                _ = try await api.createPreset(name: name, mode: mode, sceneId: sceneId)
                try? db.removePreset(tempId)
                if let presets = try? await api.presets() { try? db.savePresets(presets) }
            case .deletePreset(let id):
                try await api.deletePreset(id)
            }
            try? db.removeOutbox(clientId)
        } catch let e as APIError where !e.isUnreachable {
            lastError = e.errorDescription
            try? db.removeOutbox(clientId)
        } catch {
            try? db.markQueued(clientId)
        }
        pumpOutbox()
    }

    // MARK: Commands

    /// `cmd { name, args }`; waits for `ack` or throws the server's `error`.
    @discardableResult
    public func command(_ name: String, _ args: JSONValue = [:]) async throws -> JSONValue? {
        if status == .demo { return try demoCommand(name, args) }
        guard status == .online else { throw LiveError.notConnected }
        let id = nextId("m")
        emit(Envelope(t: MessageType.cmd, id: id, d: ["name": .string(name), "args": args]))
        let timeout = commandTimeout
        return try await withCheckedThrowingContinuation { cont in
            pendingCmds[id] = cont
            Task {
                try? await Task.sleep(for: .seconds(timeout))
                pendingCmds.removeValue(forKey: id)?.resume(throwing: LiveError.timeout)
            }
        }
    }

    // MARK: RPC

    /// Answers server requests such as `camera.capture`.
    public func handleRPC(_ method: String, _ handler: @escaping @MainActor (JSONValue) async throws -> JSONValue) {
        rpcHandlers[method] = handler
    }

    private func rpc(_ env: Envelope) {
        guard let id = env.id, let req = try? env.d?.decode(RPCRequest.self) else { return }
        guard let handler = rpcHandlers[req.method] else {
            emit(Envelope(t: MessageType.rpcError, re: id, d: ["code": "unsupported", "message": .string("This phone does not handle \(req.method).")]))
            return
        }
        Task {
            do {
                let result = try await handler(req.args)
                emit(Envelope(t: MessageType.rpcResult, re: id, d: result))
            } catch {
                emit(Envelope(t: MessageType.rpcError, re: id, d: ["code": "failed", "message": .string(error.localizedDescription)]))
            }
        }
    }

    // MARK: Camera preview

    /// Sends the newest preview frame; a frame that arrives while one is still going out replaces the waiting one.
    public func sendCameraFrame(_ frame: CameraFrame) {
        guard status == .online, let text = try? Envelope(t: MessageType.cameraFrame, ch: Channel.camera, d: JSONValue(encoding: frame)).text else { return }
        sendCameraFrameText(text)
    }

    /// Sends a `camera.frame` envelope already encoded (off the main actor) by the camera.
    public func sendCameraFrameText(_ text: String) {
        guard status == .online, conn != nil else { return }
        frameSlot = text
        guard !frameBusy else { return }
        frameBusy = true
        Task {
            // always the current connection: after a reconnect the frames go to the new socket, not the dead one
            while let next = frameSlot, let c = self.conn {
                frameSlot = nil
                do { try await c.send(next) } catch {
                    c.close()
                    break
                }
            }
            frameSlot = nil
            frameBusy = false
        }
    }

    public func sendCameraStatus(_ s: CameraStatus) {
        guard status == .online, let d = try? JSONValue(encoding: s) else { return }
        emit(Envelope(t: MessageType.cameraStatus, ch: Channel.camera, d: d))
    }

    // MARK: Agents and calibration

    public func startAgent(agent: String, prompt: String, sceneId: String) async throws -> AgentSession {
        if status == .demo { return demoAgent(agent: agent, prompt: prompt, sceneId: sceneId) }
        guard let api, status == .online else { throw LiveError.notConnected }
        let s = try await api.startAgent(agent: agent, prompt: prompt, sceneId: sceneId)
        agentStatus[s.id] = s.status
        subscribe(Channel.agent(s.id))
        if let events = try? await api.agentEvents(s.id) { agentPush(s.id, try JSONValue(encoding: events)) }
        return s
    }

    public func cancelAgent(_ id: String) async {
        if status == .demo { agentStatus[id] = "cancelled"; return }
        _ = try? await api?.cancelAgent(id)
        unsubscribe(Channel.agent(id))
    }

    public func startCalibration(setupId: String, cameraRoi: ROIRect? = nil) async throws -> String {
        if status == .demo { return demoCalibration() }
        guard let api, status == .online else { throw LiveError.notConnected }
        let id = try await api.startCalibration(setupId: setupId, cameraRoi: cameraRoi)
        subscribe(Channel.calib(id))
        return id
    }

    public func calibrationResult(_ id: String) async throws -> CalibrationResult? {
        if status == .demo { return demo?.calibrationResult ?? Self.demoCandidates(id) }
        return try await api?.calibration(id)
    }

    // MARK: Demo helpers used by DemoState

    func setAgentEvents(_ id: String, _ events: [AgentEvent], status: String) {
        agentEvents[id] = events
        agentStatus[id] = status
    }

    func setCalibration(_ id: String, _ p: CalibrationProgress) { calibration[id] = p }
}
