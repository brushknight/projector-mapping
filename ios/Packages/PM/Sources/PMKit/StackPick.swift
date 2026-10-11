import Foundation

/// The single-choice stacks (protocol §1 Scene): picking a gobo, a gradient or a photo replaces the whole stack with
/// one layer. These build that layer, keeping what the user set on the previous one.
public enum StackPick {
    /// A gobo layer for `static`: keeps the previous gobo's light, opacity and blend (default light when none).
    public static func gobo(id goboId: String, name: String, keeping old: Layer?, id: String) -> JSONValue {
        let light = (try? JSONValue(encoding: old?.light ?? Light())) ?? [:]
        return ["id": .string(old?.id ?? id), "kind": "gobo", "ref": .string(goboId), "name": .string(name), "visible": true,
                "opacity": .number(old?.opacity ?? 1), "blend": .string(old?.blend ?? "normal"), "light": light, "params": [:]]
    }

    public static func gobo(_ item: GoboItem, keeping old: Layer?, id: String) -> JSONValue {
        gobo(id: item.id, name: item.name, keeping: old, id: id)
    }

    /// A gradient layer for `color` with the catalog's defaults.
    public static func gradient(ref: String, name: String, defaults: JSONObject, keeping old: Layer?, id: String) -> JSONValue {
        ["id": .string(old?.id ?? id), "kind": "gradient", "ref": .string(ref), "name": .string(name), "visible": true,
         "opacity": .number(old?.opacity ?? 1), "blend": "normal", "light": nil, "params": .object(defaults)]
    }

    /// A photo layer for `scenery`: keeps blur, brightness, warmth and drift of the previous photo (catalog defaults
    /// fill the rest).
    public static func photo(ref: String, name: String, defaults: JSONObject, keeping old: Layer?, id: String) -> JSONValue {
        var params = defaults
        if let old, old.kind == "photo" { for (k, v) in old.params { params[k] = v } }
        return ["id": .string(old?.id ?? id), "kind": "photo", "ref": .string(ref), "name": .string(name), "visible": true,
                "opacity": .number(old?.opacity ?? 1), "blend": "normal", "light": nil, "params": .object(params)]
    }
}
