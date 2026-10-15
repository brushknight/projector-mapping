import Foundation

/// (protocol §19) The mapped objects drawn over a backdrop mode: each object's outer silhouette as a sharp line with a
/// glow, and an optional fill (`light` adds a soft light inside, `cut` blocks the backdrop inside, `only` shows the
/// backdrop only inside). One per scene, used in every backdrop mode; absent is off.
public struct ObjectAccent: Codable, Sendable, Hashable {
    public struct Outline: Codable, Sendable, Hashable {
        public var on: Bool
        /// scene px, 0…64
        public var width: Double
        /// #rrggbb
        public var color: String
        /// 0…1
        public var glow: Double
        public init(on: Bool = true, width: Double = 3, color: String = "#ffffff", glow: Double = 0.3) {
            self.on = on; self.width = width; self.color = color; self.glow = glow
        }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            on = c.v(.on, true); width = c.v(.width, 3); color = c.v(.color, "#ffffff"); glow = c.v(.glow, 0.3)
        }
    }

    public struct Fill: Codable, Sendable, Hashable {
        public var on: Bool
        /// 0…1
        public var opacity: Double
        /// `light` | `cut` | `only`
        public var mode: String
        public static let modes = ["light", "cut", "only"]
        public init(on: Bool = false, opacity: Double = 0.5, mode: String = "cut") { self.on = on; self.opacity = opacity; self.mode = mode }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            on = c.v(.on, false); opacity = c.v(.opacity, 0.5); mode = c.v(.mode, "cut")
        }
    }

    public var on: Bool
    /// nil is "all"; otherwise the accented object ids.
    public var objectIds: [String]?
    public var outline: Outline
    public var fill: Fill

    public init(on: Bool = false, objectIds: [String]? = nil, outline: Outline = Outline(), fill: Fill = Fill()) {
        self.on = on; self.objectIds = objectIds; self.outline = outline; self.fill = fill
    }

    enum CodingKeys: String, CodingKey { case on, objects, outline, fill }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        on = c.v(.on, false)
        objectIds = (try? c.decode([String].self, forKey: .objects)) ?? nil
        outline = c.v(.outline, Outline())
        fill = c.v(.fill, Fill())
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(on, forKey: .on)
        if let objectIds { try c.encode(objectIds, forKey: .objects) } else { try c.encode("all", forKey: .objects) }
        try c.encode(outline, forKey: .outline)
        try c.encode(fill, forKey: .fill)
    }
}
