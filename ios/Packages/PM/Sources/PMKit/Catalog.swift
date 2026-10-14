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

public struct GoboItem: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var description: String
    public var category: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        description = c.v(.description, "")
        category = c.v(.category, "shadows")
    }
}

public struct ProceduralItem: Decodable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var category: String
    public var animated: Bool
    public var params: ParamList

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        category = c.v(.category, "")
        animated = c.v(.animated, false)
        params = c.v(.params, ParamList())
    }

    enum CodingKeys: String, CodingKey { case id, name, category, animated, params }

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
    }

    enum CodingKeys: String, CodingKey { case version, light, gobos, procedural, gradients, gradientParams, scenery, photoParams, videoParams, effects }

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
        return cat
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
        var o: JSONObject = ["blur": 0.2, "brightness": 0.8, "warmth": 0, "drift": 0, "start": 0, "end": 0, "audio": false, "volume": 1]
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
