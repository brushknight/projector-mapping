import Foundation
import PMKit
import PMLive

/// A fake projmap hub for PMLive tests: the test plays the server, reading what the phone sends and pushing frames.
public final class FakeHub: HubTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var conns: [FakeConnection] = []
    public var refuse = false

    public init() {}

    public func connect(url: URL, token: String?) async throws -> any HubConnection {
        if lock.withLock({ refuse }) { throw URLError(.cannotConnectToHost) }
        let c = FakeConnection(token: token)
        lock.withLock { conns.append(c) }
        return c
    }

    public var connections: [FakeConnection] { lock.withLock { conns } }

    /// Waits for the phone to connect (the n-th connection, 1-based).
    public func connection(_ n: Int = 1, timeout: Double = 3) async throws -> FakeConnection {
        try await until(timeout) { self.connections.count >= n ? self.connections[n - 1] : nil }
    }
}

public final class FakeConnection: HubConnection, @unchecked Sendable {
    public let token: String?
    private let lock = NSLock()
    private var fromPhone: [Envelope] = []
    private let inbox: AsyncStream<String>
    private let inboxCont: AsyncStream<String>.Continuation
    private var iterator: AsyncStream<String>.Iterator
    public private(set) var closed = false

    init(token: String?) {
        self.token = token
        (inbox, inboxCont) = AsyncStream<String>.makeStream()
        iterator = inbox.makeAsyncIterator()
    }

    // HubConnection (phone side)

    public func send(_ text: String) async throws {
        guard let env = try? Envelope.decode(text) else { return }
        lock.withLock { fromPhone.append(env) }
    }

    public func receive() async throws -> String {
        guard let next = await iterator.next() else { throw URLError(.networkConnectionLost) }
        return next
    }

    public func close() {
        lock.withLock { closed = true }
        inboxCont.finish()
    }

    // Server side

    public var sent: [Envelope] { lock.withLock { fromPhone } }

    public func push(_ env: Envelope) { inboxCont.yield(env.text) }
    public func push(_ json: JSONValue) { inboxCont.yield(json.jsonText) }

    /// Ends the connection from the server side.
    public func drop() { inboxCont.finish() }

    /// The first message of type `t` (and channel `ch`) the phone sent after `skipping` earlier ones of that type.
    public func message(_ t: String, ch: String? = nil, skipping: Int = 0, timeout: Double = 3) async throws -> Envelope {
        try await until(timeout) {
            let m = self.sent.filter { $0.t == t && (ch == nil || $0.ch == ch) }
            return m.count > skipping ? m[skipping] : nil
        }
    }

    public func count(_ t: String) -> Int { sent.filter { $0.t == t }.count }

    /// Answers `hello` with `welcome` (fixture shape) for `show`.
    public func welcome(show: Show, catalogVersion: Int = 1, serverTime: Int64 = 1_791_700_000_123_456_789) throws {
        push(Envelope(t: "welcome", d: [
            "device": ["id": "dev_7k2", "name": "Test iPhone", "role": "remote", "online": true],
            "serverTime": .number(Double(serverTime)),
            "show": try JSONValue(encoding: show),
            "catalogVersion": .number(Double(catalogVersion)),
        ]))
    }
}

public struct TimeoutError: Error {}

/// Polls `check` until it returns a value or `timeout` seconds pass.
public func until<T>(_ timeout: Double = 3, isolation: isolated (any Actor)? = #isolation, _ check: () async throws -> T?) async throws -> T {
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
        if let v = try await check() { return v }
        try await Task.sleep(for: .milliseconds(5))
    }
    throw TimeoutError()
}

/// Polls `condition` until true or `timeout` seconds pass.
public func eventually(_ timeout: Double = 3, isolation: isolated (any Actor)? = #isolation, _ condition: () async throws -> Bool) async throws {
    _ = try await until(timeout, isolation: isolation) { try await condition() ? true : nil }
}
