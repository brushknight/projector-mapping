import Foundation

/// JSON Pointers into a scene document. Layers live in one stack per backdrop mode: `/backdrop/<mode>/layers`.
public enum ScenePath {
    public static let mode = "/mode"
    public static func stack(_ mode: String) -> String { "/backdrop/\(JSONPointer.escape(mode))" }
    public static func layers(_ mode: String) -> String { stack(mode) + "/layers" }
    public static func layer(_ mode: String, _ i: Int) -> String { layers(mode) + "/\(i)" }
    public static func layer(_ mode: String, _ i: Int, _ field: String...) -> String { layer(mode, i) + field.map { "/" + JSONPointer.escape($0) }.joined() }
    public static func light(_ mode: String, _ i: Int, _ field: String...) -> String { layer(mode, i) + "/light" + field.map { "/" + JSONPointer.escape($0) }.joined() }
    public static func param(_ mode: String, _ i: Int, _ key: String) -> String { layer(mode, i) + "/params/\(JSONPointer.escape(key))" }
}

/// A structural edit as an intent, so the outbox can turn it into ops again on a newer document after a stale
/// rejection (layer ids, not indices, survive other people's edits).
public enum SceneIntent: Codable, Sendable, Hashable {
    /// Sets `field` (a path inside the layer, e.g. `["visible"]`, `["params", "stops"]`) of the layer with `layerId`
    /// (in whichever stack holds it).
    case setLayerField(layerId: String, field: [String], value: JSONValue)
    /// Inserts a layer into `mode`'s stack at `index` (bottom = 0), or on top when nil.
    case addLayer(mode: String, layer: JSONValue, index: Int?)
    case removeLayer(layerId: String)
    /// Moves a layer to `to` inside its own stack.
    case moveLayer(layerId: String, to: Int)
    /// Replaces a whole stack (single-choice picks: one gobo, one gradient, one photo).
    case replaceStack(mode: String, layers: JSONValue)
    /// Puts `mode` on air (`replace /mode`).
    case setMode(String)
    /// A preset: replaces `backdrop[mode]` with its stack and switches to that mode.
    case applyPreset(mode: String, backdrop: JSONValue)
    case setObjectVisible(objectId: String, visible: Bool)
    /// A raw op list for edits that have no intent yet; resent as is.
    case raw([PatchOp])

    /// The stack and index of a layer id, searching every stack.
    public static func locate(_ doc: JSONValue, _ id: String) -> (mode: String, index: Int)? {
        for mode in SceneMode.backdrops {
            if let i = doc.value(at: ScenePath.layers(mode))?.array?.firstIndex(where: { $0["id"]?.string == id }) { return (mode, i) }
        }
        return nil
    }

    /// Ops that create `/backdrop` and `/backdrop/<mode>` when a document lacks them.
    static func ensureStack(_ doc: JSONValue, _ mode: String) -> [PatchOp] {
        var ops: [PatchOp] = []
        if doc.value(at: "/backdrop")?.object == nil { ops.append(doc["backdrop"] == nil ? .add("/backdrop", [:]) : .replace("/backdrop", [:])) }
        if doc.value(at: ScenePath.stack(mode))?.object == nil { ops.append(.add(ScenePath.stack(mode), ["layers": []])) }
        else if doc.value(at: ScenePath.layers(mode))?.array == nil { ops.append(.add(ScenePath.layers(mode), [])) }
        return ops
    }

    /// The ops for this intent on `doc`, or nil when it no longer applies (the layer is gone).
    public func ops(on doc: JSONValue) -> [PatchOp]? {
        switch self {
        case .setLayerField(let id, let field, let value):
            guard let (mode, i) = Self.locate(doc, id) else { return nil }
            var path = ScenePath.layer(mode, i)
            var ops: [PatchOp] = []
            // Create missing parents (a layer without `light` gets one when its light is set).
            for (n, token) in field.enumerated() {
                path += "/" + JSONPointer.escape(token)
                if n < field.count - 1, doc.value(at: path) == nil || doc.value(at: path) == .null {
                    ops.append(.add(path, [:]))
                }
            }
            ops.append(doc.value(at: path) == nil ? .add(path, value) : .replace(path, value))
            return ops
        case .addLayer(let mode, let layer, let index):
            let pre = Self.ensureStack(doc, mode)
            let count = doc.value(at: ScenePath.layers(mode))?.array?.count ?? 0
            if let index, index < count { return pre + [.add(ScenePath.layer(mode, Swift.max(0, index)), layer)] }
            return pre + [.add(ScenePath.layers(mode) + "/-", layer)]
        case .removeLayer(let id):
            guard let (mode, i) = Self.locate(doc, id) else { return nil }
            return [.remove(ScenePath.layer(mode, i))]
        case .moveLayer(let id, let to):
            guard let (mode, i) = Self.locate(doc, id) else { return nil }
            let count = doc.value(at: ScenePath.layers(mode))?.array?.count ?? 0
            let target = Swift.min(Swift.max(0, to), count - 1)
            if target == i { return [] }
            return [.move(from: ScenePath.layer(mode, i), to: ScenePath.layer(mode, target))]
        case .replaceStack(let mode, let layers):
            let pre = Self.ensureStack(doc, mode)
            return pre + [.replace(ScenePath.layers(mode), layers)]
        case .setMode(let mode):
            if doc["mode"]?.string == mode { return [] }
            return [doc["mode"] == nil ? .add(ScenePath.mode, .string(mode)) : .replace(ScenePath.mode, .string(mode))]
        case .applyPreset(let mode, let backdrop):
            var ops: [PatchOp] = []
            if doc.value(at: "/backdrop")?.object == nil { ops.append(doc["backdrop"] == nil ? .add("/backdrop", [:]) : .replace("/backdrop", [:])) }
            ops.append(doc.value(at: ScenePath.stack(mode)) == nil ? .add(ScenePath.stack(mode), backdrop) : .replace(ScenePath.stack(mode), backdrop))
            ops.append(doc["mode"] == nil ? .add(ScenePath.mode, .string(mode)) : .replace(ScenePath.mode, .string(mode)))
            return ops
        case .setObjectVisible(let id, let visible):
            guard let i = doc.value(at: "/objects")?.array?.firstIndex(where: { $0["id"]?.string == id }) else { return nil }
            return [.replace("/objects/\(i)/visible", .bool(visible))]
        case .raw(let ops):
            return ops
        }
    }
}
