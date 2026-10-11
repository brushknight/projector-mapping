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
        // Every tab's stack is filled; the board's tab is on air.
        var w = window
        if screen == .staticfx { w = (try? w.applying(.replace("/light/fx/kind", "candle"))) ?? w }
        let backdrop: JSONValue = [
            "static": ["layers": [w]],
            "live": ["layers": [sunDrift, liveWindow, tree, clouds, dayCycle]],
            "color": ["layers": [gradient]],
            "scenery": ["layers": [photo]],
        ]
        let mode = screen?.tab.rawValue ?? "live"
        scene = (try? scene.applying([.replace("/backdrop", backdrop), .replace("/mode", .string(mode))])) ?? scene
        try? db.saveSceneSnapshot(scene, version: 418)
        try? db.saveSceneList([
            SceneSummary(id: "scn_desk", name: "zimacube reveal", setupId: "set_desk", version: 418),
            SceneSummary(id: "scn_tour", name: "desk tour", setupId: "set_desk", version: 1),
            SceneSummary(id: "scn_outro", name: "outro", setupId: "set_desk", version: 1),
        ])
        // The objects board holds at cue 2 (trace), 6.4 s.
        show.transport = Transport(state: "paused", startedAt: 0, offset: 6.4, cue: 1)
        try? db.saveShow(show)

        var presets: [Preset] = []
        func p(_ id: String, _ name: String, _ mode: String, _ layers: [JSONValue]) {
            presets.append(Preset(id: id, name: name, mode: mode, backdrop: (try? JSONValue.array(layers).decode([Layer].self)).map { Backdrop(layers: $0) } ?? Backdrop()))
        }
        p("pre_golden", "golden hour", "static", [window])
        p("pre_office", "office am", "static", [(try? window.applying([.replace("/ref", "blinds"), .replace("/name", "blinds"), .replace("/light/color/kelvin", 5600)])) ?? window])
        p("pre_noir", "noir blinds", "static", [(try? window.applying([.replace("/ref", "blinds"), .replace("/name", "blinds"), .replace("/light/color/kelvin", 6500), .replace("/light/softness", 0.2)])) ?? window])
        p("pre_breezy", "breezy window", "live", [sunDrift, liveWindow, tree, clouds, dayCycle])
        p("pre_storm", "storm", "live", [liveWindow, rain, lightning])
        p("pre_sunset", "slow sunset", "live", [sunDrift, liveWindow])
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

    // MARK: Layers

    static let window: JSONValue = fixture("scene")?.value(at: "/backdrop/static/layers/0") ?? [:]
    /// The window under the live stack's shadows (its own id: layer ids are unique across stacks).
    static let liveWindow: JSONValue = fixture("scene")?.value(at: "/backdrop/live/layers/0") ?? window

    static var tree: JSONValue {
        let t = fixture("scene")?.value(at: "/backdrop/live/layers/1") ?? [:]
        return (try? t.applying(.replace("/opacity", 1))) ?? t
    }

    static func procedural(_ id: String, _ ref: String, _ name: String, _ params: JSONValue, visible: Bool = true) -> JSONValue {
        ["id": .string(id), "kind": "procedural", "ref": .string(ref), "name": .string(name), "visible": .bool(visible), "opacity": 1,
         "blend": "normal", "light": light, "params": params]
    }

    static let light: JSONValue = window["light"] ?? [:]

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
