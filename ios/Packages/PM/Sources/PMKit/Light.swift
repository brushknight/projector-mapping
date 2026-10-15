import Foundation

// Protocol §15: the stack light, attachments (gobos as masks in front of it) and Motion. Every field is optional on
// decode and falls back to the protocol's default.

/// `{ x, y }` in frame fractions.
public struct FramePoint: Codable, Sendable, Hashable {
    public var x: Double
    public var y: Double

    public init(x: Double = 0, y: Double = 0) { self.x = x; self.y = y }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        x = c.v(.x, 0)
        y = c.v(.y, 0)
    }

    public static let zero = FramePoint()
}

/// What colours a stack light before the masks: a gradient or an animated colour generator (null = the light's own
/// colour).
public struct ColorLayer: Codable, Sendable, Hashable {
    /// `gradient` | `generator`
    public var kind: String
    public var ref: String
    public var params: JSONObject

    public init(kind: String, ref: String, params: JSONObject = [:]) { self.kind = kind; self.ref = ref; self.params = params }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.v(.kind, "gradient")
        ref = c.v(.ref, "")
        params = c.v(.params, [:])
    }
}

/// `stack.light` of the `static` and `live` stacks.
public struct StackLight: Codable, Sendable, Hashable {
    public static let defaultKelvin = 5600.0

    public var intensity: Double
    public var focus: Double
    public var color: LightColor
    public var fx: LightFX
    public var colorLayer: ColorLayer?
    public var fringe: Double
    public var vignette: Double
    /// (§16) the background focus in `static`, the live layer focus in `live`; 1 is sharp (absent decodes to 1)
    public var backgroundFocus: Double
    public var slide: FramePoint
    public var motion: Motion?

    enum CodingKeys: String, CodingKey { case intensity, focus, backgroundFocus, color, fx, colorLayer, fringe, vignette, slide, motion }

    /// §16 defaults: attachment focus and background focus 1 (sharp), vignette 0; haze is gone.
    public init(intensity: Double = 0.85, focus: Double = 1, color: LightColor = LightColor(kelvin: StackLight.defaultKelvin),
                fx: LightFX = .init(), colorLayer: ColorLayer? = nil, fringe: Double = 0.2, vignette: Double = 0, backgroundFocus: Double = 1,
                slide: FramePoint = .zero, motion: Motion? = nil) {
        self.intensity = intensity; self.focus = focus; self.color = color; self.fx = fx; self.colorLayer = colorLayer
        self.fringe = fringe; self.vignette = vignette; self.backgroundFocus = backgroundFocus; self.slide = slide; self.motion = motion
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        intensity = c.v(.intensity, 0.85)
        focus = c.v(.focus, 1)
        backgroundFocus = c.v(.backgroundFocus, 1)
        if c.contains(.color), let color: LightColor = c.opt(.color) {
            // A colour object without a kelvin takes the stack light's 5600 K, not a layer light's 3200 K.
            let raw: JSONValue? = c.opt(.color)
            var col = color
            if raw?["kelvin"]?.double == nil { col.kelvin = Self.defaultKelvin }
            self.color = col
        } else {
            color = LightColor(kelvin: Self.defaultKelvin)
        }
        fx = c.v(.fx, LightFX())
        colorLayer = c.opt(.colorLayer)
        fringe = c.v(.fringe, 0.2)
        vignette = c.v(.vignette, 0)
        // `haze` (before §16) is ignored
        slide = c.v(.slide, FramePoint())
        motion = c.opt(.motion)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(intensity, forKey: .intensity)
        try c.encode(focus, forKey: .focus)
        try c.encode(backgroundFocus, forKey: .backgroundFocus)
        try c.encode(color, forKey: .color)
        try c.encode(fx, forKey: .fx)
        try c.encode(colorLayer, forKey: .colorLayer)
        try c.encode(fringe, forKey: .fringe)
        try c.encode(vignette, forKey: .vignette)
        try c.encode(slide, forKey: .slide)
        try c.encode(motion, forKey: .motion)
    }

    /// The upgrade of a v3 gobo layer's light (§15 Upgrade): intensity, colour and fx carry over, focus = 1 − softness.
    public init(upgrading light: Light) {
        self.init(intensity: light.intensity, focus: 1 - light.softness, color: light.color, fx: light.fx)
    }
}

/// A mask in front of a stack light (§15 Attachment).
public struct Attachment: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var gobo: String
    public var name: String
    public var visible: Bool
    public var opacity: Double
    public var rotation: Double
    public var offsetX: Double
    public var offsetY: Double
    public var scale: Double
    public var params: JSONObject
    public var motion: Motion?

    enum CodingKeys: String, CodingKey { case id, gobo, name, visible, opacity, rotation, offsetX, offsetY, scale, params, motion }

    public init(id: String, gobo: String, name: String, visible: Bool = true, opacity: Double = 1, rotation: Double = 0,
                offsetX: Double = 0, offsetY: Double = 0, scale: Double = 1, params: JSONObject = [:], motion: Motion? = nil) {
        self.id = id; self.gobo = gobo; self.name = name; self.visible = visible; self.opacity = opacity; self.rotation = rotation
        self.offsetX = offsetX; self.offsetY = offsetY; self.scale = scale; self.params = params; self.motion = motion
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        gobo = c.v(.gobo, "")
        name = c.v(.name, "")
        visible = c.v(.visible, true)
        opacity = c.v(.opacity, 1)
        rotation = c.v(.rotation, 0)
        offsetX = c.v(.offsetX, 0)
        offsetY = c.v(.offsetY, 0)
        scale = c.v(.scale, 1)
        params = c.v(.params, [:])
        motion = c.opt(.motion)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(gobo, forKey: .gobo)
        try c.encode(name, forKey: .name)
        try c.encode(visible, forKey: .visible)
        try c.encode(opacity, forKey: .opacity)
        try c.encode(rotation, forKey: .rotation)
        try c.encode(offsetX, forKey: .offsetX)
        try c.encode(offsetY, forKey: .offsetY)
        try c.encode(scale, forKey: .scale)
        try c.encode(params, forKey: .params)
        try c.encode(motion, forKey: .motion)
    }

    public func param(_ key: String) -> Double? { params[key]?.double }

    /// The upgrade of a v3 gobo layer (§15 Upgrade): same id, `gobo` = its ref, rotation from `light.angle`.
    public init(upgrading layer: Layer) {
        let l = layer.light ?? Light()
        self.init(id: layer.id, gobo: layer.ref, name: layer.name, visible: layer.visible, opacity: layer.opacity, rotation: l.angle,
                  offsetX: l.offsetX, offsetY: l.offsetY, scale: l.scale, params: layer.params)
    }
}

// MARK: - Motion

/// A move over time (§15 Motion) on a stack light, an attachment, or a photo / video layer.
public struct Motion: Codable, Sendable, Hashable {
    public var on: Bool
    public var preset: String
    public var from: FramePoint
    public var via: FramePoint?
    public var to: FramePoint
    /// Seconds, 1…86400.
    public var duration: Double
    /// `linear` | `in` | `out` | `inOut` | `sine`
    public var easing: String
    /// `once` | `loop` | `pingpong`
    public var loop: String
    public var rotate: Double
    public var scaleFrom: Double
    public var scaleTo: Double
    public var kelvinFrom: Double
    public var kelvinTo: Double
    /// 0…2
    public var phase: Double
    /// Server Unix ms.
    public var startedAt: Double

    enum CodingKeys: String, CodingKey {
        case on, preset, from, via, to, duration, easing, loop, rotate, scaleFrom, scaleTo, kelvinFrom, kelvinTo, phase, startedAt
    }

    public init(on: Bool = true, preset: String = "", from: FramePoint = .zero, via: FramePoint? = nil, to: FramePoint = .zero,
                duration: Double = 60, easing: String = "linear", loop: String = "loop", rotate: Double = 0, scaleFrom: Double = 1,
                scaleTo: Double = 1, kelvinFrom: Double = 0, kelvinTo: Double = 0, phase: Double = 0, startedAt: Double = 0) {
        self.on = on; self.preset = preset; self.from = from; self.via = via; self.to = to; self.duration = duration
        self.easing = easing; self.loop = loop; self.rotate = rotate; self.scaleFrom = scaleFrom; self.scaleTo = scaleTo
        self.kelvinFrom = kelvinFrom; self.kelvinTo = kelvinTo; self.phase = phase; self.startedAt = startedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        on = c.v(.on, false)
        preset = c.v(.preset, "")
        from = c.v(.from, FramePoint())
        via = c.opt(.via)
        to = c.v(.to, FramePoint())
        duration = c.v(.duration, 60)
        easing = c.v(.easing, "linear")
        loop = c.v(.loop, "loop")
        rotate = c.v(.rotate, 0)
        scaleFrom = c.v(.scaleFrom, 1)
        scaleTo = c.v(.scaleTo, 1)
        kelvinFrom = c.v(.kelvinFrom, 0)
        kelvinTo = c.v(.kelvinTo, 0)
        phase = c.v(.phase, 0)
        startedAt = c.v(.startedAt, 0)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(on, forKey: .on)
        try c.encode(preset, forKey: .preset)
        try c.encode(from, forKey: .from)
        try c.encode(via, forKey: .via)
        try c.encode(to, forKey: .to)
        try c.encode(duration, forKey: .duration)
        try c.encode(easing, forKey: .easing)
        try c.encode(loop, forKey: .loop)
        try c.encode(rotate, forKey: .rotate)
        try c.encode(scaleFrom, forKey: .scaleFrom)
        try c.encode(scaleTo, forKey: .scaleTo)
        try c.encode(kelvinFrom, forKey: .kelvinFrom)
        try c.encode(kelvinTo, forKey: .kelvinTo)
        try c.encode(phase, forKey: .phase)
        try c.encode(startedAt.rounded(), forKey: .startedAt)
    }

    /// Where the move is, evaluated exactly as §15.
    public struct Sample: Sendable, Hashable {
        /// Raw progress u before the loop is applied (on: phase + elapsed / duration).
        public var raw: Double
        /// u after `once` / `loop` / `pingpong`.
        public var u: Double
        /// The eased progress e.
        public var e: Double
        public var offset: FramePoint
        public var rotate: Double
        public var scale: Double
        /// nil when the motion has no CCT drift.
        public var kelvin: Double?
    }

    /// `u = on ? phase + (serverNowMs − startedAt) / (1000 × duration) : phase`.
    public func rawProgress(serverNowMs: Double) -> Double {
        guard on else { return phase }
        // As the web renderer: no start yet counts as now, and a start in the future (clock skew) as not begun.
        let started = startedAt > 0 ? startedAt : serverNowMs
        return phase + max(0, serverNowMs - started) / (1000 * max(duration, 0.001))
    }

    public static func applyLoop(_ loop: String, _ u: Double) -> Double {
        switch loop {
        case "once": return min(1, max(0, u))
        case "pingpong":
            let m = u - 2 * (u / 2).rounded(.down)  // u mod 2, in 0…2 for negatives too
            return 1 - abs(1 - m)
        default: return u - u.rounded(.down)
        }
    }

    public static func ease(_ easing: String, _ u: Double) -> Double {
        switch easing {
        case "in": return u * u
        case "out": return 1 - (1 - u) * (1 - u)
        case "inOut": return 3 * u * u - 2 * u * u * u
        case "sine": return 0.5 - 0.5 * cos(.pi * u)
        default: return u
        }
    }

    /// The position for an eased progress: straight from → to, or the quadratic through `via`.
    public func position(_ e: Double) -> FramePoint {
        guard let via else {
            return FramePoint(x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e)
        }
        let cx = 2 * via.x - (from.x + to.x) / 2, cy = 2 * via.y - (from.y + to.y) / 2
        let a = (1 - e) * (1 - e), b = 2 * e * (1 - e), d = e * e
        return FramePoint(x: a * from.x + b * cx + d * to.x, y: a * from.y + b * cy + d * to.y)
    }

    public func sample(serverNowMs: Double) -> Sample { sample(raw: rawProgress(serverNowMs: serverNowMs)) }

    public func sample(raw: Double) -> Sample {
        let u = Self.applyLoop(loop, raw)
        let e = Self.ease(easing, u)
        let drift = kelvinFrom > 0 && kelvinTo > 0
        return Sample(raw: raw, u: u, e: e, offset: position(e), rotate: rotate * e, scale: scaleFrom + (scaleTo - scaleFrom) * e,
                      kelvin: drift ? kelvinFrom + (kelvinTo - kelvinFrom) * e : nil)
    }

    // MARK: Transport (§15: pause, play, speed keep the place)

    /// Pause: `on: false`, `phase` = the current u (kept in 0…2 so a looping move resumes where it stood).
    public func paused(serverNowMs: Double) -> Motion {
        guard on else { return self }
        var m = self
        m.phase = Self.storedPhase(loop, rawProgress(serverNowMs: serverNowMs))
        m.on = false
        return m
    }

    /// Play: `on: true`, `startedAt` = now (the phase holds the place).
    public func played(serverNowMs: Double) -> Motion {
        var m = self
        if !m.on { m.on = true; m.startedAt = serverNowMs.rounded() }
        return m
    }

    /// A new duration that keeps the place: `phase` = the current u, `startedAt` = now, then the duration.
    public func withDuration(_ seconds: Double, serverNowMs: Double) -> Motion {
        var m = self
        m.phase = Self.storedPhase(loop, rawProgress(serverNowMs: serverNowMs))
        if m.on { m.startedAt = serverNowMs.rounded() }
        m.duration = min(86400, max(1, seconds))
        return m
    }

    /// A catalog preset's motion started now.
    public static func start(_ preset: Motion, serverNowMs: Double) -> Motion {
        var m = preset
        m.on = true
        m.phase = 0
        m.startedAt = serverNowMs.rounded()
        return m
    }

    /// The phase to store for a raw progress: a `once` move clamps to 0…1, the others keep u mod 2 (0…2) so a
    /// pingpong keeps its direction.
    static func storedPhase(_ loop: String, _ raw: Double) -> Double {
        if loop == "once" { return min(1, max(0, raw)) }
        let m = raw - 2 * (raw / 2).rounded(.down)
        return min(2, max(0, m))
    }
}

/// The phone's speed slider (§15): a log scale from 5 s to 2 h mapped to `duration`.
public enum MotionSpeed {
    public static let shortest = 5.0
    public static let longest = 7200.0

    /// Slider fraction 0…1 → duration in seconds (0 is the fastest move: 5 s).
    public static func duration(_ fraction: Double) -> Double {
        let f = min(1, max(0, fraction))
        return shortest * pow(longest / shortest, f)
    }

    public static func fraction(_ duration: Double) -> Double {
        let d = min(longest, max(shortest, duration))
        return log(d / shortest) / log(longest / shortest)
    }
}

// MARK: - Scene kinds

public enum SceneKind {
    public static let all = ["static", "live", "color", "scenery", "mapping"]

    /// The mode a kind puts on air: the kind itself, `objects` for `mapping`.
    public static func mode(_ kind: String) -> String { kind == "mapping" ? "objects" : kind }

    /// §15 inference: objects → mapping; otherwise the mode (`objects` → mapping), default static.
    public static func infer(kind: String?, hasObjects: Bool, mode: String?) -> String {
        if let kind, all.contains(kind) { return kind }
        if hasObjects { return "mapping" }
        switch mode {
        case "objects": return "mapping"
        case let m? where all.contains(m): return m
        default: return "static"
        }
    }
}

// MARK: - Settings (§8, §15)

public struct ServerSettings: Codable, Sendable, Hashable {
    public var agentMayPreview: Bool
    public var agentMayGoLive: Bool
    public var agentMayApply: Bool
    /// When on, the backdrop MCP tools write straight to the live scene.
    public var agentLiveEdits: Bool

    public init(agentMayPreview: Bool = false, agentMayGoLive: Bool = false, agentMayApply: Bool = false, agentLiveEdits: Bool = false) {
        self.agentMayPreview = agentMayPreview; self.agentMayGoLive = agentMayGoLive; self.agentMayApply = agentMayApply
        self.agentLiveEdits = agentLiveEdits
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        agentMayPreview = c.v(.agentMayPreview, false)
        agentMayGoLive = c.v(.agentMayGoLive, false)
        agentMayApply = c.v(.agentMayApply, false)
        agentLiveEdits = c.v(.agentLiveEdits, false)
    }
}

// MARK: - Client ids

/// Client-made ids for new entities (protocol §8: `<prefix>_<8 base36 chars>`).
public enum ClientID {
    public static func make(_ prefix: String) -> String {
        let chars = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        return prefix + "_" + String((0..<8).map { _ in chars.randomElement()! })
    }
}

// MARK: - Scene templates (offline twin of the server's, §15)

public enum SceneTemplates {
    /// The default template of a kind.
    public static func id(for kind: String) -> String {
        switch kind {
        case "live": "live-window-tree"
        case "color": "color-ember"
        case "scenery": "scenery-flowers"
        case "mapping": "mapping-empty"
        default: "static-window"
        }
    }

    /// A new scene document built as the server builds it from a kind's default template (demo mode, offline).
    public static func document(kind: String, id: String, name: String, setupId: String, catalog: Catalog) -> JSONValue {
        func enc<T: Encodable>(_ v: T) -> JSONValue { (try? JSONValue(encoding: v)) ?? .null }
        let warm = StackLight(intensity: 0.85, focus: 0.68, color: LightColor(kelvin: 3200))
        // the live template's light takes the focus that suits its window (§15); the static one stays at 0.68
        var liveLight = warm
        var window: JSONValue = .null
        // catalog 6 (§16): the 6-pane grid window preset; older catalogs had window-4
        if let item = catalog.gobo("plate-grid-window") ?? catalog.gobo("window-4") ?? catalog.gobos.first {
            var a = catalog.newAttachment(item)
            // parked mid-path: at phase 0 the window would sit at `from`, off the frame
            if let sun = catalog.motionPreset("sun-lr")?.motion { var m = sun; m.on = false; m.phase = 0.5; a.motion = m }
            window = enc(a)
            liveLight.focus = item.focus ?? 0.68
        }
        var still: JSONValue = ["layers": [], "light": enc(StackLight()), "attachments": []]
        var live: JSONValue = ["layers": [], "light": nil, "attachments": []]
        var color: JSONValue = ["layers": []]
        var scenery: JSONValue = ["layers": []]
        switch kind {
        case "static":
            still = ["layers": [], "light": enc(warm), "attachments": window == .null ? [] : [window]]
        case "live":
            var tree: JSONValue = .null
            if let p = catalog.procedural("tree-sway") {
                tree = ["id": .string(ClientID.make("lay")), "kind": "procedural", "ref": "tree-sway", "name": .string(p.name), "visible": true,
                        "opacity": 1, "blend": "multiply", "light": nil, "params": .object(p.defaults)]
            }
            var w = window
            if case .object(var o) = w { o["id"] = .string(ClientID.make("att")); o["motion"] = .null; w = .object(o) }
            live = ["layers": tree == .null ? [] : [tree], "light": enc(liveLight), "attachments": w == .null ? [] : [w]]
        case "color":
            let g = catalog.gradient("ember")
            color = ["layers": [["id": .string(ClientID.make("lay")), "kind": "gradient", "ref": "ember", "name": .string(g?.name ?? "ember"),
                                 "visible": true, "opacity": 1, "blend": "normal", "light": nil,
                                 "params": .object(g?.defaults ?? Catalog.defaults(catalog.gradientParams))]]]
        case "scenery":
            scenery = ["layers": [["id": .string(ClientID.make("lay")), "kind": "photo", "ref": "flowers", "name": "flowers", "visible": true,
                                   "opacity": 1, "blend": "normal", "light": nil, "params": .object(Catalog.defaults(catalog.photoParams))]]]
        default:
            break
        }
        let k = SceneKind.all.contains(kind) ? kind : "static"
        return ["id": .string(id), "setupId": .string(setupId), "name": .string(name), "version": 1, "kind": .string(k),
                "mode": .string(SceneKind.mode(k)),
                "backdrop": ["static": still, "live": live, "color": color, "scenery": scenery],
                "underlay": ["on": false, "from": "static", "level": 0.35], "points": [], "objects": [],
                "timeline": ["duration": 20, "tracks": [], "clips": [], "cues": []], "sounds": ["pads": []]]
    }
}

// MARK: - Swapping an attachment (§16)

/// Picking another attachment keeps what the user set: the new one takes the replaced attachment's placement
/// (rotation, scale, offsets), how much it blocks (opacity), visibility and motion; only the gobo, its name and its
/// own params come from the catalog. The light is never touched by a pick.
public enum AttachmentSwap {
    public static func replacing(_ old: Attachment?, with item: GoboItem, catalog: Catalog, id: String = ClientID.make("att")) -> Attachment {
        var a = catalog.newAttachment(item, id: id)
        guard let old else { return a }
        a.rotation = old.rotation
        a.scale = old.scale
        a.offsetX = old.offsetX
        a.offsetY = old.offsetY
        a.opacity = old.opacity
        a.visible = old.visible
        a.motion = old.motion
        // the wall params (throw, keystone, depth) are placement too
        for k in catalog.goboParams.items.map(\.key) { if let v = old.params[k] { a.params[k] = v } }
        return a
    }
}
