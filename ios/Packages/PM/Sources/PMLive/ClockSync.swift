import Foundation

/// Server clock estimate (protocol §3): the client sends `ping { t0 }` (its clock, ms), the server answers
/// `pong { t0, ts }` (server Unix ns). One sample's offset is `ts/1e6 − (t0 + rtt/2)`; the estimate is the median of
/// the last 8 samples.
public struct ClockSync: Sendable, Equatable {
    public struct Sample: Sendable, Equatable {
        public var offsetMs: Double
        public var rttMs: Double
    }

    public private(set) var samples: [Sample] = []
    public let window: Int

    public init(window: Int = 8) { self.window = window }

    /// One sample from a pong: `t0` sent (local ms), `t1` received (local ms), `serverNs` the server's reading.
    public static func sample(t0: Double, t1: Double, serverNs: Int64) -> Sample {
        let rtt = max(0, t1 - t0)
        return Sample(offsetMs: Double(serverNs) / 1e6 - (t0 + rtt / 2), rttMs: rtt)
    }

    public mutating func add(t0: Double, t1: Double, serverNs: Int64) {
        samples.append(Self.sample(t0: t0, t1: t1, serverNs: serverNs))
        if samples.count > window { samples.removeFirst(samples.count - window) }
    }

    public mutating func reset() { samples = [] }

    /// Median offset in ms (server − local), nil before the first pong.
    public var offsetMs: Double? {
        guard !samples.isEmpty else { return nil }
        let sorted = samples.map(\.offsetMs).sorted()
        let n = sorted.count
        return n % 2 == 1 ? sorted[n / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    }

    public var medianRttMs: Double? {
        guard !samples.isEmpty else { return nil }
        let sorted = samples.map(\.rttMs).sorted()
        return sorted[sorted.count / 2]
    }

    /// The server's clock now, in Unix ms.
    public func serverNowMs(localMs: Double) -> Double { localMs + (offsetMs ?? 0) }
}
