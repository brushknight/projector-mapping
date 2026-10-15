import Foundation
import PMKit
import PMStore

/// State for the offline demo (`-pm-demo`): commands and edits apply to the local store as the server would.
struct DemoState {
    var calibrationResult: CalibrationResult?
}

extension LiveHub {
    func demoCommit(sceneId: String, clientId: String) {
        guard let item = (try? db.pendingItems())?.first(where: { $0.clientId == clientId }), let intent = item.scene,
              let doc = (try? db.confirmedScene(sceneId)).flatMap({ $0 }), let version = (try? db.sceneVersion(sceneId)).flatMap({ $0 }),
              let ops = intent.ops(on: doc)
        else { try? db.removeOutbox(clientId); return }
        _ = try? db.applyScenePatch(sceneId, ops: ops, version: version + 1, ack: clientId)
    }

    func demoRest(_ intent: RestIntent) {
        switch intent {
        case .createPreset(let name, let mode, let sceneId, _):
            let scene = (try? db.sceneDoc(sceneId)).flatMap { $0 }.flatMap { try? $0.decode(Scene.self) }
            let backdrop = Backdrop(layers: scene?.layers(mode) ?? [])
            try? db.addPendingPreset(Preset(id: "pre_\(UUID().uuidString.prefix(6).lowercased())", name: name, mode: mode, backdrop: backdrop))
        case .deletePreset(let id):
            try? db.removePreset(id)
        }
    }

    func demoCommand(_ name: String, _ args: JSONValue) throws -> JSONValue? {
        let state = (try? db.read(Queries.active)) ?? ActiveState()
        var show = state.show ?? Show()
        let cues = state.scene?.timeline.cues ?? []
        let nowNs = Int64(now() * 1e9)
        switch name {
        case "show.blackout":
            show.onAir = !(args["on"]?.bool ?? show.onAir)
        case "show.go":
            guard !cues.isEmpty else { throw WireError(code: "no_cues", message: "This scene has no cues.") }
            let next = show.transport.state == "stopped" && show.transport.offset == 0 && show.transport.cue == 0 ? 0 : min(show.transport.cue + 1, cues.count - 1)
            show.transport = Transport(state: "playing", startedAt: nowNs, offset: cues[next].at, cue: next)
            if let cs = cues[next].sound, !cs.sound.isEmpty {
                demoSound(.play(SoundPlay(playId: Self.demoPlayId(), sound: cs.sound, cueId: cues[next].id, name: cues[next].label, volume: cs.volume)), show: show)
            }
        case "sound.play", "sound.stop", "show.audio":
            let result = try demoSoundCommand(name, args, show: &show, scene: state.scene)
            show.version += 1
            try? db.saveShow(show)
            return result
        case "show.back":
            guard !cues.isEmpty else { return nil }
            let prev = max(show.transport.cue - 1, 0)
            show.transport = Transport(state: "paused", startedAt: 0, offset: cues[prev].at, cue: prev)
        case "show.stop":
            show.transport = Transport()
            if !show.audio.loops.isEmpty { demoSound(.stop(SoundStop()), show: show) }
            show.audio.loops = []
        case "show.play":
            show.transport = Transport(state: "playing", startedAt: nowNs, offset: show.transport.offset, cue: show.transport.cue)
        case "show.pause":
            show.transport = Transport(state: "paused", startedAt: 0, offset: show.transport.playhead(serverNowMs: now() * 1000), cue: show.transport.cue)
        case "show.seek":
            let t = args["t"]?.double ?? 0
            let cue = cues.lastIndex { $0.at <= t } ?? 0
            show.transport = Transport(state: show.transport.state, startedAt: nowNs, offset: t, cue: cue)
        case "scene.mode":
            if let sceneId = state.scene?.id, let mode = args["mode"]?.string {
                edit(sceneId: sceneId, .setMode(mode))
            }
            return nil
        case "show.activate":
            if let id = args["sceneId"]?.string {
                show.activeSceneId = id
                show.transport = Transport()
                // §15: activating a scene puts its kind's mode on air.
                if let doc = (try? db.confirmedScene(id)) ?? nil, let scene = try? doc.decode(Scene.self),
                   let version = (try? db.sceneVersion(id)) ?? nil {
                    let mode = SceneKind.mode(scene.kind)
                    if scene.mode != mode {
                        let op: PatchOp = doc["mode"] == nil ? .add("/mode", .string(mode)) : .replace("/mode", .string(mode))
                        _ = try? db.applyScenePatch(id, ops: [op], version: version + 1)
                    }
                }
                if !show.audio.loops.isEmpty { demoSound(.stop(SoundStop()), show: show) }
                show.audio.loops = []
            }
        case "setup.testPattern":
            if let setupId = state.setup?.id, let pattern = args["pattern"]?.string {
                let seconds = min(600, max(1, args["seconds"]?.double ?? 60))
                let until: JSONValue = pattern == "off" ? .null : .number((now() + seconds) * 1e9)
                try? db.applySetupPatch(setupId, ops: [.replace("/testPattern", .string(pattern)), .add("/testPatternUntil", until)], version: nil)
            }
            return nil
        default:
            return nil
        }
        show.version += 1
        try? db.saveShow(show)
        return nil
    }

    func demoCalibration() -> String {
        let id = "cal_demo"
        demo?.calibrationResult = Self.demoCandidates(id)
        Task {
            for n in 0...22 {
                setCalibration(id, CalibrationProgress(step: "patterns", done: n, total: 22, message: "gray code"))
                try? await Task.sleep(for: .milliseconds(450))
            }
            setCalibration(id, CalibrationProgress(step: "matching", done: 22, total: 22, message: ""))
            try? await Task.sleep(for: .seconds(1.5))
            setCalibration(id, CalibrationProgress(step: "surfaces", done: 22, total: 22, message: ""))
            try? await Task.sleep(for: .seconds(1.5))
            setCalibration(id, CalibrationProgress(step: "done", done: 22, total: 22, message: "3 surfaces found"))
        }
        return id
    }

    func demoAgent(agent: String, prompt: String, sceneId: String) -> AgentSession {
        let id = "agt_demo"
        let script = Self.demoAgentScript
        setAgentEvents(id, [], status: "running")
        Task {
            var events: [AgentEvent] = []
            for e in script {
                try? await Task.sleep(for: .milliseconds(700))
                events.append(e)
                setAgentEvents(id, events, status: "running")
            }
        }
        return AgentSession(id: id, agent: agent, prompt: prompt, status: "running", sceneId: sceneId, draftId: "drf_demo")
    }

    /// The board's log (phone-automap4).
    public static let demoAgentScript: [AgentEvent] = [
        AgentEvent(seq: 1, kind: "tool", tool: "camera_snapshot", text: "", durationMs: 400, ok: true),
        AgentEvent(seq: 2, kind: "tool", tool: "detect_surfaces", text: "zimacube", durationMs: 1100, ok: true),
        AgentEvent(seq: 3, kind: "tool", tool: "surface_create", text: "top, left, right", durationMs: 200, ok: true),
        AgentEvent(seq: 4, kind: "tool", tool: "surface_create", text: "4 bays, fan", durationMs: 300, ok: true),
        AgentEvent(seq: 5, kind: "tool", tool: "project_outline → snapshot", text: "", durationMs: 1600, ok: true),
        AgentEvent(seq: 6, kind: "tool", tool: "compare", text: "right face off 3 px → nudged", durationMs: 900, ok: true),
        AgentEvent(seq: 7, kind: "tool", tool: "project_outline → snapshot", text: "", durationMs: nil, ok: nil),
    ]

    /// Candidates as the board draws them (camera view 370×278).
    static func demoCandidates(_ id: String) -> CalibrationResult? {
        let w = 370.0, h = 278.0
        func f(_ pts: [(Double, Double)]) -> [[Double]] { pts.map { [$0.0 / w, $0.1 / h] } }
        let json: JSONValue = [
            "id": .string(id), "status": "done",
            "quality": ["coverage": 0.94, "errorPx": 0.6],
            "objects": [
                ["id": "zimacube", "name": "zimacube", "faces": 3,
                 "outline": try! JSONValue(encoding: f([(173.9, 100.1), (223.9, 127.9), (223.9, 183.5), (173.9, 211.3), (123.9, 183.5), (123.9, 127.9)]))],
                ["id": "lamp", "name": "lamp", "faces": 1,
                 "outline": try! JSONValue(encoding: f([(281, 56), (326, 56), (326, 178), (281, 178)]))],
                ["id": "frame", "name": "frame", "faces": 1,
                 "outline": try! JSONValue(encoding: f([(18, 39), (85, 39), (85, 133), (18, 133)]))],
            ],
        ]
        return try? json.decode(CalibrationResult.self)
    }
}

extension LiveHub {
    /// Demo and screenshots only: puts the agent log in a given state.
    public func demoSetAgent(_ id: String, events: [AgentEvent], status: String) { setAgentEvents(id, events, status: status) }
    /// Demo and screenshots only: puts a calibration at a given step.
    public func demoSetCalibration(_ id: String, _ p: CalibrationProgress) {
        if demo?.calibrationResult == nil { demo?.calibrationResult = Self.demoCandidates(id) }
        setCalibration(id, p)
    }
}
