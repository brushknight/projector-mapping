import Foundation
import Testing
@testable import PMKit
import PMTestSupport

/// Protocol §15: the light model, catalog v4, scene kinds, settings and Motion progress.
@Suite struct LightModelTests {
    @Test func catalogV6() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        #expect(cat.goboCategories.map(\.id) == ["windows", "nature", "sky", "patterns", "beams"])
        #expect(cat.gobos.allSatisfy { GoboCategory.v6.contains($0.category) && $0.browseCategory == $0.category })
        #expect(cat.gobos(in: "windows").first?.id == "plate-grid-window")
        let w = try #require(cat.gobo("plate-grid-window"))
        #expect(w.thumb == "thumbs/plate-grid-window.png" && w.focus != nil && w.attachment.scale > 0 && w.isWindow)
        #expect(cat.thumbId("plate-grid-window") == "plate-grid-window" && cat.thumbId("tree-sway") == "tree-sway")
        #expect(cat.goboParams.items.map(\.key) == ["throw", "skew", "depth"])
        #expect(Array(cat.stackLight.params.items.map(\.key).prefix(2)) == ["intensity", "focus"])
        #expect(cat.stackLight.params["haze"] == nil && cat.stackLight.params["fringe"] != nil)
        #expect(cat.stackLight.kelvin == 5600)
        #expect(cat.stackLight.attachmentParams.items.map(\.key) == ["opacity", "rotation", "scale", "offsetX", "offsetY"])
        #expect(cat.stackLight.attachmentParams["opacity"]?.label == "blocks")
        #expect(cat.colorGenerators.map(\.id) == ["hue-cycle", "color-flow", "pulse", "aurora", "kelvin-cycle"])
        #expect(cat.colorGenerator("color-flow")?.params.items.first?.key == "colorA")
        #expect(cat.motionPresets.map(\.id) == ["sun-lr", "sun-rl", "drift", "sway", "rise", "set"])
        #expect(cat.motionPreset("rise")?.motion.kelvinTo == 4300)
        #expect(cat.motionEasings == ["linear", "in", "out", "inOut", "sine"] && cat.motionLoops == ["once", "loop", "pingpong"])
        #expect(cat.sceneKinds.map(\.mode) == ["static", "live", "color", "scenery", "objects"])
        #expect(cat.sceneTemplates.map(\.id) == ["static-window", "live-window-tree", "color-ember", "scenery-flowers", "mapping-empty"])
        #expect(cat.procedural("tree-sway")?.thumb == "thumbs/tree-sway.png")
        #expect(cat.params(for: Layer(id: "g", kind: "generator", ref: "hue-cycle", name: "")).items.map(\.key) == ["speed", "saturation", "spread"])
    }

    /// Catalog 6: every attachment is a metal plate from the reference photos, with its own thumbnail and light field.
    @Test func plates() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        #expect(cat.gobos.count >= 45 && cat.gobos.count <= 60)
        let sun = try #require(cat.gobo("plate-sunburst"))
        #expect(sun.name == "sunburst" && sun.source?.hasPrefix("amaran-as-gb-m-set1.png, MO05") == true && sun.category == "beams")
        // (catalog 8) no metal thumbnail any more: tiles show the light
        #expect(sun.metalThumb == nil)
        #expect(cat.thumbId("plate-sunburst") == "plate-sunburst")
        let field = try #require(sun.params["field"])
        #expect(field.type == "enum" && field.options == ["round", "fill", "stretch", "tile"] && field.default == "round")
        #expect(cat.newAttachment(sun).params["field"] == "round")
        #expect(cat.gobos.allSatisfy { $0.source != nil && $0.metalThumb == nil })
        #expect(!sun.isWindow && cat.windowGroups("plate-sunburst").isEmpty && cat.windowKeys("plate-sunburst").isEmpty)
    }

    /// Catalog 6 (§16): parametric window presets, grouped geometry, reset keys.
    @Test func windowPresets() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        let windows = cat.gobos.filter(\.isWindow)
        #expect(windows.count == 13)
        #expect(cat.windowParamGroups.map(\.id) == ["grid", "frame", "arch", "shape", "lattice", "blinds"])
        let palace = try #require(cat.gobo("plate-palace-window"))
        #expect(palace.params["arch"]?.default == true && palace.params["spokes"]?.type == "integer")
        let groups = cat.windowGroups("plate-palace-window")
        #expect(groups.map(\.group.id) == ["grid", "frame", "arch", "shape", "lattice", "blinds"])
        #expect(groups[0].params.map(\.key) == ["sashes", "cols", "rows", "gap"])
        #expect(groups.flatMap { $0.params.map(\.key) }.count == 23)
        #expect(!cat.windowKeys("plate-palace-window").contains("field") && cat.windowKeys("plate-palace-window").count == 23)
        #expect(cat.params(for: Layer(id: "v", kind: "video", ref: "youtube:aqz-KE-bpKQ", name: "")).items.map(\.key).contains("audio"))
    }

    /// Catalog 6 (§16): live layers carry an animated strip; shadow layers block light like an attachment.
    @Test func liveGallery() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        let tree = try #require(cat.procedural("tree-sway"))
        #expect(tree.isShadow && cat.procedural("candle-flicker")?.isShadow == false)
        if let s = cat.animStrip("tree-sway") {
            #expect(s.path == "thumbs/tree-sway-anim.jpg" && s.frames > 1 && s.fps > 0)
        }
        let old = try Catalog.decode(Data(#"{"version":5,"procedural":[{"id":"clouds","name":"clouds","category":"weather"}]}"#.utf8))
        #expect(old.animStrip("clouds") == nil && old.windowParamGroups.isEmpty)
    }

    /// §16: scene documents carry `format` (6 now); older ones decode without it, and it round-trips.
    @Test func sceneFormatRoundTrips() throws {
        let s = try JSONDecoder().decode(Scene.self, from: Data(#"{"id":"s","format":6,"backdrop":{}}"#.utf8))
        #expect(s.format == 6)
        let again = try JSONDecoder().decode(Scene.self, from: JSONEncoder().encode(s))
        #expect(again.format == 6)
        #expect(try JSONDecoder().decode(Scene.self, from: Data(#"{"id":"s"}"#.utf8)).format == nil)
        #expect(try Fixtures.json("scene").decode(Scene.self).format == 6)
        #expect(try Fixtures.json("preset").decode(Preset.self).format == 6)
    }

    /// §16: sharp defaults, background focus, no haze, and background layers in the static stack.
    @Test func focusLensAndBackgroundLayers() throws {
        #expect(StackLight() == StackLight(intensity: 0.85, focus: 1, fringe: 0.2, vignette: 0, backgroundFocus: 1))
        let json = #"{"id":"s","backdrop":{"static":{"layers":[{"id":"lay_bg","kind":"gradient","ref":"ember"},{"id":"lay_c","kind":"procedural","ref":"caustics"}],"light":{"haze":0.4,"backgroundFocus":0.3},"attachments":[]}}}"#
        let s = try JSONDecoder().decode(Scene.self, from: Data(json.utf8))
        #expect(s.layers("static").map(\.id) == ["lay_bg", "lay_c"])
        let l = try #require(s.light("static"))
        #expect(l.backgroundFocus == 0.3 && l.focus == 1 && l.vignette == 0)
        let out = try JSONValue(encoding: l)
        #expect(out["haze"] == nil && out["backgroundFocus"] == 0.3)
    }

    @Test func olderCatalogStillDecodes() throws {
        let v3 = #"{"version":3,"gobos":[{"id":"window","name":"window","category":"shadows"},{"id":"blinds","name":"blinds"},{"id":"palm","name":"palm"}]}"#
        let cat = try Catalog.decode(Data(v3.utf8))
        #expect(cat.gobos.map(\.browseCategory) == ["windows", "blinds", "nature"])
        #expect(cat.goboCategories.count == 6 && cat.sceneKinds.count == 5 && cat.motionPresets.isEmpty)
        #expect(cat.newAttachment(cat.gobos[0]).params.isEmpty)
    }

    @Test func staticStackDefaultsAndLiveWithoutLight() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Data(#"{"id":"s","backdrop":{"static":{"layers":[]},"live":{"layers":[]}}}"#.utf8))
        #expect(scene.light("static") == StackLight())
        #expect(scene.light("static")?.color.kelvin == 5600 && scene.light("static")?.intensity == 0.85 && scene.light("static")?.focus == 1)
        #expect(scene.light("live") == nil)
        #expect(scene.kind == "static")
        let partial = try JSONDecoder().decode(StackLight.self, from: Data(#"{"color":{"mode":"hsi","hue":10}}"#.utf8))
        #expect(partial.color.kelvin == 5600 && partial.color.hue == 10 && partial.slide == .zero)
    }

    @Test func v3StacksUpgradeOnRead() throws {
        let json = #"{"id":"s","mode":"static","backdrop":{"static":{"layers":[{"id":"lay_w","kind":"gobo","ref":"window","name":"w","opacity":0.8,"light":{"intensity":0.6,"softness":0.25,"angle":-22,"scale":1.4,"offsetX":0.1,"color":{"mode":"cct","kelvin":3000}}}]},"live":{"layers":[{"id":"t","kind":"procedural","ref":"tree-sway"}]}}}"#
        let scene = try JSONDecoder().decode(Scene.self, from: Data(json.utf8))
        let a = try #require(scene.attachments("static").first)
        #expect(a == Attachment(id: "lay_w", gobo: "window", name: "w", opacity: 0.8, rotation: -22, offsetX: 0.1, scale: 1.4))
        let l = try #require(scene.light("static"))
        #expect(l.intensity == 0.6 && l.focus == 0.75 && l.color.kelvin == 3000)
        #expect(scene.layers("static").isEmpty)
        #expect(scene.light("live") == nil && scene.layers("live").map(\.id) == ["t"])
        // A v3 static preset upgrades the same way.
        let preset = try JSONDecoder().decode(Preset.self, from: Data(#"{"id":"p","mode":"static","backdrop":{"layers":[{"id":"g","kind":"gobo","ref":"blinds","light":{}}]}}"#.utf8))
        #expect(preset.backdrop.attachments.map(\.gobo) == ["blinds"] && preset.backdrop.layers.isEmpty && preset.backdrop.light != nil)
        let enc = try JSONValue(encoding: preset.backdrop)
        #expect(enc["attachments"]?.array?.count == 1 && enc["light"]?["focus"] == 0.5)
        // Color and scenery stacks never grow light keys.
        #expect(try JSONValue(encoding: Backdrop(layers: [])) == ["layers": []])
    }

    @Test func sceneKinds() throws {
        #expect(SceneKind.infer(kind: nil, hasObjects: true, mode: "static") == "mapping")
        #expect(SceneKind.infer(kind: nil, hasObjects: false, mode: "objects") == "mapping")
        #expect(SceneKind.infer(kind: nil, hasObjects: false, mode: "color") == "color")
        #expect(SceneKind.infer(kind: nil, hasObjects: false, mode: nil) == "static")
        #expect(SceneKind.infer(kind: "live", hasObjects: true, mode: "static") == "live")
        #expect(SceneKind.mode("mapping") == "objects" && SceneKind.mode("scenery") == "scenery")
        let list = try JSONDecoder().decode([SceneSummary].self, from: Fixtures.data("scene-summary"))
        #expect(list.map(\.kind) == ["mapping", "static", "live"] && list.map(\.mode) == ["static", "static", "live"])
        let old = try JSONDecoder().decode(SceneSummary.self, from: Data(#"{"id":"a","name":"a"}"#.utf8))
        #expect(old.kind == "static" && old.mode == "static")
        let scene = try JSONDecoder().decode(Scene.self, from: Data(#"{"id":"s","mode":"objects"}"#.utf8))
        #expect(scene.kind == "mapping")
    }

    @Test func settings() throws {
        let s = try JSONDecoder().decode(ServerSettings.self, from: Fixtures.data("settings"))
        #expect(s == ServerSettings(agentLiveEdits: true))
        #expect(try JSONDecoder().decode(ServerSettings.self, from: Data("{}".utf8)).agentLiveEdits == false)
    }

    @Test func templatesBuildEachKind() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        for kind in SceneKind.all {
            let doc = SceneTemplates.document(kind: kind, id: "scn_x", name: "x", setupId: "set", catalog: cat)
            let scene = try doc.decode(Scene.self)
            #expect(scene.kind == kind && scene.mode == SceneKind.mode(kind))
        }
        let s = try SceneTemplates.document(kind: "static", id: "s", name: "s", setupId: "set", catalog: cat).decode(Scene.self)
        #expect(s.attachments("static").map(\.gobo) == ["plate-grid-window"])
        #expect(s.attachments("static")[0].motion?.phase == 0.5)
        #expect(s.attachments("static")[0].rotation == cat.gobo("plate-grid-window")?.attachment.rotation)
        #expect(s.attachments("static")[0].motion?.preset == "sun-lr" && s.attachments("static")[0].motion?.on == false)
        #expect(s.light("static")?.color.kelvin == 3200 && s.light("static")?.intensity == 0.85 && s.light("static")?.focus == 0.68)
        let l = try SceneTemplates.document(kind: "live", id: "s", name: "s", setupId: "set", catalog: cat).decode(Scene.self)
        #expect(l.layers("live").map(\.ref) == ["tree-sway"] && l.layers("live")[0].blend == "multiply" && l.attachments("live").count == 1)
        #expect(l.light("live")?.focus == cat.gobo("plate-grid-window")?.focus)
    }
}

/// §15 Motion: progress, loops, easing, path, and the pause / play / speed rules.
@Suite struct MotionTests {
    static let sun = Motion(on: true, preset: "sun-lr", from: FramePoint(x: -0.6, y: 0.08), via: FramePoint(x: 0, y: -0.04),
                            to: FramePoint(x: 0.6, y: 0.08), duration: 600, easing: "inOut", loop: "loop", rotate: 8,
                            phase: 0, startedAt: 1_000_000)

    func close(_ a: Double, _ b: Double, _ eps: Double = 1e-9) -> Bool { abs(a - b) < eps }

    @Test func progressRunsOnTheServerClock() {
        let m = Self.sun
        #expect(m.rawProgress(serverNowMs: 1_000_000) == 0)
        #expect(close(m.rawProgress(serverNowMs: 1_000_000 + 300_000), 0.5))
        var off = m
        off.on = false
        off.phase = 0.3
        #expect(off.rawProgress(serverNowMs: 9_999_999) == 0.3)
        var phased = m
        phased.phase = 0.25
        #expect(close(phased.rawProgress(serverNowMs: 1_000_000 + 60_000), 0.35))
        // No start yet is now; a start ahead of the clock has not begun.
        var unstarted = m
        unstarted.startedAt = 0
        #expect(unstarted.rawProgress(serverNowMs: 5_000_000) == 0)
        #expect(m.rawProgress(serverNowMs: 999_000) == 0)
    }

    @Test func loops() {
        #expect(Motion.applyLoop("once", 1.7) == 1 && Motion.applyLoop("once", -0.2) == 0 && Motion.applyLoop("once", 0.4) == 0.4)
        #expect(close(Motion.applyLoop("loop", 2.25), 0.25) && close(Motion.applyLoop("loop", -0.25), 0.75))
        #expect(close(Motion.applyLoop("pingpong", 0.25), 0.25))
        #expect(close(Motion.applyLoop("pingpong", 1.25), 0.75))
        #expect(close(Motion.applyLoop("pingpong", 2.25), 0.25))
        #expect(close(Motion.applyLoop("pingpong", 1), 1) && close(Motion.applyLoop("pingpong", 2), 0))
    }

    @Test func easings() {
        for u in [0.0, 0.2, 0.5, 0.9, 1.0] {
            #expect(close(Motion.ease("linear", u), u))
            #expect(close(Motion.ease("in", u), u * u))
            #expect(close(Motion.ease("out", u), 1 - (1 - u) * (1 - u)))
            #expect(close(Motion.ease("inOut", u), 3 * u * u - 2 * u * u * u))
            #expect(close(Motion.ease("sine", u), 0.5 - 0.5 * cos(.pi * u)))
        }
    }

    @Test func pathThroughVia() {
        let m = Self.sun
        // c = 2 via − (from + to) / 2 = (0, −0.16); at e = ½: ¼ from + ½ c + ¼ to = (0, −0.04) = via.
        let mid = m.position(0.5)
        #expect(close(mid.x, 0) && close(mid.y, -0.04))
        #expect(m.position(0) == m.from && close(m.position(1).x, 0.6))
        var straight = m
        straight.via = nil
        #expect(close(straight.position(0.25).x, -0.3) && close(straight.position(0.25).y, 0.08))
        let s = m.sample(serverNowMs: 1_000_000 + 300_000)  // u = .5, inOut(.5) = .5
        #expect(close(s.e, 0.5) && close(s.rotate, 4) && s.scale == 1 && s.kelvin == nil)
    }

    @Test func scaleAndKelvinDrift() {
        let rise = Motion(on: true, preset: "rise", from: FramePoint(x: 0, y: 0.32), to: FramePoint(x: 0, y: -0.04), duration: 900,
                          easing: "out", loop: "once", scaleFrom: 1.45, scaleTo: 1, kelvinFrom: 2300, kelvinTo: 4300, startedAt: 1)
        let end = rise.sample(serverNowMs: 2_000_000)
        #expect(end.u == 1 && close(end.scale, 1) && end.kelvin == 4300)
        let half = rise.sample(raw: 0.5)  // out(.5) = .75
        #expect(close(half.e, 0.75) && close(half.scale, 1.45 - 0.45 * 0.75) && close(half.kelvin ?? 0, 2300 + 2000 * 0.75))
    }

    @Test func pausePlayAndSpeedKeepThePlace() {
        let now = 1_000_000.0 + 450_000  // u = 0.75
        let paused = Self.sun.paused(serverNowMs: now)
        #expect(!paused.on && close(paused.phase, 0.75))
        #expect(close(paused.sample(serverNowMs: now + 99_999).u, 0.75))
        let played = paused.played(serverNowMs: now + 5000)
        #expect(played.on && played.startedAt == now + 5000 && close(played.sample(serverNowMs: now + 5000).u, 0.75))
        // Speed: same place at the moment of the change, then the new pace.
        let faster = Self.sun.withDuration(60, serverNowMs: now)
        #expect(faster.duration == 60 && faster.startedAt == now && close(faster.phase, 0.75))
        #expect(close(faster.sample(serverNowMs: now).u, Self.sun.sample(serverNowMs: now).u))
        #expect(close(faster.rawProgress(serverNowMs: now + 6000), 0.85))
        // A preset starts now from 0.
        let started = Motion.start(Self.sun, serverNowMs: 42)
        #expect(started.on && started.startedAt == 42 && started.phase == 0)
        // Pingpong keeps its direction through a pause (phase in 0…2).
        var pp = Self.sun
        pp.loop = "pingpong"
        let p2 = pp.paused(serverNowMs: 1_000_000 + 600_000 * 1.25)
        #expect(close(p2.phase, 1.25) && close(p2.sample(serverNowMs: 0).u, 0.75))
    }

    @Test func speedSliderIsLogarithmic() {
        #expect(close(MotionSpeed.duration(0), 5) && close(MotionSpeed.duration(1), 7200, 1e-6))
        #expect(close(MotionSpeed.duration(0.5), sqrt(5 * 7200), 1e-6))
        for d in [5.0, 90, 600, 7200] { #expect(close(MotionSpeed.duration(MotionSpeed.fraction(d)), d, 1e-6)) }
        #expect(MotionSpeed.fraction(1) == 0 && MotionSpeed.fraction(1e6) == 1)
    }

    @Test func encodesNullViaAndWholeMs() throws {
        var m = Self.sun
        m.via = nil
        m.startedAt = 1_791_700_000_123.4
        let j = try JSONValue(encoding: m)
        #expect(j["via"] == .null && j["startedAt"] == 1_791_700_000_123)
        #expect(try j.decode(Motion.self).preset == "sun-lr")
    }
}

/// D2: a control only takes a drag with clear horizontal intent.
@Suite struct DragIntentTests {
    @Test func decide() {
        #expect(DragIntent.decide(dx: 3, dy: 1) == .undecided)
        #expect(DragIntent.decide(dx: 0, dy: 8) == .undecided)
        #expect(DragIntent.decide(dx: 9, dy: 2) == .horizontal)
        #expect(DragIntent.decide(dx: -12, dy: 7) == .horizontal)   // 12 > 1.5 × 7 = 10.5
        #expect(DragIntent.decide(dx: 12, dy: 8.5) == .vertical)    // 12 < 12.75: diagonal goes to the page
        #expect(DragIntent.decide(dx: 2, dy: 9) == .vertical)
        #expect(DragIntent.decide(dx: 0, dy: -40) == .vertical)
        #expect(DragIntent.decide(dx: 40, dy: 0) == .horizontal)
    }

    /// The lock is decided once per gesture, vertical wins ties, a dead zone keeps taps, a moving page keeps the touch.
    @Test func directionLock() {
        var l = DirectionLock()
        l.begin(pageMoving: false)
        #expect(l.move(dx: 4, dy: 1) == .undecided && l.isTap)
        #expect(l.move(dx: 2, dy: 12) == .page)
        #expect(l.move(dx: 80, dy: 12) == .page)          // sticky: a vertical start never becomes a slider drag
        l.begin(pageMoving: false)
        #expect(l.move(dx: 12, dy: 8) == .page)           // a tie (12 < 1.5 × 8) goes to the page
        l.begin(pageMoving: false)
        #expect(l.move(dx: 10, dy: 2) == .control && l.origin == (10, 2))
        #expect(l.move(dx: 10, dy: 60) == .control)       // sticky the other way too: the drag stays on the control
        l.begin(pageMoving: true)
        #expect(l.decision == .page && l.move(dx: 40, dy: 0) == .page && !l.isTap)   // catching a scroll never adjusts
    }

    @Test func shouldBeginFallsBackToVelocity() {
        #expect(DragIntent.shouldBegin(dx: 10, dy: 1, vx: 0, vy: 0))
        #expect(!DragIntent.shouldBegin(dx: 1, dy: 10, vx: 500, vy: 0))   // the translation decides once it is long
        #expect(DragIntent.shouldBegin(dx: 2, dy: 1, vx: 400, vy: 100))
        #expect(!DragIntent.shouldBegin(dx: 2, dy: 1, vx: 100, vy: 400))
        #expect(!DragIntent.shouldBegin(dx: 0, dy: 0, vx: 0, vy: 0))
    }
}

/// §16: picking another attachment keeps the user's placement, opacity and motion; nothing touches the light.
@Suite struct AttachmentSwapTests {
    @Test func keepsPlacementOpacityAndMotion() throws {
        let cat = try Catalog.decode(Data(contentsOf: Fixtures.catalogURL))
        var old = cat.newAttachment(try #require(cat.gobo("plate-grid-window")), id: "att_old")
        old.rotation = -22; old.scale = 1.7; old.offsetX = 0.3; old.offsetY = -0.1; old.opacity = 0.6
        old.motion = cat.motionPreset("sun-lr")?.motion
        old.params["throw"] = 0.4
        let next = AttachmentSwap.replacing(old, with: try #require(cat.gobo("plate-hearts")), catalog: cat, id: "att_new")
        #expect(next.id == "att_new" && next.gobo == "plate-hearts" && next.name == cat.gobo("plate-hearts")?.name)
        #expect(next.rotation == -22 && next.scale == 1.7 && next.offsetX == 0.3 && next.offsetY == -0.1 && next.opacity == 0.6)
        #expect(next.motion == old.motion && next.param("throw") == 0.4)
        let fresh = AttachmentSwap.replacing(nil, with: try #require(cat.gobo("plate-hearts")), catalog: cat, id: "att_f")
        #expect(fresh == cat.newAttachment(try #require(cat.gobo("plate-hearts")), id: "att_f"))
    }
}
