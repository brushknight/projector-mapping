import Foundation

/// A WebSocket connection; `URLSessionWebSocketTask` in the app, `FakeHub` in tests.
public protocol HubConnection: Sendable {
    func send(_ text: String) async throws
    func receive() async throws -> String
    func close()
}

public protocol HubTransport: Sendable {
    func connect(url: URL, token: String?) async throws -> any HubConnection
}

public struct URLSessionHubTransport: HubTransport {
    public init() {}

    public func connect(url: URL, token: String?) async throws -> any HubConnection {
        var req = URLRequest(url: url, timeoutInterval: 8)
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let task = URLSession.shared.webSocketTask(with: req)
        task.maximumMessageSize = 16 * 1024 * 1024
        task.resume()
        return URLSessionHubConnection(task: task)
    }
}

final class URLSessionHubConnection: HubConnection, @unchecked Sendable {
    let task: URLSessionWebSocketTask
    init(task: URLSessionWebSocketTask) { self.task = task }

    func send(_ text: String) async throws { try await task.send(.string(text)) }

    func receive() async throws -> String {
        switch try await task.receive() {
        case .string(let s): return s
        case .data(let d): return String(decoding: d, as: UTF8.self)
        @unknown default: return ""
        }
    }

    func close() { task.cancel(with: .normalClosure, reason: nil) }
}
