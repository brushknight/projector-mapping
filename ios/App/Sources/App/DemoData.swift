import Foundation
import PMKit
import PMStore
import PMLive

/// Offline demo (`-pm-demo`): the contract fixtures plus the boards' own data, so every screen can be compared with
/// its board without a server. `-pm-screen <board>` picks the backdrop that board shows.
enum DemoData {
    static func fixture(_ name: String) -> JSONValue? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "fixtures"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    static func seed(_ db: AppDatabase, screen: DebugScreen?) {
        if let url = Bundle.main.url(forResource: "catalog", withExtension: "json"), let data = try? Data(contentsOf: url) {
            try? db.saveCatalog(data, version: 2)
        }
        guard var scene = fixture("scene"), let setup = fixture("setup"), var show = fixture("show").flatMap({ try? $0.decode(Show.self) }) else { return }
        try? db.saveSetup(setup, version: 3)

        scene = (try? scene.applying(.replace("/name", "zimacube reveal"))) ?? scene
        if let objects = scene["objects"]?.array {
            scene = (try? scene.applying(.replace("/objects", .array(objects + [plant])))) ?? scene
        }
        // Every tab's stack is filled; the board's tab is on air. Static and live are §15 light stacks.
        var still = staticStack
        if screen == .staticfx { still = (try? still.applying(.replace("/light/fx/kind", "candle"))) ?? still }
        if screen == .motion {
            let m = try? JSONValue(encoding: Motion.start(sunPass, serverNowMs: Date().timeIntervalSince1970 * 1000 - 140_000))
            still = (try? still.applying(.replace("/light/motion", m ?? .null))) ?? still
        }
        var live = liveStack
        live = (try? live.applying(.replace("/layers", [sunDrift, tree, clouds, dayCycle]))) ?? live
        let backdrop: JSONValue = [
            "static": still,
            "live": live,
            "color": ["layers": [gradient]],
            "scenery": ["layers": [photo]],
        ]
        let mode = screen?.tab.rawValue ?? "live"
        scene = (try? scene.applying([.replace("/backdrop", backdrop), .replace("/mode", .string(mode)), .replace("/sounds", ["pads": .array(pads)])])) ?? scene
        if screen == .videos {
            scene = (try? scene.applying(.replace("/backdrop/scenery/layers", [video]))) ?? scene
        }
        try? db.saveSceneSnapshot(scene, version: 418)
        // Two more scenes with their own looks and soundboards (protocol §14: each scene keeps its own).
        let tour = (try? scene.applying([.replace("/id", "scn_tour"), .replace("/name", "desk tour"), .replace("/mode", "live"),
                                          .replace("/sounds/pads", .array(Array(pads.prefix(3))))])) ?? scene
        let outro = (try? scene.applying([.replace("/id", "scn_outro"), .replace("/name", "outro"), .replace("/mode", "color"),
                                           .replace("/sounds/pads", [])])) ?? scene
        try? db.saveSceneSnapshot(tour, version: 12)
        try? db.saveSceneSnapshot(outro, version: 4)
        // Scenes of every kind for the picker (§15), built like the server's templates.
        let catalog = (try? db.read(Queries.catalog)) ?? .empty
        var extra: [SceneSummary] = []
        for (id, name, kind, edit) in [("scn_sun", "sun through the window", "static", [PatchOp]()),
                                        ("scn_blinds", "office blinds", "static", [.replace("/backdrop/static/attachments/0/gobo", "blinds-wide")]),
                                        ("scn_rain", "rainy evening", "live", []),
                                        ("scn_flowers", "flowers", "scenery", []),
                                        ("scn_ember", "ember glow", "color", []),
                                        ("scn_shelf", "shelf mapping", "mapping", [])] {
            var doc = SceneTemplates.document(kind: kind, id: id, name: name, setupId: "set_desk", catalog: catalog)
            doc = (try? doc.applying(edit)) ?? doc
            try? db.saveSceneSnapshot(doc, version: 2)
            extra.append(SceneSummary(id: id, name: name, setupId: "set_desk", version: 2, kind: kind))
        }
        try? db.saveSceneList([
            SceneSummary(id: "scn_desk", name: "zimacube reveal", setupId: "set_desk", version: 418, kind: "mapping", mode: mode),
            SceneSummary(id: "scn_tour", name: "desk tour", setupId: "set_desk", version: 12, kind: "mapping", mode: "live"),
            SceneSummary(id: "scn_outro", name: "outro", setupId: "set_desk", version: 4, kind: "mapping", mode: "color"),
        ] + extra)
        // The objects board holds at cue 2 (trace), 6.4 s. The phone is the audio output so the demo pads sound.
        show.transport = Transport(state: "paused", startedAt: 0, offset: 6.4, cue: 1)
        show.audio = ShowAudio(output: "phone", volume: 0.8, muted: false, loops: ["pad_rain"])
        try? db.saveShow(show)
        try? db.saveSounds(sounds)
        try? db.saveVideos(videos)

        var presets: [Preset] = []
        func p(_ id: String, _ name: String, _ mode: String, _ layers: [JSONValue]) {
            presets.append(Preset(id: id, name: name, mode: mode, backdrop: (try? JSONValue.array(layers).decode([Layer].self)).map { Backdrop(layers: $0) } ?? Backdrop()))
        }
        func stack(_ id: String, _ name: String, _ mode: String, _ json: JSONValue) {
            if let b = try? json.decode(Backdrop.self) { presets.append(Preset(id: id, name: name, mode: mode, backdrop: b.upgradedLight(stack: mode))) }
        }
        let golden = fixture("preset")?["backdrop"] ?? staticStack
        stack("pre_golden", "golden hour", "static", golden)
        stack("pre_office", "office am", "static", (try? staticStack.applying([.replace("/attachments/0/gobo", "blinds"), .replace("/attachments/0/name", "blinds"), .replace("/light/color/kelvin", 5600)])) ?? staticStack)
        stack("pre_noir", "noir blinds", "static", (try? staticStack.applying([.replace("/attachments/0/gobo", "blinds-wide"), .replace("/attachments/0/name", "wide blinds"), .replace("/light/color/kelvin", 6500), .replace("/light/focus", 0.9)])) ?? staticStack)
        stack("pre_breezy", "breezy window", "live", (try? liveStack.applying(.replace("/layers", [sunDrift, tree, clouds, dayCycle]))) ?? liveStack)
        stack("pre_storm", "storm", "live", (try? liveStack.applying(.replace("/layers", [rain, lightning]))) ?? liveStack)
        stack("pre_sunset", "slow sunset", "live", (try? liveStack.applying(.replace("/layers", [sunDrift]))) ?? liveStack)
        p("pre_ember", "ember", "color", [gradient])
        p("pre_vapor", "vaporwave", "color", [(try? gradient.applying(.replace("/params/stops", [["color": "#ff71ce", "pos": 0], ["color": "#01cdfe", "pos": 0.5], ["color": "#b967ff", "pos": 1]]))) ?? gradient])
        p("pre_lagoon", "lagoon", "color", [(try? gradient.applying([.replace("/ref", "lagoon"), .replace("/params/stops", [["color": "#00e0b8", "pos": 0], ["color": "#0057ff", "pos": 1]])])) ?? gradient])
        try? db.savePresets(presets)
        for (mode, id) in [("static", "pre_golden"), ("live", "pre_breezy"), ("color", "pre_ember"), ("scenery", "")] {
            UserDefaults.standard.set(id, forKey: "preset.\(mode)")
        }
        try? db.saveDevices([
            Device(id: "dev_out", name: "display 2", role: "output", online: true, telemetry: Telemetry(fps: 60, dropped: 0, width: 1920, height: 1080, refresh: 60)),
            Device(id: "dev_7k2", name: "Grisha's iPhone", role: "remote", online: true),
        ])
    }

    /// Opens the board's screen and puts the flow in the board's state.
    @MainActor
    static func prepare(_ model: AppModel, screen: DebugScreen?) {
        switch screen {
        case .addlayer: model.showAddLayer = true
        case .scenes: model.showScenes = true
        case .scenepreview:
            model.showScenes = true
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(2))
                model.previewScene = model.scenes.first { $0.id == "scn_sun" }
                    ?? model.scenes.first { $0.kind == "static" && $0.id != model.sceneId }
            }
        case .sounds: model.showSounds = true
        case .youtube: model.showYouTube = true
        case .setup: model.showSetup = true
        case .automap1: model.autoMapStep = 0; model.showAutoMap = true
        case .automap2:
            model.hub.demoSetCalibration("cal_demo", CalibrationProgress(step: "patterns", done: 14, total: 22, message: "gray code"))
            model.autoMapStep = 1; model.showAutoMap = true
        case .automap3:
            model.hub.demoSetCalibration("cal_demo", CalibrationProgress(step: "done", done: 22, total: 22, message: ""))
            model.autoMapStep = 2; model.showAutoMap = true
        case .automap4:
            model.hub.demoSetAgent("agt_demo", events: LiveHub.demoAgentScript, status: "running")
            model.autoMapStep = 3; model.showAutoMap = true
        default: break
        }
    }

    // MARK: Sounds and videos (protocol §14)

    static func sound(_ sha: String, _ name: String, _ duration: Double, _ peaks: [Double]) -> Asset {
        Asset(sha: sha, mime: "audio/mpeg", bytes: Int(duration * 24000), kind: "sound", name: name, duration: duration, peaks: peaks)
    }

    static func peaks(_ seed: Int, _ shape: (Double) -> Double) -> [Double] {
        (0..<48).map { i in
            let x = Double(i) / 47
            let jitter = 0.75 + 0.25 * sin(Double(i * (seed + 3)) * 1.7)
            return min(1, max(0.03, shape(x) * jitter))
        }
    }

    static let sounds: [Asset] = [
        fixture("sound").flatMap { try? $0.decode(Asset.self) } ?? sound("5d1e0a", "rain on glass", 12.48, peaks(1) { _ in 0.5 }),
        sound("a77c31", "thunder", 6.2, peaks(2) { x in x < 0.08 ? x * 12 : exp(-(x - 0.08) * 3.2) }),
        sound("b0d001", "door creak", 2.4, peaks(3) { x in 0.3 + 0.5 * sin(x * .pi) }),
        sound("c0be11", "shop bell", 3.1, peaks(4) { x in exp(-x * 4) }),
        sound("d0a1d0", "wind", 20, peaks(5) { x in 0.35 + 0.25 * sin(x * 9) }),
        sound("e0b1d5", "birds", 15, peaks(6) { x in 0.25 + 0.4 * abs(sin(x * 23)) }),
        sound("f0c0c0", "knock knock", 1.2, peaks(7) { x in x.truncatingRemainder(dividingBy: 0.25) < 0.06 ? 0.9 : 0.05 }),
        sound("9a0b0c", "music box", 30, peaks(8) { x in 0.3 + 0.3 * abs(sin(x * 40)) }),
    ]

    static let pads: [JSONValue] = {
        func pad(_ id: String, _ name: String, _ sound: String, _ color: String, _ icon: String, _ key: String, loop: Bool = false, volume: Double = 1) -> JSONValue {
            ["id": .string(id), "name": .string(name), "sound": .string(sound), "volume": .number(volume), "color": .string(color),
             "icon": .string(icon), "key": .string(key), "loop": .bool(loop)]
        }
        return [
            pad("pad_thunder", "thunder", "a77c31", "blue", "thunder", "t", volume: 0.9),
            pad("pad_rain", "rain", "5d1e0a", "teal", "rain", "r", loop: true, volume: 0.6),
            pad("pad_door", "door", "b0d001", "amber", "door", "d"),
            pad("pad_bell", "bell", "c0be11", "ink", "bell", "b"),
            pad("pad_wind", "wind", "d0a1d0", "violet", "wind", "w", loop: true, volume: 0.7),
            pad("pad_birds", "birds", "e0b1d5", "green", "bird", "g", loop: true),
            pad("pad_knock", "knock", "f0c0c0", "pink", "knock", "k"),
            pad("pad_music", "music box", "9a0b0c", "red", "music", "m", loop: true, volume: 0.5),
        ]
    }()

    /// Demo video tiles; `thumb` names a bundled photo so they draw offline (real thumbs are asset shas).
    static let videos: [Video] = [
        Video(id: "vid_ocean", name: "ocean loop", ref: "asset:demo_ocean", source: "file", sha: "demo_ocean", thumb: "ocean", duration: 24, width: 1920, height: 1080),
        Video(id: "vid_bunny", name: "big buck bunny", ref: "youtube:aqz-KE-bpKQ", source: "youtube", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
              youtubeId: "aqz-KE-bpKQ", thumb: "tropical", duration: 20),
        Video(id: "vid_falls", name: "waterfall", ref: "asset:demo_falls", source: "youtube", url: "https://youtu.be/aqz-KE-bpKQ", youtubeId: "aqz-KE-bpKQ",
              sha: "demo_falls", thumb: "waterfall", duration: 18, width: 3840, height: 2160),
        Video(id: "vid_forest", name: "forest rain", ref: "asset:demo_forest", source: "file", sha: "demo_forest", thumb: "forest", duration: 32, width: 1920, height: 1080),
    ]

    static let video: JSONValue = [
        "id": "lay_photo", "kind": "video", "ref": "asset:demo_ocean", "name": "ocean loop", "visible": true, "opacity": 1, "blend": "normal", "light": nil,
        "params": ["blur": 0.62, "brightness": 0.7, "warmth": 0.1, "drift": 0.1, "start": 4, "end": 0, "audio": false, "volume": 1],
    ]

    /// A short generated WAV standing in for a demo sound (noise for weather and doors, a decaying tone for the rest).
    static func soundFile(_ sha: String) -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("projmap-demo-sounds", isDirectory: true)
        let url = dir.appendingPathComponent("\(sha).wav")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = sounds.first { $0.sha == sha }?.name ?? sha
        let rate = 22050, seconds = 1.6
        let noisy = ["rain", "wind", "thunder", "door"].contains { name.contains($0) }
        let freq = 440.0 * pow(2, Double(abs(sha.hashValue % 12)) / 12)
        var samples = [Int16]()
        var seed: UInt32 = 12345
        var low = 0.0
        for i in 0..<Int(Double(rate) * seconds) {
            let t = Double(i) / Double(rate)
            let env = min(1, t * 40) * exp(-t * (noisy ? 1.4 : 3))
            var v: Double
            if noisy {
                seed = seed &* 1_664_525 &+ 1_013_904_223
                let white = Double(seed >> 8) / Double(1 << 24) * 2 - 1
                low += (white - low) * (name.contains("thunder") ? 0.05 : 0.3)
                v = low * (name.contains("thunder") ? 3 : 1)
            } else {
                v = sin(2 * .pi * freq * t) * 0.6 + sin(4 * .pi * freq * t) * 0.2
            }
            samples.append(Int16(max(-1, min(1, v * env * 0.5)) * 32767))
        }
        var data = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        let bytes = UInt32(samples.count * 2)
        data.append(contentsOf: Array("RIFF".utf8)); u32(36 + bytes); data.append(contentsOf: Array("WAVEfmt ".utf8))
        u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        data.append(contentsOf: Array("data".utf8)); u32(bytes)
        samples.withUnsafeBytes { data.append(contentsOf: $0) }
        try? data.write(to: url)
        return url
    }

    // MARK: Layers

    /// The fixture's static stack: a light with one window attachment (§15).
    static let staticStack: JSONValue = fixture("scene")?.value(at: "/backdrop/static") ?? ["layers": []]
    /// The live stack's light and window (their own ids: ids are unique across stacks).
    static let liveStack: JSONValue = fixture("scene")?.value(at: "/backdrop/live") ?? ["layers": []]

    /// "sun passes left to right" (the catalog preset), for the motion screen.
    static var sunPass: Motion {
        Motion(on: true, preset: "sun-lr", from: FramePoint(x: -0.6, y: 0.08), via: FramePoint(x: 0, y: -0.04), to: FramePoint(x: 0.6, y: 0.08),
               duration: 600, easing: "inOut", loop: "loop", rotate: 8)
    }

    static var tree: JSONValue {
        let t = fixture("scene")?.value(at: "/backdrop/live/layers/0") ?? [:]
        return (try? t.applying(.replace("/opacity", 1))) ?? t
    }

    static func procedural(_ id: String, _ ref: String, _ name: String, _ params: JSONValue, visible: Bool = true) -> JSONValue {
        ["id": .string(id), "kind": "procedural", "ref": .string(ref), "name": .string(name), "visible": .bool(visible), "opacity": 1,
         "blend": "normal", "light": light, "params": params]
    }

    static let light: JSONValue = (try? JSONValue(encoding: Light())) ?? [:]

    static let sunDrift = procedural("lay_sun", "sun-drift", "sun drift", ["speed": 0.1, "travel": 0.3, "fromKelvin": 3200, "toKelvin": 5600, "minutes": 20])
    static let clouds = procedural("lay_clouds", "clouds", "clouds passing", ["speed": 0.2, "density": 0.5, "softness": 0.8])
    static let dayCycle = procedural("lay_day", "day-cycle", "day cycle", ["fromKelvin": 3200, "toKelvin": 5600, "minutes": 20])
    static let rain = procedural("lay_rain", "rain-glass", "rain on glass", ["amount": 0.5, "speed": 0.4, "drops": 0.6])
    static let lightning = procedural("lay_bolt", "lightning", "lightning", ["frequency": 0.2, "brightness": 0.9])

    static let gradient: JSONValue = [
        "id": "lay_grad", "kind": "gradient", "ref": "ember", "name": "ember", "visible": true, "opacity": 1, "blend": "normal",
        "params": ["stops": [["color": "#ff4d00", "pos": 0], ["color": "#ff2e63", "pos": 0.5], ["color": "#6a00f4", "pos": 1]],
                   "angle": 135, "drift": 0.24, "grain": 0.12, "brightness": 0.9],
    ]

    static let photo: JSONValue = [
        "id": "lay_photo", "kind": "photo", "ref": "flowers", "name": "flowers", "visible": true, "opacity": 1, "blend": "normal",
        "params": ["blur": 0.74, "brightness": 0.66, "warmth": 0.16, "drift": 0.1],
    ]

    /// The board's fourth object (Objects tab: "plant · outline · mask · off").
    static let plant: JSONValue = [
        "id": "obj_plant", "name": "plant", "tags": [], "visible": true,
        "surfaces": [
            ["id": "srf_plant", "name": "outline", "kind": "poly", "role": "face", "pointIds": ["p_shelf0", "p_shelf1", "p_shelf2"], "parentId": nil,
             "visible": true, "mesh": nil, "effects": [], "opacity": 1, "softEdge": 0],
            ["id": "srf_plant_mask", "name": "mask", "kind": "mask", "role": "detail", "pointIds": ["p_shelf0", "p_shelf1", "p_shelf2"], "parentId": "srf_plant",
             "visible": true, "mesh": nil, "effects": [], "opacity": 1, "softEdge": 0],
        ],
    ]
}
