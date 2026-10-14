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
        "sound.json": { try JSONDecoder().decode(Asset.self, from: $0) },
        "video.json": { try JSONDecoder().decode(Video.self, from: $0) },
        "import.json": { try JSONDecoder().decode(ImportJob.self, from: $0) },
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
        #expect(scene.layers("scenery").map(\.ref) == ["youtube:aqz-KE-bpKQ", "flowers"])
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
        let sweep = try #require(scene.timeline.tracks.first { $0.id == "trk_sweep" })
        #expect(sweep.target.kind == "layer")
        #expect(sweep.target.id == "cl_sweep")
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
            case "snapshot":
                switch env.ch {
                case "sounds":
                    let list = try #require(env.d).decode([Asset].self)
                    #expect(list.first?.name == "rain on glass" && list.first?.kind == "sound" && list.first?.peaks.count == 16)
                case "scenes":
                    #expect(try #require(env.d).decode([SceneSummary].self).map(\.id) == ["scn_desk", "scn_party"])
                case let ch? where ch.hasPrefix("import:"):
                    #expect(ch == Channel.importJob("imp_3k9x0aa1"))
                    #expect(try #require(env.d).decode(ImportJob.self).progress == 0.42)
                default:
                    _ = try #require(env.d).decode(Setup.self); #expect(env.v == 3)
                }
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
            case "cmd": #expect(["show.go", "scene.mode", "setup.testPattern", "sound.play", "show.audio"].contains(env.d?["name"]?.string ?? ""))
            case "ack":
                #expect(env.re == "c-78" || env.re == "c-90")
                if env.re == "c-90" { #expect(env.d?["playId"] == "ply_k2m9x0aa" && env.d?["outputs"] == 1) }
            case "sound.play":
                #expect(env.ch == nil)
                let p = try #require(env.d).decode(SoundPlay.self)
                #expect(p == SoundPlay(playId: "ply_k2m9x0aa", sound: "a77c31", padId: "pad_thunder", name: "thunder", volume: 0.9, loop: false))
            case "sound.stop":
                #expect(env.ch == nil)
                #expect(try #require(env.d).decode(SoundStop.self) == SoundStop(padId: "pad_rain"))
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
        #expect(cat.version == 3)
        #expect(cat.videoParams.items.map(\.key) == ["blur", "brightness", "warmth", "drift", "start", "end", "audio", "volume"])
        #expect(cat.videoParams["blur"]?.default == 0.2)
        #expect(cat.videoDefaults["audio"] == false && cat.videoDefaults["brightness"] == 0.8)
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
        scene = try scene.applying(.remove("/backdrop/scenery/layers/0"))
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

@Suite struct ShowSoundVideoTests {
    @Test func scenePadsCueSoundAndSoundClip() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        #expect(scene.sounds.pads.map(\.id) == ["pad_thunder", "pad_rain"])
        let thunder = scene.sounds.pads[0], rain = scene.sounds.pads[1]
        #expect(thunder == Pad(id: "pad_thunder", name: "thunder", sound: "a77c31", volume: 0.9, color: .blue, icon: .thunder, key: "t", loop: false))
        #expect(rain.color == .teal && rain.icon == .rain && rain.loop && rain.volume == 0.6)
        #expect(scene.timeline.cues[0].sound == CueSound(sound: "a77c31", volume: 1))
        #expect(scene.timeline.cues[1].sound == nil)
        let track = try #require(scene.timeline.tracks.first { $0.id == "trk_sound" })
        #expect(track.target.isSound && track.target.id == nil)
        let clips = scene.timeline.soundClips
        #expect(clips.map(\.clip.id) == ["clp_rain"])
        #expect(clips[0].params == SoundClipParams(sound: "5d1e0a", offset: 0.5, volume: 0.8))
        #expect(scene.soundShas == ["a77c31", "5d1e0a"])
        let video = try #require(scene.layers("scenery").first)
        #expect(video.kind == "video" && !video.visible)
        #expect(VideoRef(video.ref) == .youtube("aqz-KE-bpKQ"))
        #expect(video.param("start") == 12 && video.params["audio"] == false)
    }

    @Test func padEnumsTolerateUnknownValues() throws {
        let pad = try JSONDecoder().decode(Pad.self, from: Data(#"{"id":"p","name":"x","sound":"s","color":"neon","icon":"robot"}"#.utf8))
        #expect(pad.color == .ink && pad.icon == PadIcon.none && pad.volume == 1 && !pad.loop && pad.key == nil)
        // Absent soundboard: no pads.
        let bare = try JSONDecoder().decode(Scene.self, from: Data(#"{"id":"s"}"#.utf8))
        #expect(bare.sounds.pads.isEmpty)
        // The encoding leaves a missing key out.
        let json = try JSONValue(encoding: pad)
        #expect(json["key"] == nil && json["color"] == "ink")
    }

    @Test func showAudioDefaultsAndFixture() throws {
        let show = try JSONDecoder().decode(Show.self, from: Fixtures.data("show"))
        #expect(show.audio == ShowAudio(output: "projector", volume: 0.8, muted: false, loops: ["pad_rain"]))
        #expect(show.audio.master == 0.8)
        let old = try JSONDecoder().decode(Show.self, from: Data(#"{"onAir":true}"#.utf8))
        #expect(old.audio == ShowAudio(output: "projector", volume: 1, muted: false, loops: []))
        #expect(ShowAudio(volume: 0.7, muted: true).master == 0)
    }

    @Test func soundVideoImportFixtures() throws {
        let s = try JSONDecoder().decode(Asset.self, from: Fixtures.data("sound"))
        #expect(s.kind == "sound" && s.name == "rain on glass" && s.duration == 12.48 && s.peaks.count == 16)
        let photo = try JSONDecoder().decode(Asset.self, from: Fixtures.data("asset"))
        #expect(photo.name == nil && photo.duration == nil && photo.peaks.isEmpty)
        let v = try JSONDecoder().decode(Video.self, from: Fixtures.data("video"))
        #expect(v.ref == "asset:7c4e1d" && v.source == "youtube" && v.youtubeId == "aqz-KE-bpKQ" && v.thumb == "3a9f00")
        #expect(v.duration == 20 && v.height == 1080 && !v.isEmbed)
        let job = try JSONDecoder().decode(ImportJob.self, from: Fixtures.data("import"))
        #expect(job.mode == "download" && job.isRunning && job.progress == 0.42 && job.start == 12 && job.end == 32)
        #expect(job.videoId == nil && job.ref == nil && job.maxHeight == 1080)
        #expect(try JSONDecoder().decode(VideoTools.self, from: Data("{}".utf8)) == VideoTools(ytdlp: false, ffmpeg: false))
    }

    @Test func youtubeLinks() {
        let id = "aqz-KE-bpKQ"
        #expect(YouTube.videoId("https://www.youtube.com/watch?v=\(id)") == id)
        #expect(YouTube.videoId("http://youtube.com/watch?v=\(id)&t=12s&list=x") == id)
        #expect(YouTube.videoId("https://m.youtube.com/watch?feature=share&v=\(id)") == id)
        #expect(YouTube.videoId("  https://youtu.be/\(id)?si=abc ") == id)
        #expect(YouTube.videoId("https://www.youtube.com/shorts/\(id)") == id)
        #expect(YouTube.videoId("https://youtube.com/shorts/\(id)?feature=share") == id)
        #expect(YouTube.videoId("https://vimeo.com/\(id)") == nil)
        #expect(YouTube.videoId("ftp://youtu.be/\(id)") == nil)
        #expect(YouTube.videoId("https://youtu.be/short") == nil)
        #expect(YouTube.videoId("https://www.youtube.com/watch?v=bad!id12345") == nil)
        #expect(YouTube.videoId("https://www.youtube.com/embed/\(id)") == nil)
        #expect(YouTube.videoId("youtube.com/watch?v=\(id)") == nil)
        #expect(YouTube.videoId("") == nil)
        #expect(VideoRef("youtube:\(id)")?.youtubeId == id)
        #expect(VideoRef("asset:7c4e1d")?.sha == "7c4e1d")
        #expect(VideoRef("youtube:nope") == nil && VideoRef("flowers") == nil && VideoRef("asset:") == nil)
        #expect(YouTube.thumbnailURL(id).absoluteString == "https://i.ytimg.com/vi/\(id)/hqdefault.jpg")
    }

    @Test func padIntents() throws {
        var scene = try Fixtures.json("scene")
        let pad: JSONValue = ["id": "pad_bell", "name": "bell", "sound": "c0", "volume": 1, "color": "ink", "icon": "bell", "loop": false]
        #expect(SceneIntent.addPad(pad).ops(on: scene) == [.add("/sounds/pads/-", pad)])
        scene = try scene.applying(try #require(SceneIntent.addPad(pad).ops(on: scene)))
        #expect(SceneIntent.setPadField(padId: "pad_bell", field: ["volume"], value: 0.5).ops(on: scene) == [.replace("/sounds/pads/2/volume", 0.5)])
        #expect(SceneIntent.setPadField(padId: "pad_thunder", field: ["key"], value: "x").ops(on: scene) == [.replace("/sounds/pads/0/key", "x")])
        #expect(SceneIntent.removePad(padId: "pad_rain").ops(on: scene) == [.remove("/sounds/pads/1")])
        #expect(SceneIntent.removePad(padId: "pad_gone").ops(on: scene) == nil)
        // A scene from an older server has no soundboard yet.
        let bare: JSONValue = ["id": "s"]
        let ops = try #require(SceneIntent.addPad(pad).ops(on: bare))
        #expect(try bare.applying(ops).value(at: "/sounds/pads/0/id") == "pad_bell")
    }

    @Test func videoPickKeepsThePhotoLook() throws {
        var scene = try Fixtures.json("scene")
        let photo = try #require(try scene.decode(Scene.self).layers("scenery").last)
        let layer = StackPick.video(ref: "youtube:aqz-KE-bpKQ", name: "bunny",
                                    defaults: ["blur": 0.2, "brightness": 0.8, "warmth": 0, "drift": 0, "start": 12, "end": 0, "audio": false, "volume": 1],
                                    keeping: photo, id: "lay_new")
        scene = try scene.applying(try #require(SceneIntent.replaceStack(mode: "scenery", layers: [layer]).ops(on: scene)))
        let picked = try scene.decode(Scene.self).layers("scenery")
        #expect(picked.count == 1 && picked[0].kind == "video" && picked[0].id == "lay_flowers")
        #expect(picked[0].param("blur") == 0.74 && picked[0].param("drift") == 0.1 && picked[0].param("start") == 12)
        // And a photo picked after a video keeps the video's look.
        let back = try StackPick.photo(ref: "ocean", name: "ocean", defaults: ["blur": 0.5], keeping: picked[0], id: "x").decode(Layer.self)
        #expect(back.kind == "photo" && back.param("blur") == 0.74 && back.params["start"] == nil)
    }
}

@Suite struct SoundScheduleTests {
    func clip(_ id: String, _ start: Double, _ end: Double, fadeIn: Double = 0, fadeOut: Double = 0) -> Clip {
        Clip(id: id, trackId: "trk_sound", effect: "sound", start: start, end: end, fadeIn: fadeIn, fadeOut: fadeOut)
    }

    @Test func fadeGains() {
        let c = clip("c", 2, 9, fadeIn: 0.5, fadeOut: 1.5)
        #expect(SoundSchedule.fadeGain(c, at: 1.9) == 0)
        #expect(SoundSchedule.fadeGain(c, at: 2) == 0)
        #expect(abs(SoundSchedule.fadeGain(c, at: 2.25) - 0.5) < 1e-9)
        #expect(SoundSchedule.fadeGain(c, at: 5) == 1)
        #expect(abs(SoundSchedule.fadeGain(c, at: 8.25) - 0.5) < 1e-9)
        #expect(SoundSchedule.fadeGain(c, at: 9) == 0)
        #expect(SoundSchedule.fadeGain(clip("n", 0, 4), at: 0) == 1)
    }

    @Test func fixtureClipFromTheStart() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        let plan = SoundSchedule.plan(scene.timeline.soundClips, at: 0)
        #expect(plan.count == 1)
        let p = plan[0]
        #expect(p.clipId == "clp_rain" && p.sound == "5d1e0a")
        #expect(p.delay == 2 && p.fileOffset == 0.5 && p.length == 7 && p.volume == 0.8 && p.startGain == 0)
        #expect(p.ramps == [.init(at: 2, gain: 1, over: 0.5), .init(at: 7.5, gain: 0, over: 1.5)])
    }

    @Test func playheadInsideAClipStartsAtOnce() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        // 6.4 s: 4.4 s into the clip → file 4.9 s, no fade-in left, fade-out from 7.5.
        let p = try #require(SoundSchedule.plan(scene.timeline.soundClips, at: 6.4).first)
        #expect(p.delay == 0)
        #expect(abs(p.fileOffset - 4.9) < 1e-9)
        #expect(abs(p.length - 2.6) < 1e-9)
        #expect(p.startGain == 1)
        #expect(p.ramps.count == 1 && abs(p.ramps[0].at - 1.1) < 1e-9 && p.ramps[0].over == 1.5)
        // Mid fade-in: starts at the partial gain and ramps the rest.
        let q = try #require(SoundSchedule.plan(scene.timeline.soundClips, at: 2.25).first)
        #expect(abs(q.startGain - 0.5) < 1e-9 && q.ramps[0] == .init(at: 0, gain: 1, over: 0.25))
        // Inside the fade-out: one ramp to 0 over what is left.
        let r = try #require(SoundSchedule.plan(scene.timeline.soundClips, at: 8.25).first)
        #expect(abs(r.startGain - 0.5) < 1e-9 && r.ramps == [.init(at: 0, gain: 0, over: 0.75)])
        // After it: nothing.
        #expect(SoundSchedule.plan(scene.timeline.soundClips, at: 9).isEmpty)
    }

    @Test func fileEndAndTransport() throws {
        let p = SoundClipParams(sound: "s", offset: 3)
        let clips = [(clip: clip("a", 0, 10), params: p), (clip: clip("b", 20, 30), params: SoundClipParams(sound: "s"))]
        // A 5 s file: clip a plays 2 s (file 3…5), b plays its first 5 s.
        let plan = SoundSchedule.plan(clips, at: 0, durations: ["s": 5])
        #expect(plan.map(\.length) == [2, 5])
        // Past the file's end: silent.
        #expect(SoundSchedule.plan(clips, at: 4, durations: ["s": 5]).map(\.clipId) == ["b"])
        #expect(SoundSchedule.plan(clips, at: 0, horizon: 10).map(\.clipId) == ["a"])
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        #expect(SoundSchedule.plan(scene: scene, transport: Transport(state: "paused", offset: 3), serverNowMs: 0).isEmpty)
        #expect(SoundSchedule.plan(scene: scene, transport: Transport(), serverNowMs: 0).isEmpty)
        // Playing from offset 1, started 1 s ago on the server clock: playhead 2 → the clip starts now.
        let playing = Transport(state: "playing", startedAt: 1_000_000_000, offset: 1, cue: 0)
        let now = SoundSchedule.plan(scene: scene, transport: playing, serverNowMs: 2000)
        #expect(now.first?.delay == 0 && now.first?.fileOffset == 0.5)
    }
}
