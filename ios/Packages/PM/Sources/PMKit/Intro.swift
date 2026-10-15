import Foundation

/// (protocol §20 "Step 0") The scene's opening step: the opening look (a backdrop mode, optionally a preset of it)
/// holds on the wall until GO, which converges onto the object or crossfades (or cuts) into the mapping. Absent is
/// none; `show.sequence.start` makes one from the backdrop on air.
public struct Intro: Codable, Sendable, Hashable {
    public struct Source: Codable, Sendable, Hashable {
        /// `static` | `live` | `color` | `scenery`
        public var mode: String
        public var presetId: String?
        enum CodingKeys: String, CodingKey { case mode, presetId }
        public init(mode: String = "static", presetId: String? = nil) { self.mode = mode; self.presetId = presetId }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            mode = c.v(.mode, "static"); presetId = c.opt(.presetId)
        }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(mode, forKey: .mode)
            if let presetId { try c.encode(presetId, forKey: .presetId) } else { try c.encodeNil(forKey: .presetId) }
        }
    }

    public var on: Bool
    public var source: Source
    public var converge: Bool
    /// seconds, 0.1…60
    public var convergeDuration: Double
    /// `current` | `circle` | `frame`
    public var from: String
    /// `inOut` | `in` | `out` | `linear`
    public var ease: String
    /// `fade` | `cut`
    public var transition: String
    /// 0…10000
    public var transitionMs: Double

    public static let froms = ["current", "circle", "frame"]

    public init(on: Bool = true, source: Source = .init(), converge: Bool = true, convergeDuration: Double = 2, from: String = "current",
                ease: String = "inOut", transition: String = "fade", transitionMs: Double = 600) {
        self.on = on; self.source = source; self.converge = converge; self.convergeDuration = convergeDuration
        self.from = from; self.ease = ease; self.transition = transition; self.transitionMs = transitionMs
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        on = c.v(.on, false); source = c.v(.source, Source()); converge = c.v(.converge, true)
        convergeDuration = c.v(.convergeDuration, 2); from = c.v(.from, "current"); ease = c.v(.ease, "inOut")
        transition = c.v(.transition, "fade"); transitionMs = c.v(.transitionMs, 600)
    }
}
