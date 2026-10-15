import Foundation

/// One param of a catalog item: `{type: number|integer|boolean|color|enum|string, min?, max?, step?, default, label?, unit?, options?}`.
public struct ParamSpec: Codable, Sendable, Hashable {
    public var type: String
    public var min: Double?
    public var max: Double?
    public var step: Double?
    public var `default`: JSONValue?
    public var label: String?
    public var unit: String?
    public var options: [String]?

    public init(type: String, min: Double? = nil, max: Double? = nil, step: Double? = nil, default: JSONValue? = nil,
                label: String? = nil, unit: String? = nil, options: [String]? = nil) {
        self.type = type; self.min = min; self.max = max; self.step = step; self.default = `default`
        self.label = label; self.unit = unit; self.options = options
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = c.v(.type, "number")
        min = c.opt(.min)
        max = c.opt(.max)
        step = c.opt(.step)
        self.default = c.opt(.default)
        label = c.opt(.label)
        unit = c.opt(.unit)
        options = c.opt(.options)
    }

    public var isNumeric: Bool { type == "number" || type == "integer" }
    public var lower: Double { min ?? 0 }
    public var upper: Double { max ?? 1 }

    /// 0…1 position of `value` in this param's range.
    public func fraction(_ value: Double) -> Double {
        let span = upper - lower
        return span > 0 ? Swift.min(1, Swift.max(0, (value - lower) / span)) : 0
    }

    /// The value at a 0…1 position, rounded for integers.
    public func value(at fraction: Double) -> Double {
        let v = lower + (upper - lower) * Swift.min(1, Swift.max(0, fraction))
        return type == "integer" ? v.rounded() : v
    }
}

public struct NamedParam: Sendable, Hashable, Identifiable {
    public var key: String
    public var spec: ParamSpec
    public var id: String { key }
}

/// Params in the order the catalog lists them (a JSON object's key order matters for the controls).
public struct ParamList: Decodable, Sendable, Hashable {
    public var items: [NamedParam]

    public init(_ items: [NamedParam] = []) { self.items = items }

    public init(from decoder: Decoder) throws {
        let dict = (try? decoder.singleValueContainer().decode([String: ParamSpec].self)) ?? [:]
        items = dict.keys.sorted().map { NamedParam(key: $0, spec: dict[$0]!) }
    }

    public subscript(key: String) -> ParamSpec? { items.first { $0.key == key }?.spec }

    mutating func order(by keys: [String]?) {
        guard let keys else { return }
        let rank = Dictionary(keys.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        items.sort { (rank[$0.key] ?? .max, $0.key) < (rank[$1.key] ?? .max, $1.key) }
    }
}

public struct CCTPreset: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var kelvin: Double
}

public struct LightCatalog: Decodable, Sendable, Hashable {
    public var params: ParamList
    public var fx: [String]
    public var cctPresets: [CCTPreset]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        params = c.v(.params, ParamList())
        fx = c.v(.fx, ["none"])
        cctPresets = c.v(.cctPresets, [])
    }

    enum CodingKeys: String, CodingKey { case params, fx, cctPresets }
}

/// A catalog gobo (an attachment's shape, protocol §15 catalog v4; since catalog 6 every gobo is a metal plate, §16).
public struct GoboItem: Decodable, Sendable, Hashable, Identifiable {
    public struct Start: Decodable, Sendable, Hashable {
        public var scale: Double
        public var rotation: Double
        public init(scale: Double = 1, rotation: Double = 0) { self.scale = scale; self.rotation = rotation }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            scale = c.v(.scale, 1)
            rotation = c.v(.rotation, 0)
        }
        enum CodingKeys: String, CodingKey { case scale, rotation }
    }

    public var id: String
    public var name: String
    public var description: String
    /// Catalog 6: `windows` | `nature` | `sky` | `patterns` | `beams` (older catalogs say other things; see `browseCategory`).
    public var category: String
    /// (catalog 6, §16) `window` for a parametric window preset: its params hold the window geometry, the preset values
    /// as defaults. Nil for every other plate.
    public var family: String?
    /// Relative to `/catalog/assets/`, e.g. `thumbs/window-4.png`.
    public var thumb: String?
    /// (catalog 5 to 7) the metal plate itself; catalog 8 dropped it (decoded for older catalogs, unused).
    public var metalThumb: String?
    /// (catalog 5, plates) the real plate the design follows.
    public var source: String?
    /// The gobo's own shape params (panes, slats…).
    public var params: ParamList
    /// Scale and rotation a new attachment of this gobo starts with.
    public var attachment: Start
    /// The focus that suits it (nil in v3).
    public var focus: Double?
    /// Overrides of the `goboParams` defaults.
    public var defaults: JSONObject

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        description = c.v(.description, "")
        category = c.v(.category, "shadows")
        thumb = c.opt(.thumb)
        metalThumb = c.opt(.metalThumb)
        source = c.opt(.source)
        family = c.opt(.family)
        params = c.v(.params, ParamList())
        attachment = c.v(.attachment, Start())
        focus = c.opt(.focus)
        defaults = c.v(.defaults, [:])
    }

    enum CodingKeys: String, CodingKey { case id, name, description, category, thumb, metalThumb, source, family, params, attachment, focus, defaults }

    /// (§16) A parametric window preset.
    public var isWindow: Bool { family == "window" }

    /// The browser category: the catalog's own, or a guess for a v3 catalog.
    public var browseCategory: String {
        if GoboCategory.known.contains(category) || GoboCategory.v6.contains(category) { return category }
        switch id {
        case let i where i.contains("blind") || i.contains("shutters"): return "blinds"
        case let i where i.contains("window") || i == "arch": return "windows"
        case let i where i.contains("tree") || i.contains("palm") || i.contains("leaf") || i.contains("leaves"): return "nature"
        case let i where i.hasPrefix("spot") || i == "iris" || i == "oval": return "spots"
        default: return "patterns"
        }
    }
}

public struct GoboCategory: Decodable, Sendable, Hashable, Identifiable {
    public static let known = ["windows", "blinds", "nature", "patterns", "spots", "plates"]
    /// Catalog 6 (§16): every gobo is a plate, grouped like this.
    public static let v6 = ["windows", "nature", "sky", "patterns", "beams"]
    public var id: String
    public var name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
    }
    enum CodingKeys: String, CodingKey { case id, name }
}

/// (catalog 6, §16) One group of a parametric window's geometry params, in display order.
public struct WindowParamGroup: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var params: [String]
    public init(id: String, name: String, params: [String]) { self.id = id; self.name = name; self.params = params }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, c.v(.id, ""))
        params = c.v(.params, [])
    }
    enum CodingKeys: String, CodingKey { case id, name, params }
}

/// `stackLight`: ranges for the light and attachment controls.
public struct StackLightCatalog: Decodable, Sendable, Hashable {
    public var params: ParamList
    public var kelvin: Double
    public var attachmentParams: ParamList

    public init(params: ParamList = ParamList(), kelvin: Double = 5600, attachmentParams: ParamList = ParamList()) {
        self.params = params; self.kelvin = kelvin; self.attachmentParams = attachmentParams
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        params = c.v(.params, ParamList())
        kelvin = c.v(.kelvin, 5600)
        attachmentParams = c.v(.attachmentParams, ParamList())
    }

    enum CodingKeys: String, CodingKey { case params, kelvin, attachmentParams }
}

/// An animated colour (`colorGenerators`), for a light's colour layer and the `generator` layer kind.
public struct ColorGeneratorItem: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var description: String
    public var animated: Bool
    public var params: ParamList

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        description = c.v(.description, "")
        animated = c.v(.animated, true)
        params = c.v(.params, ParamList())
    }

    enum CodingKeys: String, CodingKey { case id, name, description, animated, params }
}

/// A motion preset chip: the exact Motion it writes (the client sets `startedAt`).
public struct MotionPreset: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var description: String
    public var motion: Motion

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        description = c.v(.description, "")
        motion = c.v(.motion, Motion())
    }

    enum CodingKeys: String, CodingKey { case id, name, description, motion }
}

public struct SceneKindItem: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var mode: String
    public var description: String

    public init(id: String, name: String, mode: String, description: String = "") {
        self.id = id; self.name = name; self.mode = mode; self.description = description
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        mode = c.v(.mode, SceneKind.mode(c.v(.id, "")))
        description = c.v(.description, "")
    }

    enum CodingKeys: String, CodingKey { case id, name, mode, description }
}

public struct SceneTemplate: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var kind: String
    public var name: String
    public var description: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        kind = c.v(.kind, "static")
        name = c.v(.name, "")
        description = c.v(.description, "")
    }

    enum CodingKeys: String, CodingKey { case id, kind, name, description }
}

public struct ProceduralItem: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var category: String
    public var animated: Bool
    public var params: ParamList
    /// Relative to `/catalog/assets/` (catalog v4).
    public var thumb: String?
    /// (catalog 6, §16) a vertical JPEG strip of `animFrames` frames (192 × 108 each) that loops, relative to
    /// `/catalog/assets/`, e.g. `thumbs/tree-sway-anim.jpg`. Nil until rendered.
    public var animThumb: String?
    public var animFrames: Int?
    public var animFps: Double?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        category = c.v(.category, "")
        animated = c.v(.animated, false)
        params = c.v(.params, ParamList())
        thumb = c.opt(.thumb)
        animThumb = c.opt(.animThumb)
        animFrames = c.opt(.animFrames)
        animFps = c.opt(.animFps)
    }

    enum CodingKeys: String, CodingKey { case id, name, category, animated, params, thumb, animThumb, animFrames, animFps }

    /// (§16) Shadow layers (nature, weather, texture) block light like an attachment: they join the mask (multiply).
    public var isShadow: Bool { ["nature", "weather", "texture"].contains(category) }

    /// The params' defaults as a layer `params` object.
    public var defaults: JSONObject {
        var o = JSONObject()
        for p in params.items { if let d = p.spec.default { o[p.key] = d } }
        return o
    }
}

public struct GradientStop: Codable, Sendable, Hashable {
    public var color: String
    public var pos: Double
    public init(color: String, pos: Double) { self.color = color; self.pos = pos }
}

public struct GradientItem: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var defaults: JSONObject

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        defaults = c.v(.defaults, [:])
    }

    enum CodingKeys: String, CodingKey { case id, name, defaults }

    public var stops: [GradientStop] { (try? defaults["stops"]?.decode([GradientStop].self)) ?? [] }
    public var angle: Double { defaults["angle"]?.double ?? 135 }
}

public struct SceneryItem: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var category: String
    /// Path under `/catalog/assets/`, e.g. `scenery/flowers.jpg`.
    public var asset: String
    public var credit: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        category = c.v(.category, "nature")
        asset = c.v(.asset, "")
        credit = c.v(.credit, "")
    }
}

/// `contract/catalog.json` + `{ version }`. Decode it with `Catalog.decode(_:)` so param order survives.
public struct Catalog: Decodable, Sendable, Hashable {
    public var version: Int
    public var light: LightCatalog?
    public var gobos: [GoboItem]
    public var procedural: [ProceduralItem]
    public var gradients: [GradientItem]
    public var gradientParams: ParamList
    public var scenery: [SceneryItem]
    public var photoParams: ParamList
    /// Video layer params (catalog v3, protocol §14): the photo controls plus `start`, `end`, `audio`, `volume`.
    public var videoParams: ParamList
    public var effects: [Effect]
    // Catalog v4 (protocol §15).
    public var stackLight: StackLightCatalog
    public var goboParams: ParamList
    public var goboCategories: [GoboCategory]
    public var colorGenerators: [ColorGeneratorItem]
    public var motionPresets: [MotionPreset]
    public var motionEasings: [String]
    public var motionLoops: [String]
    public var sceneKinds: [SceneKindItem]
    public var sceneTemplates: [SceneTemplate]
    /// Catalog 6 (§16): the window geometry groups (empty in older catalogs).
    public var windowParamGroups: [WindowParamGroup]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.v(.version, 0)
        light = c.opt(.light)
        gobos = c.v(.gobos, [])
        procedural = c.v(.procedural, [])
        gradients = c.v(.gradients, [])
        gradientParams = c.v(.gradientParams, ParamList())
        scenery = c.v(.scenery, [])
        photoParams = c.v(.photoParams, ParamList())
        videoParams = c.v(.videoParams, ParamList())
        effects = c.v(.effects, [])
        stackLight = c.v(.stackLight, StackLightCatalog())
        goboParams = c.v(.goboParams, ParamList())
        let cats: [GoboCategory] = c.v(.goboCategories, [])
        goboCategories = cats.isEmpty ? GoboCategory.known.map { GoboCategory(id: $0, name: $0) } : cats
        colorGenerators = c.v(.colorGenerators, [])
        motionPresets = c.v(.motionPresets, [])
        motionEasings = c.v(.motionEasings, ["linear", "in", "out", "inOut", "sine"])
        motionLoops = c.v(.motionLoops, ["once", "loop", "pingpong"])
        let kinds: [SceneKindItem] = c.v(.sceneKinds, [])
        sceneKinds = kinds.isEmpty ? SceneKind.all.map { SceneKindItem(id: $0, name: $0, mode: SceneKind.mode($0)) } : kinds
        sceneTemplates = c.v(.sceneTemplates, [])
        windowParamGroups = c.v(.windowParamGroups, [])
    }

    enum CodingKeys: String, CodingKey {
        case version, light, gobos, procedural, gradients, gradientParams, scenery, photoParams, videoParams, effects
        case stackLight, goboParams, goboCategories, colorGenerators, motionPresets, motionEasings, motionLoops, sceneKinds, sceneTemplates
        case windowParamGroups
    }

    public static let empty = try! Catalog.decode(Data("{}".utf8))

    /// Decodes the catalog and keeps each param list in the order the JSON lists it.
    public static func decode(_ data: Data) throws -> Catalog {
        var cat = try JSONDecoder().decode(Catalog.self, from: data)
        let order = JSONKeyOrder.scan(data)
        cat.light?.params.order(by: order["/light/params"])
        for i in cat.procedural.indices { cat.procedural[i].params.order(by: order["/procedural/\(i)/params"]) }
        cat.gradientParams.order(by: order["/gradientParams"])
        cat.photoParams.order(by: order["/photoParams"])
        cat.videoParams.order(by: order["/videoParams"])
        cat.goboParams.order(by: order["/goboParams"])
        cat.stackLight.params.order(by: order["/stackLight/params"])
        cat.stackLight.attachmentParams.order(by: order["/stackLight/attachmentParams"])
        for i in cat.gobos.indices { cat.gobos[i].params.order(by: order["/gobos/\(i)/params"]) }
        for i in cat.colorGenerators.indices { cat.colorGenerators[i].params.order(by: order["/colorGenerators/\(i)/params"]) }
        return cat
    }

    public func colorGenerator(_ id: String) -> ColorGeneratorItem? { colorGenerators.first { $0.id == id } }
    public func motionPreset(_ id: String) -> MotionPreset? { motionPresets.first { $0.id == id } }

    /// Gobos of one browser category, in catalog order.
    public func gobos(in category: String) -> [GoboItem] { gobos.filter { $0.browseCategory == category } }

    /// The thumbnail id of a gobo or procedural item: `/catalog/thumbs/<id>.png`.
    public func thumbId(_ id: String) -> String {
        let path = gobo(id)?.thumb ?? procedural(id)?.thumb
        guard let path, path.hasPrefix("thumbs/"), path.hasSuffix(".png") else { return id }
        return String(path.dropFirst(7).dropLast(4))
    }

    /// (catalog 6) The animated strip of a procedural layer: its path under `/catalog/assets/`, frames and fps, or nil.
    public func animStrip(_ id: String) -> (path: String, frames: Int, fps: Double)? {
        guard let p = procedural(id), let path = p.animThumb, let n = p.animFrames, n > 0 else { return nil }
        return (path, n, p.animFps ?? 12)
    }

    /// (§16) A window preset's geometry params, grouped as `windowParamGroups` says (params that no group names go last in
    /// a group of their own). Empty for any other gobo.
    public func windowGroups(_ gobo: String) -> [(group: WindowParamGroup, params: [NamedParam])] {
        guard let item = self.gobo(gobo), item.isWindow else { return [] }
        var used = Set<String>(["field"])
        var out: [(group: WindowParamGroup, params: [NamedParam])] = []
        for g in windowParamGroups {
            let ps = g.params.compactMap { k in item.params[k].map { NamedParam(key: k, spec: $0) } }
            ps.forEach { used.insert($0.key) }
            if !ps.isEmpty { out.append((g, ps)) }
        }
        let rest = item.params.items.filter { !used.contains($0.key) }
        if !rest.isEmpty { out.append((WindowParamGroup(id: "more", name: "more", params: rest.map(\.key)), rest)) }
        return out
    }

    /// (§16) The window geometry keys of a gobo: the keys `windowParamGroups` lists (every own param but `field` in a
    /// catalog without groups). "Reset to preset" removes them; any of them in an attachment's params is a change.
    public func windowKeys(_ gobo: String) -> [String] {
        guard let item = self.gobo(gobo), item.isWindow else { return [] }
        let grouped = Set(windowParamGroups.flatMap(\.params))
        return item.params.items.map(\.key).filter { grouped.isEmpty ? $0 != "field" : grouped.contains($0) }
    }

    /// The params an attachment of `item` starts with: the gobo's own defaults, then `goboParams` defaults overridden
    /// by the item's `defaults` (§15).
    /// A window preset (§16) keeps its geometry out: missing window keys take the preset through the catalog defaults.
    public func attachmentParams(_ item: GoboItem) -> JSONObject {
        var o = Self.defaults(item.params)
        if item.isWindow { for k in windowKeys(item.id) { o[k] = nil } }
        for (k, v) in Self.defaults(goboParams) { o[k] = v }
        for (k, v) in item.defaults { o[k] = v }
        return o
    }

    /// A new attachment of `item` from the catalog defaults (id `att_<8 base36>`).
    public func newAttachment(_ item: GoboItem, id: String = ClientID.make("att")) -> Attachment {
        Attachment(id: id, gobo: item.id, name: item.name, rotation: item.attachment.rotation, scale: item.attachment.scale,
                   params: attachmentParams(item))
    }

    /// The params that shape an attachment: the gobo's own, then `throw`, `skew`, `depth`.
    public func shapeParams(_ gobo: String) -> [NamedParam] {
        let own = self.gobo(gobo)?.params.items ?? []
        let keys = Set(own.map(\.key))
        return own + goboParams.items.filter { !keys.contains($0.key) }
    }

    public func gobo(_ id: String) -> GoboItem? { gobos.first { $0.id == id } }
    public func procedural(_ id: String) -> ProceduralItem? { procedural.first { $0.id == id } }
    public func gradient(_ id: String) -> GradientItem? { gradients.first { $0.id == id } }
    public func scenery(_ id: String) -> SceneryItem? { scenery.first { $0.id == id } }

    /// Defaults of a param list as a layer `params` object.
    public static func defaults(_ list: ParamList) -> JSONObject {
        var o = JSONObject()
        for p in list.items { if let d = p.spec.default { o[p.key] = d } }
        return o
    }

    /// Video defaults (§14) when an older catalog has no `videoParams`.
    public var videoDefaults: JSONObject {
        var o: JSONObject = ["blur": 0.2, "brightness": 0.9, "warmth": 0, "drift": 0, "start": 0, "end": 0, "audio": false, "volume": 1]
        for (k, v) in Self.defaults(videoParams) { o[k] = v }
        return o
    }

    /// The param list that drives a layer's controls.
    public func params(for layer: Layer) -> ParamList {
        switch layer.kind {
        case "procedural": procedural(layer.ref)?.params ?? ParamList()
        case "gradient": gradientParams
        case "photo": photoParams
        case "video": videoParams
        case "generator": colorGenerator(layer.ref)?.params ?? ParamList()
        default: ParamList()
        }
    }
}

/// Records the key order of every JSON object in a document, keyed by its JSON Pointer.
public enum JSONKeyOrder {
    public static func scan(_ data: Data) -> [String: [String]] {
        var out: [String: [String]] = [:]
        let b = [UInt8](data)
        var i = 0

        func ws() { while i < b.count, b[i] == 0x20 || b[i] == 0x0A || b[i] == 0x0D || b[i] == 0x09 { i += 1 } }

        func string() -> String {
            let start = i
            i += 1
            while i < b.count, b[i] != 0x22 { i += b[i] == 0x5C ? 2 : 1 }
            i += 1
            let raw = Data(b[start..<min(i, b.count)])
            return (try? JSONDecoder().decode(String.self, from: raw)) ?? ""
        }

        func value(_ path: String) {
            ws()
            guard i < b.count else { return }
            switch b[i] {
            case 0x7B: // {
                i += 1
                var keys: [String] = []
                while true {
                    ws()
                    guard i < b.count else { break }
                    if b[i] == 0x7D { i += 1; break }
                    if b[i] == 0x2C { i += 1; continue }
                    let k = string()
                    ws()
                    if i < b.count, b[i] == 0x3A { i += 1 }
                    keys.append(k)
                    value(path + "/" + JSONPointer.escape(k))
                }
                out[path] = keys
            case 0x5B: // [
                i += 1
                var n = 0
                while true {
                    ws()
                    guard i < b.count else { break }
                    if b[i] == 0x5D { i += 1; break }
                    if b[i] == 0x2C { i += 1; continue }
                    value(path + "/\(n)")
                    n += 1
                }
            case 0x22:
                _ = string()
            default:
                while i < b.count, ![0x2C, 0x5D, 0x7D, 0x20, 0x0A, 0x0D, 0x09].contains(b[i]) { i += 1 }
            }
        }

        value("")
        return out
    }
}
