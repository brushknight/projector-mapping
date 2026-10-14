import Foundation
import Testing
@testable import PMKit
import PMTestSupport

/// Every fixture in `contract/fixtures` decodes into its model (protocol rule: all three clients decode all fixtures).
@Suite struct ContractTests {
    static let models: [String: @Sendable (Data) throws -> Any] = [
        "agent-event.json": { try JSONDecoder().decode(AgentEvent.self, from: $0) },
        "agent-session.json": { try JSONDecoder().decode(AgentSession.self, from: $0) },
        "asset.json": { try JSONDecoder().decode(Asset.self, from: $0) },
        "device.json": { try JSONDecoder().decode(Device.self, from: $0) },
        "draft.json": { try JSONDecoder().decode(Draft.self, from: $0) },
        "effect-glsl.json": { try JSONDecoder().decode(Effect.self, from: $0) },
        "preset.json": { try JSONDecoder().decode(Preset.self, from: $0) },
        "scene.json": { try JSONDecoder().decode(Scene.self, from: $0) },
        "setup.json": { try JSONDecoder().decode(Setup.self, from: $0) },
        "show.json": { try JSONDecoder().decode(Show.self, from: $0) },
        "ws-messages.json": { try JSONDecoder().decode([Envelope].self, from: $0) },
    ]

    @Test func everyFixtureHasAModel() throws {
        let names = try Fixtures.all().map(\.lastPathComponent)
        #expect(!names.isEmpty)
        for name in names { #expect(Self.models[name] != nil, "no decoder for fixture \(name)") }
    }

    @Test(arguments: try! Fixtures.all())
    func fixtureDecodes(_ url: URL) throws {
        let data = try Data(contentsOf: url)
        let decode = try #require(Self.models[url.lastPathComponent])
        _ = try decode(data)
    }

    @Test func sceneFixtureValues() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        #expect(scene.id == "scn_desk")
        #expect(scene.mode == "static")
        #expect(scene.layers("static").map(\.id) == ["lay_window"])
        #expect(scene.layers("live").map(\.id) == ["lay_live_window", "lay_tree"])
        #expect(scene.layers("color").map(\.ref) == ["ember"])
        #expect(scene.layers("scenery").map(\.ref) == ["flowers"])
        #expect(scene.layers("objects").isEmpty)
        #expect(scene.onAirLayers.map(\.id) == ["lay_window"])
        #expect(scene.underlay == Underlay(on: false, from: "static", level: 0.35))
        #expect(scene.layers("static")[0].light?.color.kelvin == 3200)
        #expect(scene.layers("live")[1].param("wind") == 0.4)
        // The drawing effect's strokes stay as JSON (array params).
        let draw = try #require(scene.objects[0].surfaces.first { $0.id == "srf_left" }?.effects.first)
        #expect(draw.effect == "drawing")
        #expect(draw.name == "sketch")
        #expect(draw.params["strokes"]?.array?.count == 5)
        #expect(draw.params["strokes"]?.array?[3]["tool"] == "polygon")
        #expect(draw.params["strokes"]?.array?[2]["text"] == "hello")
        #expect(draw.params["reveal"]?.double == 1)
        #expect(scene.objects.map(\.name) == ["zimacube", "desk lamp", "shelf"])
        #expect(scene.objects[0].faces == 3)
        #expect(scene.timeline.cues.count == 6)
        #expect(scene.timeline.cues[1].label == "trace")
        #expect(scene.points.count == 41)
    }

    @Test func showKeepsNanoseconds() throws {
        let show = try JSONDecoder().decode(Show.self, from: Fixtures.data("show"))
        #expect(show.transport.startedAt == 1_791_700_000_123_456_789)
        #expect(show.transport.cue == 1)
        // playhead = offset + (serverNow − startedAt) / 1e9
        let t = show.transport.playhead(serverNowMs: 1_791_700_002_123.456789)
        #expect(abs(t - 8.4) < 0.001)
        #expect(show.solo == Solo(surfaceIds: ["srf_top", "srf_left"], fill: "grid", until: 1_791_700_060_123_456_789))
    }

    @Test func contentLayersDecodeAndSurviveARoundTrip() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        let cube = scene.objects[0]
        #expect(cube.atlas?["width"]?.double == 618)
        #expect(cube.layers?.array?.first?["id"] == "cl_sweep")
        #expect(cube.surfaces.first { $0.id == "srf_right" }?.layers?.array?.first?["src"] == "flowers")
        #expect(scene.objects[1].layers == nil && scene.objects[1].atlas == nil)
        #expect(scene.timeline.tracks.last?.target.kind == "layer")
        #expect(scene.timeline.tracks.last?.target.id == "cl_sweep")
        let again = try JSONDecoder().decode(MapObject.self, from: JSONEncoder().encode(cube))
        #expect(again == cube)
    }

    @Test func setupTestPatternExpiry() throws {
        var setup = try JSONDecoder().decode(Setup.self, from: Fixtures.data("setup"))
        #expect(setup.testPattern == "off" && setup.testPatternUntil == nil)
        setup = try JSONDecoder().decode(Setup.self, from: Data(#"{"id":"s","testPattern":"grid","testPatternUntil":1791700060000000000}"#.utf8))
        #expect(setup.testPatternUntil == 1_791_700_060_000_000_000)
        #expect(setup.activeTestPattern(serverNowMs: 1_791_700_000_000) == "grid")
        #expect(setup.testPatternRemaining(serverNowMs: 1_791_700_000_000) == 60)
        #expect(setup.activeTestPattern(serverNowMs: 1_791_700_060_001) == "off")
        #expect(setup.testPatternRemaining(serverNowMs: 1_791_700_060_001) == nil)
    }

    @Test func legacyBackdropSplitsByKind() throws {
        let json = #"{"id":"s","backdrop":{"layers":[{"id":"g","kind":"gobo","ref":"window","light":{}},{"id":"t","kind":"procedural","ref":"tree-sway","light":{}},{"id":"c","kind":"gradient","ref":"ember"},{"id":"p","kind":"photo","ref":"flowers"}]}}"#
        let scene = try JSONDecoder().decode(Scene.self, from: Data(json.utf8))
        #expect(scene.mode == "live")
        #expect(scene.layers("static").map(\.id) == ["g"])
        #expect(scene.layers("live").map(\.id) == ["g_live", "t"])
        #expect(scene.layers("color").map(\.id) == ["c"])
        #expect(scene.layers("scenery").map(\.id) == ["p"])
    }

    @Test func objectsModeDrawsTheUnderlayOnly() throws {
        var doc = try Fixtures.json("scene")
        doc = try doc.applying([.replace("/mode", "objects")])
        #expect(try doc.decode(Scene.self).onAirLayers.isEmpty)
        doc = try doc.applying([.replace("/underlay/on", true), .replace("/underlay/from", "color")])
        #expect(try doc.decode(Scene.self).onAirLayers.map(\.id) == ["lay_ember"])
    }

    @Test func toleratesUnknownAndMissingFields() throws {
        let json = #"{"id":"lay_x","kind":"gobo","ref":"spot","future":{"x":1},"light":{"intensity":"oops"}}"#
        let layer = try JSONDecoder().decode(Layer.self, from: Data(json.utf8))
        #expect(layer.visible == true)
        #expect(layer.opacity == 1)
        #expect(layer.light?.intensity == 0.8)
        #expect(layer.light?.color.mode == "cct")
    }

    @Test func everyWSMessageDecodesWithItsPayload() throws {
        for raw in try Fixtures.wsMessages() {
            let env = try Envelope.decode(raw.jsonText)
            switch env.t {
            case "hello": _ = try #require(env.d).decode(Hello.self)
            case "welcome":
                let w = try #require(env.d).decode(Welcome.self)
                // Through JSONValue (a Double) the nanoseconds keep ~100 ns precision, plenty for a playhead.
                #expect(abs(w.serverTime - 1_791_700_000_123_456_789) < 1000)
                #expect(w.show?.activeSceneId == "scn_desk")
            case "ping": #expect(env.d?["t0"]?.double != nil)
            case "pong": #expect(env.d?["ts"]?.double != nil)
            case "sub": #expect(env.ch == "scene:scn_desk")
            case "snapshot": _ = try #require(env.d).decode(Setup.self); #expect(env.v == 3)
            case "param": _ = try #require(env.d).decode(ParamMessage.self)
            case "patch":
                let p = try #require(PatchedMessage(env.d))
                if env.id == "c-80" {
                    #expect(p.ops == [.replace("/mode", "objects")])
                } else {
                    #expect(p.ops.first?.op == .add)
                    #expect(env.base == 419)
                }
            case "patched":
                let p = try #require(PatchedMessage(env.d))
                #expect(p.by == "dev_7k2")
                #expect(env.v == 420 && env.re == "c-77")
            case "reject":
                #expect(try #require(env.d).decode(WireError.self).code == "stale")
                #expect(env.v == 421)
            case "cmd": #expect(["show.go", "scene.mode", "setup.testPattern"].contains(env.d?["name"]?.string ?? ""))
            case "ack": #expect(env.re == "c-78")
            case "error": #expect(try #require(env.d).decode(WireError.self).code == "no_scene")
            case "rpc": _ = try #require(env.d).decode(RPCRequest.self)
            case "rpc.result": #expect(env.re == "r-1")
            case "telemetry": _ = try #require(env.d).decode(Telemetry.self)
            default: Issue.record("unhandled message type \(env.t)")
            }
            // Round trip keeps the envelope.
            #expect(try Envelope.decode(env.text) == env)
        }
    }

    @Test func catalogKeepsParamOrder() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        #expect(cat.version == 2)
        let drawing = try #require(cat.effects.first { $0.id == "drawing" })
        #expect(drawing.params["strokes"]?["type"] == "strokes")
        #expect(cat.gobos.count == 8)
        #expect(cat.procedural("tree-sway")?.params.items.map(\.key) == ["wind", "gust", "focus", "seed"])
        #expect(cat.photoParams.items.map(\.key) == ["blur", "brightness", "warmth", "drift"])
        #expect(cat.gradientParams.items.map(\.key) == ["angle", "drift", "grain", "brightness"])
        #expect(cat.light?.params.items.map(\.key) == ["intensity", "softness", "angle", "scale"])
        #expect(cat.gradient("ember")?.stops.count == 3)
        #expect(cat.scenery.count == 12)
        #expect(cat.effects.first { $0.id == "trace" }?.group == "outline")
    }

    @Test func paramSpecFractions() {
        let angle = ParamSpec(type: "number", min: -90, max: 90)
        #expect(angle.fraction(-22) == 68.0 / 180)
        #expect(angle.value(at: 0.5) == 0)
        let seed = ParamSpec(type: "integer", min: 0, max: 999)
        #expect(seed.value(at: 0.0071) == 7)
    }
}

@Suite struct JSONPatchTests {
    let doc: JSONValue = ["a": ["b": 1, "list": [1, 2, 3]], "x/y": "slash", "t~": "tilde"]

    @Test func replaceAddRemove() throws {
        var d = try doc.applying(.replace("/a/b", 2))
        #expect(d.value(at: "/a/b") == 2)
        d = try d.applying(.add("/a/list/1", 9))
        #expect(d.value(at: "/a/list") == [1, 9, 2, 3])
        d = try d.applying(.add("/a/list/-", 4))
        #expect(d.value(at: "/a/list") == [1, 9, 2, 3, 4])
        d = try d.applying(.remove("/a/list/0"))
        #expect(d.value(at: "/a/list") == [9, 2, 3, 4])
        d = try d.applying(.add("/a/new", "v"))
        #expect(d.value(at: "/a/new") == "v")
    }

    @Test func moveAndCopy() throws {
        let d = try doc.applying(.move(from: "/a/list/0", to: "/a/list/2"))
        #expect(d.value(at: "/a/list") == [2, 3, 1])
        let c = try doc.applying(PatchOp(.copy, "/c", from: "/a/b"))
        #expect(c.value(at: "/c") == 1)
    }

    @Test func escapedPointers() throws {
        #expect(doc.value(at: "/x~1y") == "slash")
        #expect(doc.value(at: "/t~0") == "tilde")
        #expect(JSONPointer.join(["x/y", "t~"]) == "/x~1y/t~0")
    }

    @Test func errorsLeaveNothingHalfDone() {
        #expect(throws: JSONPatchError.self) { try doc.applying([.replace("/a/b", 5), .replace("/missing/x", 1)]) }
        #expect(throws: JSONPatchError.self) { try doc.applying(.remove("/a/list/7")) }
        #expect(throws: JSONPatchError.self) { try doc.applying(PatchOp(.test, "/a/b", value: 2)) }
        #expect(throws: JSONPatchError.self) { try doc.applying(.replace("/a/nope", 1)) }
    }

    @Test func fixturePatchAddsLayer() throws {
        let scene = try Fixtures.json("scene")
        let patch = try #require(try Fixtures.wsMessages().first { $0["t"] == "patch" })
        let ops = try #require(PatchedMessage(patch["d"])).ops
        let next = try scene.applying(ops)
        #expect(next.value(at: "/backdrop/live/layers")?.array?.count == 3)
        #expect(next.value(at: "/backdrop/live/layers/2/ref") == "tree-sway")
    }

    @Test func leafReplaceDetection() {
        #expect(PatchOp.replace("/a", 1).isLeafReplace)
        #expect(!PatchOp.replace("/a", ["x": 1]).isLeafReplace)
        #expect(!PatchOp.add("/a", 1).isLeafReplace)
    }
}

@Suite struct SceneIntentTests {
    @Test func layerFieldFollowsTheLayerId() throws {
        var scene = try Fixtures.json("scene")
        let intent = SceneIntent.setLayerField(layerId: "lay_tree", field: ["visible"], value: false)
        #expect(intent.ops(on: scene) == [.replace("/backdrop/live/layers/1/visible", false)])
        // Someone else moved the tree layer to the bottom: the intent still finds it.
        scene = try scene.applying(.move(from: "/backdrop/live/layers/1", to: "/backdrop/live/layers/0"))
        #expect(intent.ops(on: scene) == [.replace("/backdrop/live/layers/0/visible", false)])
        // Deleted: nothing to do.
        scene = try scene.applying(.remove("/backdrop/live/layers/0"))
        #expect(intent.ops(on: scene) == nil)
    }

    @Test func missingParentsAreCreated() throws {
        let doc: JSONValue = ["backdrop": ["color": ["layers": [["id": "l1", "kind": "solid", "params": [:]]]]]]
        let ops = try #require(SceneIntent.setLayerField(layerId: "l1", field: ["light", "intensity"], value: 0.5).ops(on: doc))
        #expect(ops == [.add("/backdrop/color/layers/0/light", [:]), .add("/backdrop/color/layers/0/light/intensity", 0.5)])
        let next = try doc.applying(ops)
        #expect(next.value(at: "/backdrop/color/layers/0/light/intensity") == 0.5)
    }

    @Test func addMoveRemove() throws {
        let scene = try Fixtures.json("scene")
        #expect(SceneIntent.addLayer(mode: "live", layer: ["id": "n"], index: nil).ops(on: scene) == [.add("/backdrop/live/layers/-", ["id": "n"])])
        #expect(SceneIntent.addLayer(mode: "live", layer: ["id": "n"], index: 0).ops(on: scene) == [.add("/backdrop/live/layers/0", ["id": "n"])])
        #expect(SceneIntent.moveLayer(layerId: "lay_live_window", to: 5).ops(on: scene) == [.move(from: "/backdrop/live/layers/0", to: "/backdrop/live/layers/1")])
        #expect(SceneIntent.removeLayer(layerId: "lay_tree").ops(on: scene) == [.remove("/backdrop/live/layers/1")])
        // A single-layer stack does not move.
        #expect(SceneIntent.moveLayer(layerId: "lay_window", to: 5).ops(on: scene) == [])
        // A document without the stack gets it created.
        let bare: JSONValue = ["id": "s", "backdrop": [:]]
        let ops = try #require(SceneIntent.addLayer(mode: "live", layer: ["id": "n"], index: nil).ops(on: bare))
        #expect(try bare.applying(ops).value(at: "/backdrop/live/layers/0/id") == "n")
    }

    @Test func openingATabPutsItsModeOnAir() throws {
        let scene = try Fixtures.json("scene")
        #expect(SceneIntent.setMode("live").ops(on: scene) == [.replace("/mode", "live")])
        #expect(SceneIntent.setMode("static").ops(on: scene) == [])
        #expect(try #require(SceneIntent.setMode("objects").ops(on: scene)).allSatisfy(\.isLeafReplace))
    }

    @Test func staticPickReplacesTheStackAndKeepsTheLight() throws {
        var scene = try Fixtures.json("scene")
        let old = try #require(try scene.decode(Scene.self).layers("static").first)
        let layer = StackPick.gobo(id: "blinds", name: "blinds", keeping: old, id: "lay_new")
        let ops = try #require(SceneIntent.replaceStack(mode: "static", layers: [layer]).ops(on: scene))
        #expect(ops == [.replace("/backdrop/static/layers", [layer])])
        scene = try scene.applying(ops)
        let picked = try scene.decode(Scene.self).layers("static")
        #expect(picked.map(\.ref) == ["blinds"])
        #expect(picked[0].id == "lay_window")
        #expect(picked[0].light == old.light)
        // Without a previous gobo the light is the default one.
        #expect(try StackPick.gobo(id: "spot", name: "spot", keeping: nil, id: "lay_x").decode(Layer.self).light == Light())
    }

    @Test func sceneryPickReplacesAndKeepsTheAdjustments() throws {
        var scene = try Fixtures.json("scene")
        scene = try scene.applying(.replace("/backdrop/scenery/layers/0/params/blur", 0.2))
        let old = try #require(try scene.decode(Scene.self).layers("scenery").first)
        let layer = StackPick.photo(ref: "city-bokeh", name: "city bokeh", defaults: ["blur": 0.74, "brightness": 0.66, "warmth": 0, "drift": 0.1], keeping: old, id: "lay_new")
        scene = try scene.applying(try #require(SceneIntent.replaceStack(mode: "scenery", layers: [layer]).ops(on: scene)))
        let picked = try scene.decode(Scene.self).layers("scenery")
        #expect(picked.map(\.ref) == ["city-bokeh"])
        #expect(picked[0].param("blur") == 0.2)
        #expect(picked[0].param("brightness") == old.param("brightness"))
        // A gradient pick replaces the color stack with the catalog's defaults.
        let g = StackPick.gradient(ref: "lagoon", name: "lagoon", defaults: ["angle": 90], keeping: nil, id: "lay_g")
        scene = try scene.applying(try #require(SceneIntent.replaceStack(mode: "color", layers: [g]).ops(on: scene)))
        #expect(try scene.decode(Scene.self).layers("color").map(\.ref) == ["lagoon"])
    }

    @Test func presetApplySwitchesTheMode() throws {
        let scene = try Fixtures.json("scene")
        let preset = try JSONDecoder().decode(Preset.self, from: Fixtures.data("preset"))
        let backdrop = try JSONValue(encoding: preset.backdrop)
        let ops = try #require(SceneIntent.applyPreset(mode: "live", backdrop: backdrop).ops(on: scene))
        #expect(ops == [.replace("/backdrop/live", backdrop), .replace("/mode", "live")])
        let next = try scene.applying(ops).decode(Scene.self)
        #expect(next.mode == "live")
        #expect(next.layers("live").map(\.id) == ["lay_window"])
        #expect(next.layers("static").map(\.id) == ["lay_window"])
    }

    @Test func intentsRoundTripThroughJSON() throws {
        let i = SceneIntent.setLayerField(layerId: "a", field: ["params", "stops"], value: [["color": "#fff", "pos": 0]])
        let back = try JSONDecoder().decode(SceneIntent.self, from: JSONEncoder().encode(i))
        #expect(back == i)
    }
}

@Suite struct ConnectLinkTests {
    @Test func parsesCodeLinks() throws {
        let l = try #require(ConnectLink("projmap://connect?server=studio-mac.local&code=k7q2"))
        #expect(l.server.absoluteString == "http://studio-mac.local:7400")
        #expect(l.code == "K7Q2")
        #expect(ConnectLink("projmap://connect?server=10.0.0.5:7401&token=abc")?.server.absoluteString == "http://10.0.0.5:7401")
        #expect(ConnectLink("projmap://connect?server=x") == nil)
        #expect(ConnectLink("cmm://connect?server=x&code=1234") == nil)
    }

    @Test func urls() {
        let api = APIClient(server: URL(string: "http://studio-mac.local:7400")!, token: "tok")
        #expect(api.webSocketURL.absoluteString == "ws://studio-mac.local:7400/ws")
        #expect(api.previewURL(width: 740, mode: "layer", layer: "lay_1").absoluteString
            == "http://studio-mac.local:7400/preview?token=tok&w=740&mode=layer&layer=lay_1")
        #expect(api.catalogAssetURL("scenery/flowers.jpg").absoluteString == "http://studio-mac.local:7400/catalog/assets/scenery/flowers.jpg")
    }
}
