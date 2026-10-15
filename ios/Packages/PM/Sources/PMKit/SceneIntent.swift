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

    // Protocol §15: the stack light and its attachments (`static` and `live`).
    public static func stackLight(_ mode: String, _ field: String...) -> String { stack(mode) + "/light" + field.map { "/" + JSONPointer.escape($0) }.joined() }
    public static func attachments(_ mode: String) -> String { stack(mode) + "/attachments" }
    public static func attachment(_ mode: String, _ i: Int, _ field: String...) -> String {
        attachments(mode) + "/\(i)" + field.map { "/" + JSONPointer.escape($0) }.joined()
    }
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
    /// Soundboard pads (protocol §14): a new pad at the end of the grid, a field of a pad (by id), removal.
    case addPad(JSONValue)
    case setPadField(padId: String, field: [String], value: JSONValue)
    case removePad(padId: String)
    /// Protocol §15. Replaces the attachments of `mode` (`static` or `live`): the "one attachment" pick.
    case replaceAttachments(mode: String, attachments: JSONValue)
    /// Adds an attachment on top (masks multiply).
    case addAttachment(mode: String, attachment: JSONValue)
    /// Sets `field` of the attachment with `attachmentId` (in whichever light stack holds it).
    case setAttachmentField(attachmentId: String, field: [String], value: JSONValue)
    case removeAttachment(attachmentId: String)
    /// Sets `field` of the stack light of `mode` (creates the default light first when the stack has none).
    case setLight(mode: String, field: [String], value: JSONValue)
    /// A raw op list for edits that have no intent yet; resent as is.
    case raw([PatchOp])

    /// The stack and index of a layer id, searching every stack.
    public static func locate(_ doc: JSONValue, _ id: String) -> (mode: String, index: Int)? {
        for mode in SceneMode.backdrops {
            if let i = doc.value(at: ScenePath.layers(mode))?.array?.firstIndex(where: { $0["id"]?.string == id }) { return (mode, i) }
        }
        return nil
    }

    /// The stack and index of an attachment id (`static` or `live`).
    public static func locateAttachment(_ doc: JSONValue, _ id: String) -> (mode: String, index: Int)? {
        for mode in ["static", "live"] {
            if let i = doc.value(at: ScenePath.attachments(mode))?.array?.firstIndex(where: { $0["id"]?.string == id }) { return (mode, i) }
        }
        return nil
    }

    /// Ops that set `field` below `base`, creating missing (or null) parent objects.
    static func setField(_ doc: JSONValue, base: String, _ field: [String], _ value: JSONValue) -> [PatchOp] {
        var path = base
        var ops: [PatchOp] = []
        for (n, token) in field.enumerated() {
            path += "/" + JSONPointer.escape(token)
            if n < field.count - 1, doc.value(at: path) == nil || doc.value(at: path) == .null {
                ops.append(doc.value(at: path) == nil ? .add(path, [:]) : .replace(path, [:]))
            }
        }
        ops.append(doc.value(at: path) == nil ? .add(path, value) : .replace(path, value))
        return ops
    }

    /// The index of a pad id in `/sounds/pads`.
    public static func locatePad(_ doc: JSONValue, _ id: String) -> Int? {
        doc.value(at: "/sounds/pads")?.array?.firstIndex { $0["id"]?.string == id }
    }

    /// Ops that create `/backdrop` and `/backdrop/<mode>` when a document lacks them.
    static func ensureStack(_ doc: JSONValue, _ mode: String) -> [PatchOp] {
        var ops: [PatchOp] = []
        if doc.value(at: "/backdrop")?.object == nil { ops.append(doc["backdrop"] == nil ? .add("/backdrop", [:]) : .replace("/backdrop", [:])) }
        if doc.value(at: ScenePath.stack(mode))?.object == nil {
            ops.append(doc.value(at: ScenePath.stack(mode)) == nil ? .add(ScenePath.stack(mode), ["layers": []]) : .replace(ScenePath.stack(mode), ["layers": []]))
        } else if doc.value(at: ScenePath.layers(mode))?.array == nil { ops.append(.add(ScenePath.layers(mode), [])) }
        return ops
    }

    /// The ops for this intent on `doc`, or nil when it no longer applies (the layer is gone).
    public func ops(on doc: JSONValue) -> [PatchOp]? {
        switch self {
        case .setLayerField(let id, let field, let value):
            guard let (mode, i) = Self.locate(doc, id) else { return nil }
            // Creates missing parents (a layer without `light` gets one when its light is set).
            return Self.setField(doc, base: ScenePath.layer(mode, i), field, value)
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
        case .addPad(let pad):
            if doc.value(at: "/sounds")?.object == nil {
                return [doc["sounds"] == nil ? .add("/sounds", ["pads": [pad]]) : .replace("/sounds", ["pads": [pad]])]
            }
            if doc.value(at: "/sounds/pads")?.array == nil {
                return [doc.value(at: "/sounds/pads") == nil ? .add("/sounds/pads", [pad]) : .replace("/sounds/pads", [pad])]
            }
            return [.add("/sounds/pads/-", pad)]
        case .setPadField(let id, let field, let value):
            guard let i = Self.locatePad(doc, id), !field.isEmpty else { return nil }
            let path = "/sounds/pads/\(i)" + field.map { "/" + JSONPointer.escape($0) }.joined()
            return [doc.value(at: path) == nil ? .add(path, value) : .replace(path, value)]
        case .removePad(let id):
            guard let i = Self.locatePad(doc, id) else { return nil }
            return [.remove("/sounds/pads/\(i)")]
        case .replaceAttachments(let mode, let list):
            let pre = Self.ensureStack(doc, mode)
            return pre + [doc.value(at: ScenePath.attachments(mode)) == nil ? .add(ScenePath.attachments(mode), list) : .replace(ScenePath.attachments(mode), list)]
        case .addAttachment(let mode, let a):
            let pre = Self.ensureStack(doc, mode)
            if doc.value(at: ScenePath.attachments(mode))?.array == nil {
                return pre + [doc.value(at: ScenePath.attachments(mode)) == nil ? .add(ScenePath.attachments(mode), [a]) : .replace(ScenePath.attachments(mode), [a])]
            }
            return pre + [.add(ScenePath.attachments(mode) + "/-", a)]
        case .setAttachmentField(let id, let field, let value):
            guard let (mode, i) = Self.locateAttachment(doc, id), !field.isEmpty else { return nil }
            return Self.setField(doc, base: ScenePath.attachment(mode, i), field, value)
        case .removeAttachment(let id):
            guard let (mode, i) = Self.locateAttachment(doc, id) else { return nil }
            return [.remove(ScenePath.attachment(mode, i))]
        case .setLight(let mode, let field, let value):
            guard !field.isEmpty else { return nil }
            var pre = Self.ensureStack(doc, mode)
            let lightPath = ScenePath.stackLight(mode)
            var base = doc
            if doc.value(at: lightPath)?.object == nil {
                let fresh = (try? JSONValue(encoding: StackLight())) ?? [:]
                pre.append(doc.value(at: lightPath) == nil ? .add(lightPath, fresh) : .replace(lightPath, fresh))
            }
            guard let next = try? doc.applying(pre) else { return nil }
            base = next
            return pre + Self.setField(base, base: lightPath, field, value)
        case .raw(let ops):
            return ops
        }
    }
}
