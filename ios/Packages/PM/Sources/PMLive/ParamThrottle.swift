import Foundation
import PMKit

/// Rate limit for drags: at most one `param` per path every `interval` (60 Hz), and the last value of a burst is
/// always sent (trailing edge), so the wall ends exactly where the finger stopped.
public struct ParamThrottle: Sendable {
    public struct Out: Sendable, Equatable {
        public var channel: String
        public var path: String
        public var value: JSONValue
    }

    struct Key: Hashable { var channel: String; var path: String }

    public let interval: Double
    private var lastSent: [Key: Double] = [:]
    private var pending: [Key: JSONValue] = [:]

    /// Timers and display frames land a hair early; a millisecond of slack keeps a 120 Hz drag at 60 Hz, not 40.
    static let slack = 0.001

    public init(hz: Double = 60) { interval = 1 / hz }

    /// A new value at `now` (seconds). Returns what to send right away.
    public mutating func submit(channel: String, path: String, value: JSONValue, now: Double) -> [Out] {
        let k = Key(channel: channel, path: path)
        if let last = lastSent[k], now - last < interval - Self.slack {
            pending[k] = value
            return []
        }
        lastSent[k] = now
        pending[k] = nil
        return [Out(channel: channel, path: path, value: value)]
    }

    /// Values held back whose slot has come.
    public mutating func due(now: Double) -> [Out] {
        var out: [Out] = []
        for (k, v) in pending where now - (lastSent[k] ?? 0) >= interval - Self.slack {
            out.append(Out(channel: k.channel, path: k.path, value: v))
            lastSent[k] = now
            pending[k] = nil
        }
        return out.sorted { ($0.channel, $0.path) < ($1.channel, $1.path) }
    }

    /// When the next held value is due, or nil when nothing waits.
    public func nextDeadline() -> Double? {
        pending.keys.map { (lastSent[$0] ?? 0) + interval }.min()
    }

    public var hasPending: Bool { !pending.isEmpty }

    /// Forget held values (the connection dropped: never replay an old drag later).
    public mutating func drop() { pending = [:] }
}
