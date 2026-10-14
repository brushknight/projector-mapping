import Foundation

// Wire models for docs/protocol.md §1. Decoding is tolerant: unknown fields are ignored, missing or mistyped fields
// fall back to the protocol's defaults, so a newer server never breaks an older phone. Enumerations stay `String` on
// the wire (with typed helpers) for the same reason. Scene documents are kept as `JSONValue` in the store; these
// structs are views onto them.

extension KeyedDecodingContainer {
    /// The value for `key`, or `fallback` when it is missing, null or of another type.
    @inlinable
    public func v<T: Decodable>(_ key: Key, _ fallback: @autoclosure () -> T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback()
    }

    @inlinable
    public func opt<T: Decodable>(_ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }
}

// MARK: - Setup

public struct OutputConfig: Codable, Sendable, Hashable {
    public var width: Int
    public var height: Int
    /// `landscape` | `portrait-cw` | `portrait-ccw`
    public var orientation: String
    public var flipH: Bool
    public var flipV: Bool

    public init(width: Int = 1920, height: Int = 1080, orientation: String = "landscape", flipH: Bool = false, flipV: Bool = false) {
        self.width = width; self.height = height; self.orientation = orientation; self.flipH = flipH; self.flipV = flipV
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        width = c.v(.width, 1920)
        height = c.v(.height, 1080)
        orientation = c.v(.orientation, "landscape")
        flipH = c.v(.flipH, false)
        flipV = c.v(.flipV, false)
    }

    public var isPortrait: Bool { orientation.hasPrefix("portrait") }
}

public struct Setup: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var output: OutputConfig
    public var master: Double
    public var blackoutFadeMs: Int
    /// `off` | `grid` | `white` | `crosshair` | `corners`
    public var testPattern: String
    /// Server Unix nanoseconds when the test pattern goes back to `off`; nil while it is off.
    public var testPatternUntil: Int64?
    public var referenceAsset: String?
    public var calibrationId: String?

    public init(id: String, name: String, output: OutputConfig = .init(), master: Double = 1, blackoutFadeMs: Int = 500,
                testPattern: String = "off", testPatternUntil: Int64? = nil, referenceAsset: String? = nil, calibrationId: String? = nil) {
        self.id = id; self.name = name; self.output = output; self.master = master; self.blackoutFadeMs = blackoutFadeMs
        self.testPattern = testPattern; self.testPatternUntil = testPatternUntil
        self.referenceAsset = referenceAsset; self.calibrationId = calibrationId
    }

    /// The pattern on the wall at a server clock reading (Unix ms): `off` once `testPatternUntil` has passed.
    public func activeTestPattern(serverNowMs: Double) -> String {
        guard testPattern != "off" else { return "off" }
        if let until = testPatternUntil, Double(until) / 1e6 <= serverNowMs { return "off" }
        return testPattern
    }

    /// Whole seconds until the test pattern expires (nil when off or without an expiry).
    public func testPatternRemaining(serverNowMs: Double) -> Int? {
        guard testPattern != "off", let until = testPatternUntil else { return nil }
        let left = Double(until) / 1e6 - serverNowMs
        return left > 0 ? Int(left / 1000) : nil
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        output = c.v(.output, OutputConfig())
        master = c.v(.master, 1)
        blackoutFadeMs = c.v(.blackoutFadeMs, 500)
        testPattern = c.v(.testPattern, "off")
        let exact: Int64? = c.opt(.testPatternUntil)
        let approx: Double? = c.opt(.testPatternUntil)
        testPatternUntil = exact ?? approx.map { Int64($0) }
        referenceAsset = c.opt(.referenceAsset)
        calibrationId = c.opt(.calibrationId)
    }
}

// MARK: - Scene

public struct LightColor: Codable, Sendable, Hashable {
    /// `cct` | `hsi`
    public var mode: String
    public var kelvin: Double
    public var tint: Double
    public var hue: Double
    public var sat: Double

    public init(mode: String = "cct", kelvin: Double = 3200, tint: Double = 0, hue: Double = 212, sat: Double = 0.7) {
        self.mode = mode; self.kelvin = kelvin; self.tint = tint; self.hue = hue; self.sat = sat
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = c.v(.mode, "cct")
        kelvin = c.v(.kelvin, 3200)
        tint = c.v(.tint, 0)
        hue = c.v(.hue, 212)
        sat = c.v(.sat, 0.7)
    }
}

public struct LightFX: Codable, Sendable, Hashable {
    /// `none` | `candle` | `fire` | `lightning` | `paparazzi` | `tv` | `breathe` | `strobe` | `police`
    public var kind: String
    public var speed: Double

    public init(kind: String = "none", speed: Double = 0.35) { self.kind = kind; self.speed = speed }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.v(.kind, "none")
        speed = c.v(.speed, 0.35)
    }
}

public struct Light: Codable, Sendable, Hashable {
    public var intensity: Double
    public var softness: Double
    public var angle: Double
    public var scale: Double
    public var offsetX: Double
    public var offsetY: Double
    public var color: LightColor
    public var fx: LightFX

    public init(intensity: Double = 0.8, softness: Double = 0.5, angle: Double = 0, scale: Double = 1, offsetX: Double = 0,
                offsetY: Double = 0, color: LightColor = .init(), fx: LightFX = .init()) {
        self.intensity = intensity; self.softness = softness; self.angle = angle; self.scale = scale
        self.offsetX = offsetX; self.offsetY = offsetY; self.color = color; self.fx = fx
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        intensity = c.v(.intensity, 0.8)
        softness = c.v(.softness, 0.5)
        angle = c.v(.angle, 0)
        scale = c.v(.scale, 1)
        offsetX = c.v(.offsetX, 0)
        offsetY = c.v(.offsetY, 0)
        color = c.v(.color, LightColor())
        fx = c.v(.fx, LightFX())
    }
}

public struct Layer: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    /// `gobo` | `procedural` | `gradient` | `photo` | `solid` | `video`
    public var kind: String
    public var ref: String
    public var name: String
    public var visible: Bool
    public var opacity: Double
    /// `normal` | `multiply` | `screen` | `add`
    public var blend: String
    public var light: Light?
    public var params: JSONObject

    public init(id: String, kind: String, ref: String, name: String, visible: Bool = true, opacity: Double = 1,
                blend: String = "normal", light: Light? = nil, params: JSONObject = [:]) {
        self.id = id; self.kind = kind; self.ref = ref; self.name = name; self.visible = visible; self.opacity = opacity
        self.blend = blend; self.light = light; self.params = params
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        kind = c.v(.kind, "gobo")
        ref = c.v(.ref, "")
        name = c.v(.name, "")
        visible = c.v(.visible, true)
        opacity = c.v(.opacity, 1)
        blend = c.v(.blend, "normal")
        light = c.opt(.light)
        params = c.v(.params, [:])
    }

    public func param(_ key: String) -> Double? { params[key]?.double }
}

/// One layer stack, bottom to top (a preset's backdrop, or one mode's stack of a scene).
public struct Backdrop: Codable, Sendable, Hashable {
    public var layers: [Layer]
    public init(layers: [Layer] = []) { self.layers = layers }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        layers = c.v(.layers, [])
    }
}

/// What is on air (protocol §1 Scene `mode`): exactly one at a time.
public enum SceneMode {
    public static let backdrops = ["static", "live", "color", "scenery"]
    public static let all = backdrops + ["objects"]
    public static func isBackdrop(_ mode: String) -> Bool { backdrops.contains(mode) }
}

/// A scene's backdrop: one stack per backdrop mode. A v1 document (`{ layers }`) is split by layer kind, as the
/// server does on upgrade.
public struct SceneBackdrop: Codable, Sendable, Hashable {
    public var still: Backdrop
    public var live: Backdrop
    public var color: Backdrop
    public var scenery: Backdrop

    enum CodingKeys: String, CodingKey { case still = "static", live, color, scenery, layers }

    public init(still: Backdrop = .init(), live: Backdrop = .init(), color: Backdrop = .init(), scenery: Backdrop = .init()) {
        self.still = still; self.live = live; self.color = color; self.scenery = scenery
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        still = c.v(.still, Backdrop())
        live = c.v(.live, Backdrop())
        color = c.v(.color, Backdrop())
        scenery = c.v(.scenery, Backdrop())
        let legacy: [Layer] = c.v(.layers, [])
        if !legacy.isEmpty, still.layers.isEmpty, live.layers.isEmpty, color.layers.isEmpty, scenery.layers.isEmpty {
            still.layers = legacy.filter { $0.kind == "gobo" }
            color.layers = legacy.filter { $0.kind == "gradient" || $0.kind == "solid" }
            scenery.layers = legacy.filter { $0.kind == "photo" }
            let procedural = legacy.filter { $0.kind == "procedural" }
            if !procedural.isEmpty {
                live.layers = still.layers.map { var l = $0; l.id += "_live"; return l } + procedural
            }
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(still, forKey: .still)
        try c.encode(live, forKey: .live)
        try c.encode(color, forKey: .color)
        try c.encode(scenery, forKey: .scenery)
    }

    /// The layers of a backdrop mode (empty for `objects` or an unknown mode).
    public subscript(mode: String) -> [Layer] {
        switch mode {
        case "static": still.layers
        case "live": live.layers
        case "color": color.layers
        case "scenery": scenery.layers
        default: []
        }
    }
}

/// The backdrop drawn under the objects in `objects` mode, dimmed to `level`.
public struct Underlay: Codable, Sendable, Hashable {
    public var on: Bool
    /// One of the backdrop modes.
    public var from: String
    public var level: Double

    public init(on: Bool = false, from: String = "static", level: Double = 0.35) { self.on = on; self.from = from; self.level = level }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        on = c.v(.on, false)
        from = c.v(.from, "static")
        level = c.v(.level, 0.35)
    }
}

public struct ScenePoint: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var x: Double
    public var y: Double
    public init(id: String, x: Double, y: Double) { self.id = id; self.x = x; self.y = y }
}

public struct SurfaceEffect: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    /// Optional label, for example an MCP drawing layer ("bays", "logo").
    public var name: String?
    public var effect: String
    public var enabled: Bool
    public var params: JSONObject

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.opt(.name)
        effect = c.v(.effect, "")
        enabled = c.v(.enabled, true)
        params = c.v(.params, [:])
    }
}

public struct Surface: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// `quad` | `tri` | `poly` | `circle` | `line` | `mask`
    public var kind: String
    /// `face` | `edge` | `detail`
    public var role: String
    public var pointIds: [String]
    public var parentId: String?
    public var visible: Bool
    public var mesh: JSONValue?
    public var effects: [SurfaceEffect]
    public var opacity: Double
    public var softEdge: Double
    /// Content layers (protocol §12), kept as JSON so a round trip does not drop them; the app does not draw them.
    public var layers: JSONValue?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        kind = c.v(.kind, "quad")
        role = c.v(.role, "face")
        pointIds = c.v(.pointIds, [])
        parentId = c.opt(.parentId)
        visible = c.v(.visible, true)
        mesh = c.opt(.mesh)
        effects = c.v(.effects, [])
        opacity = c.v(.opacity, 1)
        softEdge = c.v(.softEdge, 0)
        layers = c.opt(.layers)
    }
}

public struct MapObject: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var tags: [String]
    public var visible: Bool
    public var surfaces: [Surface]
    /// The faces' unfolded layout and the object's content layers (protocol §12), kept as JSON; not drawn here.
    public var atlas: JSONValue?
    public var layers: JSONValue?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        tags = c.v(.tags, [])
        visible = c.v(.visible, true)
        surfaces = c.v(.surfaces, [])
        atlas = c.opt(.atlas)
        layers = c.opt(.layers)
    }

    public var faces: Int { surfaces.filter { $0.role == "face" }.count }
    public var effectCount: Int { surfaces.reduce(0) { $0 + $1.effects.count } }
}

public struct TrackTarget: Codable, Sendable, Hashable {
    /// `surface` | `object` | `all` | `layer` (a content layer id) | `sound` (protocol §14, id null)
    public var kind: String
    public var id: String?
    public init(kind: String, id: String? = nil) { self.kind = kind; self.id = id }
    public var isSound: Bool { kind == "sound" }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.v(.kind, "all")
        id = c.opt(.id)
    }
}

public struct Track: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var target: TrackTarget
    public init(id: String, name: String, target: TrackTarget) { self.id = id; self.name = name; self.target = target }
}

public struct Clip: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var trackId: String
    public var effect: String
    public var start: Double
    public var end: Double
    public var fadeIn: Double
    public var fadeOut: Double
    public var params: JSONObject

    public init(id: String, trackId: String, effect: String, start: Double, end: Double, fadeIn: Double = 0, fadeOut: Double = 0, params: JSONObject = [:]) {
        self.id = id; self.trackId = trackId; self.effect = effect; self.start = start; self.end = end
        self.fadeIn = fadeIn; self.fadeOut = fadeOut; self.params = params
    }

    /// `{ sound, offset, volume }` of a clip on a sound track (protocol §14), nil for other clips.
    public var sound: SoundClipParams? { effect == "sound" ? SoundClipParams(params) : nil }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        trackId = c.v(.trackId, "")
        effect = c.v(.effect, "")
        start = c.v(.start, 0)
        end = c.v(.end, 0)
        fadeIn = c.v(.fadeIn, 0)
        fadeOut = c.v(.fadeOut, 0)
        params = c.v(.params, [:])
    }
}

public struct Cue: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var at: Double
    public var label: String
    public var autoFollow: Bool
    /// The sound the wall plays when this cue starts (protocol §14), nil for none.
    public var sound: CueSound?

    public init(id: String, at: Double, label: String, autoFollow: Bool = false, sound: CueSound? = nil) {
        self.id = id; self.at = at; self.label = label; self.autoFollow = autoFollow; self.sound = sound
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        at = c.v(.at, 0)
        label = c.v(.label, "")
        autoFollow = c.v(.autoFollow, false)
        sound = c.opt(.sound)
    }
}

public struct Timeline: Codable, Sendable, Hashable {
    public var duration: Double
    public var tracks: [Track]
    public var clips: [Clip]
    public var cues: [Cue]

    public init(duration: Double = 0, tracks: [Track] = [], clips: [Clip] = [], cues: [Cue] = []) {
        self.duration = duration; self.tracks = tracks; self.clips = clips; self.cues = cues
    }

    /// The clips on sound tracks with their params, in timeline order.
    public var soundClips: [(clip: Clip, params: SoundClipParams)] {
        let ids = Set(tracks.filter(\.target.isSound).map(\.id))
        return clips.filter { ids.contains($0.trackId) }.compactMap { c in c.sound.map { (c, $0) } }.sorted { $0.clip.start < $1.clip.start }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        duration = c.v(.duration, 0)
        tracks = c.v(.tracks, [])
        clips = c.v(.clips, [])
        cues = c.v(.cues, [])
    }
}

public struct Scene: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var setupId: String
    public var name: String
    public var version: Int
    /// `static` | `live` | `color` | `scenery` | `objects`
    public var mode: String
    public var backdrop: SceneBackdrop
    public var underlay: Underlay
    public var points: [ScenePoint]
    public var objects: [MapObject]
    public var timeline: Timeline
    /// The soundboard (protocol §14); absent decodes as no pads.
    public var sounds: SceneSounds

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        setupId = c.v(.setupId, "")
        name = c.v(.name, "")
        version = c.v(.version, 0)
        let stacks = c.v(.backdrop, SceneBackdrop())
        backdrop = stacks
        let m: String = c.v(.mode, "")
        if SceneMode.all.contains(m) {
            mode = m
        } else if !stacks.live.layers.isEmpty {
            mode = "live"
        } else {
            mode = SceneMode.backdrops.first { !stacks[$0].isEmpty } ?? "static"
        }
        underlay = c.v(.underlay, Underlay())
        points = c.v(.points, [])
        objects = c.v(.objects, [])
        timeline = c.v(.timeline, Timeline())
        sounds = c.v(.sounds, SceneSounds())
    }

    /// Every sound sha the scene can play now: pads, cue sounds and timeline sound clips.
    public var soundShas: [String] {
        var seen = Set<String>(), out: [String] = []
        let all = sounds.pads.map(\.sound) + timeline.cues.compactMap { $0.sound?.sound } + timeline.soundClips.map(\.params.sound)
        for s in all where !s.isEmpty && seen.insert(s).inserted { out.append(s) }
        return out
    }

    /// The layers of a backdrop mode.
    public func layers(_ mode: String) -> [Layer] { backdrop[mode] }

    /// What the wall shows now: the on-air stack, or the underlay in `objects` mode when it is on.
    public var onAirLayers: [Layer] {
        if SceneMode.isBackdrop(mode) { return backdrop[mode] }
        return underlay.on ? backdrop[underlay.from] : []
    }
}

/// A row of `GET /scenes`.
public struct SceneSummary: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var setupId: String
    public var version: Int

    public init(id: String, name: String, setupId: String, version: Int) {
        self.id = id; self.name = name; self.setupId = setupId; self.version = version
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        setupId = c.v(.setupId, "")
        version = c.v(.version, 0)
    }
}

// MARK: - Effect, Show, Preset, Device, Draft, Agents, Asset

public struct Effect: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// `builtin` | `glsl` | `js`
    public var kind: String
    public var origin: String
    public var group: String?
    public var params: JSONObject
    public var source: String?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        kind = c.v(.kind, "builtin")
        origin = c.v(.origin, "builtin")
        group = c.opt(.group)
        params = c.v(.params, [:])
        source = c.opt(.source)
    }
}

public struct Transport: Codable, Sendable, Hashable {
    /// `stopped` | `playing` | `paused`
    public var state: String
    /// Server Unix nanoseconds.
    public var startedAt: Int64
    public var offset: Double
    public var cue: Int

    public init(state: String = "stopped", startedAt: Int64 = 0, offset: Double = 0, cue: Int = 0) {
        self.state = state; self.startedAt = startedAt; self.offset = offset; self.cue = cue
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = c.v(.state, "stopped")
        let exact: Int64? = c.opt(.startedAt)
        let approx: Double? = c.opt(.startedAt)
        startedAt = exact ?? approx.map { Int64($0) } ?? 0
        offset = c.v(.offset, 0)
        cue = c.v(.cue, 0)
    }

    /// The playhead in seconds for a server clock reading (Unix ms, already offset-corrected).
    public func playhead(serverNowMs: Double) -> Double {
        guard state == "playing" else { return offset }
        return offset + (serverNowMs * 1e6 - Double(startedAt)) / 1e9
    }
}

public struct Show: Codable, Sendable, Hashable {
    public var activeSetupId: String?
    public var activeSceneId: String?
    public var onAir: Bool
    public var transport: Transport
    public var version: Int
    /// The output draws only these surfaces until `solo.until` (protocol §12); decoded, not acted on here.
    public var solo: Solo?
    /// Which client plays sound, the master volume and the looping pads (protocol §14).
    public var audio: ShowAudio

    public init(activeSetupId: String? = nil, activeSceneId: String? = nil, onAir: Bool = true, transport: Transport = .init(), version: Int = 0,
                solo: Solo? = nil, audio: ShowAudio = .init()) {
        self.activeSetupId = activeSetupId; self.activeSceneId = activeSceneId; self.onAir = onAir
        self.transport = transport; self.version = version; self.solo = solo; self.audio = audio
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        activeSetupId = c.opt(.activeSetupId)
        activeSceneId = c.opt(.activeSceneId)
        onAir = c.v(.onAir, true)
        transport = c.v(.transport, Transport())
        version = c.v(.version, 0)
        solo = c.opt(.solo)
        audio = c.v(.audio, ShowAudio())
    }
}

/// `show.solo`: some surfaces alone on the wall for a while (server Unix ns).
public struct Solo: Codable, Sendable, Hashable {
    public var surfaceIds: [String]
    /// `content` | `white` | `grid`
    public var fill: String
    public var until: Int64

    public init(surfaceIds: [String], fill: String = "content", until: Int64) {
        self.surfaceIds = surfaceIds; self.fill = fill; self.until = until
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        surfaceIds = c.v(.surfaceIds, [])
        fill = c.v(.fill, "content")
        let exact: Int64? = c.opt(.until)
        let approx: Double? = c.opt(.until)
        until = exact ?? approx.map { Int64($0) } ?? 0
    }
}

public struct Preset: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// `static` | `live` | `color` | `scenery`
    public var mode: String
    public var backdrop: Backdrop
    public var thumbAsset: String?
    public var createdAt: String?

    public init(id: String, name: String, mode: String, backdrop: Backdrop = .init(), thumbAsset: String? = nil, createdAt: String? = nil) {
        self.id = id; self.name = name; self.mode = mode; self.backdrop = backdrop; self.thumbAsset = thumbAsset; self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        mode = c.v(.mode, "static")
        backdrop = c.v(.backdrop, Backdrop())
        thumbAsset = c.opt(.thumbAsset)
        createdAt = c.opt(.createdAt)
    }
}

public struct Device: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// `output` | `editor` | `remote` | `agent`
    public var role: String
    public var lastSeen: String?
    public var online: Bool
    public var telemetry: Telemetry?

    public init(id: String, name: String, role: String, lastSeen: String? = nil, online: Bool = true, telemetry: Telemetry? = nil) {
        self.id = id; self.name = name; self.role = role; self.lastSeen = lastSeen; self.online = online; self.telemetry = telemetry
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        role = c.v(.role, "remote")
        lastSeen = c.opt(.lastSeen)
        online = c.v(.online, false)
        telemetry = c.opt(.telemetry)
    }
}

/// What the output reports every 2 s (relayed as `device.telemetry`).
public struct Telemetry: Codable, Sendable, Hashable {
    public var fps: Double
    public var dropped: Int
    public var width: Int
    public var height: Int
    public var refresh: Double

    public init(fps: Double, dropped: Int, width: Int, height: Int, refresh: Double) {
        self.fps = fps; self.dropped = dropped; self.width = width; self.height = height; self.refresh = refresh
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fps = c.v(.fps, 0)
        dropped = c.v(.dropped, 0)
        width = c.v(.width, 0)
        height = c.v(.height, 0)
        refresh = c.v(.refresh, 0)
    }
}

public struct Draft: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var sceneId: String
    public var author: String
    public var baseVersion: Int
    public var ops: [PatchOp]
    /// `open` | `proposed` | `applied` | `discarded`
    public var status: String
    public var summary: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        sceneId = c.v(.sceneId, "")
        author = c.v(.author, "")
        baseVersion = c.v(.baseVersion, 0)
        ops = c.v(.ops, [])
        status = c.v(.status, "open")
        summary = c.v(.summary, "")
    }
}

public struct AgentSession: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    /// `codex` | `claude`
    public var agent: String
    public var prompt: String
    /// `running` | `done` | `failed` | `cancelled`
    public var status: String
    public var sceneId: String?
    public var draftId: String?
    public var createdAt: String?

    public init(id: String, agent: String, prompt: String, status: String = "running", sceneId: String? = nil, draftId: String? = nil, createdAt: String? = nil) {
        self.id = id; self.agent = agent; self.prompt = prompt; self.status = status; self.sceneId = sceneId
        self.draftId = draftId; self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        agent = c.v(.agent, "codex")
        prompt = c.v(.prompt, "")
        status = c.v(.status, "running")
        sceneId = c.opt(.sceneId)
        draftId = c.opt(.draftId)
        createdAt = c.opt(.createdAt)
    }
}

public struct AgentEvent: Codable, Sendable, Hashable, Identifiable {
    public var seq: Int
    /// `message` | `tool` | `status`
    public var kind: String
    public var tool: String?
    public var text: String
    public var durationMs: Int?
    public var ok: Bool?
    public var ts: String?

    public var id: Int { seq }

    public init(seq: Int, kind: String, tool: String? = nil, text: String, durationMs: Int? = nil, ok: Bool? = nil, ts: String? = nil) {
        self.seq = seq; self.kind = kind; self.tool = tool; self.text = text; self.durationMs = durationMs; self.ok = ok; self.ts = ts
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seq = c.v(.seq, 0)
        kind = c.v(.kind, "message")
        tool = c.opt(.tool)
        text = c.v(.text, "")
        durationMs = c.opt(.durationMs)
        ok = c.opt(.ok)
        ts = c.opt(.ts)
    }
}

public struct Asset: Codable, Sendable, Hashable {
    public var sha: String
    public var mime: String
    public var width: Int
    public var height: Int
    public var bytes: Int
    /// `photo` | `reference` | `snapshot` | `calibration` | `thumb` | `sound` | `video`
    public var kind: String
    /// Sounds and videos (protocol §14): a display name, the length in seconds and (sounds) 0…1 peaks.
    public var name: String?
    public var duration: Double?
    public var peaks: [Double]

    public init(sha: String, mime: String = "image/jpeg", width: Int = 0, height: Int = 0, bytes: Int = 0, kind: String = "photo",
                name: String? = nil, duration: Double? = nil, peaks: [Double] = []) {
        self.sha = sha; self.mime = mime; self.width = width; self.height = height; self.bytes = bytes; self.kind = kind
        self.name = name; self.duration = duration; self.peaks = peaks
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sha = c.v(.sha, "")
        mime = c.v(.mime, "image/jpeg")
        width = c.v(.width, 0)
        height = c.v(.height, 0)
        bytes = c.v(.bytes, 0)
        kind = c.v(.kind, "photo")
        name = c.opt(.name)
        duration = c.opt(.duration)
        peaks = c.v(.peaks, [])
    }

    /// The name to show: the asset's name, else a short sha.
    public var displayName: String { (name?.isEmpty == false ? name : nil) ?? String(sha.prefix(8)) }
}

// MARK: - REST results

public struct ServerInfo: Codable, Sendable, Hashable {
    public var name: String
    public var version: String
    public var port: Int
    public var hostname: String
    public var pairingRequired: Bool

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.v(.name, "projmap")
        version = c.v(.version, "")
        port = c.v(.port, 7400)
        hostname = c.v(.hostname, "")
        pairingRequired = c.v(.pairingRequired, true)
    }
}

public struct PairResult: Codable, Sendable, Hashable {
    public var token: String
    public var device: Device
}

/// `calib:{id}` progress: `{ step, done, total, message }`.
public struct CalibrationProgress: Codable, Sendable, Hashable {
    public var step: String
    public var done: Int
    public var total: Int
    public var message: String

    public init(step: String, done: Int, total: Int, message: String) {
        self.step = step; self.done = done; self.total = total; self.message = message
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        step = c.v(.step, "")
        done = c.v(.done, 0)
        total = c.v(.total, 0)
        message = c.v(.message, "")
    }

    public var fraction: Double { total > 0 ? min(1, Double(done) / Double(total)) : 0 }
}

/// `GET /calibrations/{id}` (protocol §9 backend), plus the candidates of `GET /calibrations/{id}/candidates` in
/// `objects`, normalised to 0…1 of the camera frame.
public struct CalibrationResult: Codable, Sendable, Hashable {
    public struct Quality: Codable, Sendable, Hashable {
        public var coverage: Double
        public var errorPx: Double
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            coverage = c.v(.coverage, 0)
            errorPx = c.v(.errorPx, 0)
        }
    }

    public struct Pt: Codable, Sendable, Hashable {
        public var x: Double
        public var y: Double
    }

    /// A planar surface (or a named object) found in the camera view.
    public struct Candidate: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var kind: String
        public var faces: Int
        public var confidence: Double
        public var areaCamPx: Double
        /// Outline in camera pixels (`camera`), clockwise.
        public var camera: [Pt]
        /// Outline in camera-view fractions (0…1), clockwise.
        public var outline: [[Double]]

        public init(id: String, name: String, faces: Int, outline: [[Double]]) {
            self.id = id; self.name = name; self.kind = "poly"; self.faces = faces; self.confidence = 1; self.areaCamPx = 0
            self.camera = []; self.outline = outline
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            kind = c.v(.kind, "poly")
            id = c.v(.id, UUID().uuidString)
            name = c.v(.name, "")
            faces = c.v(.faces, 1)
            confidence = c.v(.confidence, 1)
            areaCamPx = c.v(.areaCamPx, 0)
            camera = c.v(.camera, [])
            outline = c.v(.outline, [])
        }

        /// Fills `outline` from `camera` for a frame of `width × height` camera pixels.
        public mutating func normalise(width: Double, height: Double) {
            guard outline.isEmpty, width > 0, height > 0 else { return }
            outline = camera.map { [$0.x / width, $0.y / height] }
        }
    }

    public var id: String
    /// `running` | `done` | `failed`
    public var status: String
    public var message: String
    public var quality: Quality?
    public var cameraWidth: Double
    public var cameraHeight: Double
    public var objects: [Candidate]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        status = c.v(.status, "")
        message = c.v(.message, "")
        quality = c.opt(.quality)
        cameraWidth = c.v(.cameraWidth, 0)
        cameraHeight = c.v(.cameraHeight, 0)
        objects = c.v(.objects, [])
    }

    /// Adds candidates (largest first, named "surface 1…" when the server gives no name).
    public mutating func attach(_ candidates: [Candidate]) {
        var list = candidates.sorted { $0.areaCamPx > $1.areaCamPx }
        for i in list.indices {
            list[i].normalise(width: cameraWidth, height: cameraHeight)
            if list[i].name.isEmpty { list[i].name = "surface \(i + 1)" }
        }
        objects = list
    }
}

public struct IDResult: Codable, Sendable, Hashable {
    public var id: String
}

public struct VersionResult: Codable, Sendable, Hashable {
    public var version: Int
}

public struct ShaResult: Codable, Sendable, Hashable {
    public var sha: String
}
