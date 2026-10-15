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
        "scene-summary.json": { try JSONDecoder().decode([SceneSummary].self, from: $0) },
        "settings.json": { try JSONDecoder().decode(ServerSettings.self, from: $0) },
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
        #expect(scene.kind == "mapping")
        #expect(scene.layers("static").isEmpty)
        #expect(scene.attachments("static").map(\.id) == ["att_window"])
        #expect(scene.attachments("live").map(\.id) == ["att_live_window"])
        #expect(scene.layers("live").map(\.id) == ["lay_tree"])
        #expect(scene.layers("color").map(\.ref) == ["ember", "hue-cycle"])
        #expect(scene.layers("color")[1].kind == "generator")
        #expect(scene.layers("scenery").map(\.ref) == ["youtube:aqz-KE-bpKQ", "flowers"])
        #expect(scene.layers("scenery")[1].motion?.preset == "drift")
        #expect(scene.layers("objects").isEmpty)
        #expect(scene.underlay == Underlay(on: false, from: "static", level: 0.35))
        let light = try #require(scene.light("static"))
        #expect(light.color.kelvin == 3200 && light.focus == 0.38 && light.intensity == 0.8 && light.colorLayer == nil)
        #expect(light.fringe == 0.2 && light.vignette == 0.3 && light.backgroundFocus == 1 && light.slide == .zero && light.motion == nil)
        // Values straight from the fixture (it is still being tuned): every field decodes as written.
        let att = scene.attachments("static")[0]
        let raw = try #require(try Fixtures.json("scene").value(at: "/backdrop/static/attachments/0"))
        #expect(att.gobo == raw["gobo"]?.string && att.rotation == raw["rotation"]?.double && att.scale == raw["scale"]?.double)
        #expect(att.params == raw["params"]?.object && att.opacity == raw["opacity"]?.double)
        let motion = try #require(att.motion)
        #expect(!motion.on && motion.preset == "sun-lr" && motion.via == FramePoint(x: 0, y: -0.04) && motion.startedAt == 1_791_700_000_123)
        #expect(scene.light("live")?.focus == 0.45)
        #expect(scene.layers("live")[0].param("wind") == 0.4)
        let sun = try #require(scene.timeline.clips.first { $0.id == "clp_sun" })
        #expect(sun.effect == "motion" && sun.params["to"] == 1)
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

    /// (§20) the converge clip and `hold` decode, default by effect and survive a round trip.
    @Test func convergeClipAndHold() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        let clip = try #require(scene.timeline.clips.first { $0.isConverge })
        #expect(clip.hold == true && clip.holds && clip.start == 0 && clip.end == 2)
        #expect(clip.params["source"] == "static" && clip.params["from"] == "current" && clip.params["outline"] == true)
        let track = try #require(scene.timeline.tracks.first { $0.id == clip.trackId })
        #expect(track.target == TrackTarget(kind: "object", id: "obj_cube"))
        // absent hold: the effect's default
        let grid = try #require(scene.timeline.clips.first { $0.id == "clp_grid" })
        #expect(grid.hold == nil && !grid.holds)
        #expect(Clip(id: "c", trackId: "t", effect: "reveal", start: 0, end: 1).holds)
        #expect(!Clip(id: "c", trackId: "t", effect: "converge", start: 0, end: 1, hold: false).holds)
        // in effect while it plays and after its end when it holds; a grid build ends at its end
        let own = scene.timeline.clips.filter { $0.trackId == clip.trackId }
        #expect(clip.inEffect(at: 1, track: own) && clip.inEffect(at: 10, track: own) && !clip.inEffect(at: -1, track: own))
        #expect(grid.inEffect(at: 1, track: [grid]) && !grid.inEffect(at: 5, track: [grid]))
        let next = Clip(id: "c2", trackId: clip.trackId, effect: "converge", start: 6, end: 7, hold: false)
        #expect(!clip.inEffect(at: 6.5, track: own + [next]) && next.inEffect(at: 6.5, track: own + [next]) && !next.inEffect(at: 8, track: own + [next]))
        let again = try JSONDecoder().decode(Clip.self, from: JSONEncoder().encode(clip))
        #expect(again == clip)
        let plain = String(data: try JSONEncoder().encode(grid), encoding: .utf8) ?? ""
        #expect(!plain.contains("hold"))
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
        #expect(scene.kind == "live")
        // §15 upgrade on read: gobo layers become attachments under a stack light.
        #expect(scene.layers("static").isEmpty)
        #expect(scene.attachments("static").map(\.id) == ["g"])
        #expect(scene.attachments("live").map(\.id) == ["g_live"])
        #expect(scene.layers("live").map(\.id) == ["t"])
        #expect(scene.layers("color").map(\.id) == ["c"])
        #expect(scene.layers("scenery").map(\.id) == ["p"])
    }

    @Test func objectsModeDrawsTheUnderlayOnly() throws {
        var doc = try Fixtures.json("scene")
        doc = try doc.applying([.replace("/mode", "objects")])
        #expect(try doc.decode(Scene.self).onAirLayers.isEmpty)
        doc = try doc.applying([.replace("/underlay/on", true), .replace("/underlay/from", "color")])
        #expect(try doc.decode(Scene.self).onAirLayers.map(\.id) == ["lay_ember", "lay_hue"])
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
            case "param":
                let p = try #require(env.d).decode(ParamMessage.self)
                if p.path == "/backdrop/static/light/slide/x" {
                    #expect(try Fixtures.json("scene").applying(.replace(p.path, p.value)).decode(Scene.self).light("static")?.slide.x == 0.25)
                }
            case "patch":
                let p = try #require(PatchedMessage(env.d))
                if env.id == "c-80" {
                    #expect(p.ops == [.replace("/mode", "objects")])
                } else if env.id == "c-95" {
                    // §15: a motion turned on with its server-clock start.
                    #expect(p.ops == [.replace("/backdrop/static/attachments/0/motion/on", true),
                                      .replace("/backdrop/static/attachments/0/motion/startedAt", 1_791_700_000_123)])
                    let scene = try Fixtures.json("scene").applying(p.ops).decode(Scene.self)
                    #expect(scene.attachments("static")[0].motion?.on == true)
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
            case "cmd":
                #expect(["show.go", "scene.mode", "setup.testPattern", "sound.play", "show.audio", "show.converge"].contains(env.d?["name"]?.string ?? ""))
                if env.d?["name"]?.string == "show.converge" {
                    #expect(env.d?["args"]?["source"] == "static" && env.d?["args"]?["objectId"] == "obj_cube" && env.d?["args"]?["duration"] == 2)
                }
            case "ack":
                #expect(env.re == "c-78" || env.re == "c-90" || env.re == "c-95")
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
        #expect(cat.version == 7)
        // (§20) the converge effect and its params, in order
        let converge = try #require(cat.effects.first { $0.id == "converge" })
        #expect(converge.params["from"]?["default"] == "current" && converge.params["outline"]?["type"] == "boolean")
        #expect(cat.videoParams.items.map(\.key) == ["blur", "brightness", "warmth", "drift", "start", "end", "audio", "volume"])
        #expect(cat.videoParams["blur"]?.default == 0.2)
        #expect(cat.videoDefaults["audio"] == false && cat.videoDefaults["brightness"] == 0.9)
        #expect(cat.videoParams["audio"]?.label == "sound" && cat.photoParams["brightness"]?.default == 0.9)
        let drawing = try #require(cat.effects.first { $0.id == "drawing" })
        #expect(drawing.params["strokes"]?["type"] == "strokes")
        #expect(cat.gobos.count >= 45 && cat.gobos.allSatisfy { $0.id.hasPrefix("plate-") && $0.metalThumb != nil && $0.source != nil })
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
        #expect(next.value(at: "/backdrop/live/layers")?.array?.count == 2)
        #expect(next.value(at: "/backdrop/live/layers/1/ref") == "tree-sway")
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
        let intent = SceneIntent.setLayerField(layerId: "lay_hue", field: ["visible"], value: true)
        #expect(intent.ops(on: scene) == [.replace("/backdrop/color/layers/1/visible", true)])
        // Someone else moved it to the bottom: the intent still finds it.
        scene = try scene.applying(.move(from: "/backdrop/color/layers/1", to: "/backdrop/color/layers/0"))
        #expect(intent.ops(on: scene) == [.replace("/backdrop/color/layers/0/visible", true)])
        // Deleted: nothing to do.
        scene = try scene.applying(.remove("/backdrop/color/layers/0"))
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
        #expect(SceneIntent.moveLayer(layerId: "lay_ember", to: 5).ops(on: scene) == [.move(from: "/backdrop/color/layers/0", to: "/backdrop/color/layers/1")])
        #expect(SceneIntent.removeLayer(layerId: "lay_tree").ops(on: scene) == [.remove("/backdrop/live/layers/0")])
        // A single-layer stack does not move.
        #expect(SceneIntent.moveLayer(layerId: "lay_tree", to: 5).ops(on: scene) == [])
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

    @Test func pickingAnAttachmentReplacesTheListAndAddingStacksMasks() throws {
        var scene = try Fixtures.json("scene")
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        let blinds = try #require(cat.gobo("plate-slat-blinds"))
        let a = try JSONValue(encoding: cat.newAttachment(blinds, id: "att_aaaaaaaa"))
        let ops = try #require(SceneIntent.replaceAttachments(mode: "static", attachments: [a]).ops(on: scene))
        #expect(ops == [.replace("/backdrop/static/attachments", [a])])
        scene = try scene.applying(ops)
        var picked = try scene.decode(Scene.self)
        #expect(picked.attachments("static").map(\.gobo) == ["plate-slat-blinds"])
        #expect(picked.light("static")?.focus == 0.38)  // the light stays
        let b = try JSONValue(encoding: cat.newAttachment(try #require(cat.gobo("plate-foliage-breakup")), id: "att_bbbbbbbb"))
        scene = try scene.applying(try #require(SceneIntent.addAttachment(mode: "static", attachment: b).ops(on: scene)))
        picked = try scene.decode(Scene.self)
        #expect(picked.attachments("static").map(\.id) == ["att_aaaaaaaa", "att_bbbbbbbb"])
        // Fields follow the id; removing drops it.
        #expect(SceneIntent.setAttachmentField(attachmentId: "att_bbbbbbbb", field: ["rotation"], value: 30).ops(on: scene)
            == [.replace("/backdrop/static/attachments/1/rotation", 30)])
        #expect(SceneIntent.setAttachmentField(attachmentId: "att_live_window", field: ["params", "skew"], value: 0.5).ops(on: scene)
            == [.replace("/backdrop/live/attachments/0/params/skew", 0.5)])
        #expect(SceneIntent.removeAttachment(attachmentId: "att_aaaaaaaa").ops(on: scene) == [.remove("/backdrop/static/attachments/0")])
        #expect(SceneIntent.removeAttachment(attachmentId: "att_gone").ops(on: scene) == nil)
    }

    @Test func newAttachmentTakesCatalogDefaults() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        let item = try #require(cat.gobo("plate-arched-window"))
        let a = cat.newAttachment(item)
        #expect(a.id.hasPrefix("att_") && a.id.count == 12)
        #expect(a.rotation == item.attachment.rotation && a.scale == item.attachment.scale && a.opacity == 1 && a.visible && a.motion == nil)
        // The gobo's own defaults, then goboParams defaults, overridden by the item's defaults.
        var expected = Catalog.defaults(item.params)
        for (k, v) in Catalog.defaults(cat.goboParams) { expected[k] = v }
        for (k, v) in item.defaults { expected[k] = v }
        // (§16) a window preset keeps its geometry out of a new attachment: the preset's defaults apply
        for k in cat.windowKeys(item.id) { expected[k] = nil }
        #expect(a.params == expected && a.params["arch"] == nil && a.params["field"] == "round")
        #expect(item.params["arch"]?.default == true)
        #expect(cat.shapeParams("plate-arched-window").map(\.key).suffix(3) == ["throw", "skew", "depth"])
    }

    @Test func lightFieldsAndMissingLights() throws {
        let scene = try Fixtures.json("scene")
        #expect(SceneIntent.setLight(mode: "static", field: ["slide", "x"], value: 0.25).ops(on: scene) == [.replace("/backdrop/static/light/slide/x", 0.25)])
        // A live stack without a light gets the default light first.
        let dark = try scene.applying(.replace("/backdrop/live/light", nil))
        let ops = try #require(SceneIntent.setLight(mode: "live", field: ["intensity"], value: 0.5).ops(on: dark))
        let next = try dark.applying(ops).decode(Scene.self)
        #expect(next.light("live")?.intensity == 0.5)
        #expect(next.light("live")?.color.kelvin == 5600)
        // A motion object in one go.
        let m = try JSONValue(encoding: Motion(on: true, preset: "drift", duration: 90))
        let mops = try #require(SceneIntent.setLight(mode: "static", field: ["motion"], value: m).ops(on: scene))
        #expect(try scene.applying(mops).decode(Scene.self).light("static")?.motion?.preset == "drift")
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
        let ops = try #require(SceneIntent.applyPreset(mode: "static", backdrop: backdrop).ops(on: scene))
        #expect(ops == [.replace("/backdrop/static", backdrop), .replace("/mode", "static")])
        let next = try scene.applying(ops).decode(Scene.self)
        #expect(next.mode == "static")
        #expect(next.attachments("static").map(\.gobo) == ["plate-grid-window"])
        #expect(next.light("static")?.colorLayer == ColorLayer(kind: "generator", ref: "kelvin-cycle", params: ["fromKelvin": 2700, "toKelvin": 4300, "minutes": 20]))
        #expect(backdrop["light"]?["motion"] == .null && backdrop["layers"] == [])
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
        #expect(api.catalogThumbURL("window-4").absoluteString == "http://studio-mac.local:7400/catalog/thumbs/window-4.png")
        #expect(api.previewURL(width: 600, scene: "scn_sun").absoluteString == "http://studio-mac.local:7400/preview?token=tok&w=600&mode=hero&scene=scn_sun")
        // An empty token (a local shortcut pairing) is left out of the page's URL.
        #expect(APIClient(server: URL(string: "http://h:7400")!, token: "").previewURL(width: 10).absoluteString == "http://h:7400/preview?w=10&mode=hero")
        #expect(APIClient.createSceneBody(name: "sun", kind: "static") == ["name": "sun", "kind": "static"])
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
