import Foundation
import Network

/// Finds projmap servers on the local network over Bonjour (`_projmap._tcp`, protocol §4).
public final class BonjourBrowser: @unchecked Sendable {
    public struct Server: Sendable, Hashable, Identifiable {
        public var name: String
        public var url: URL
        public var serverId: String?
        public var id: String { serverId ?? url.absoluteString }
    }

    public static let serviceType = "_projmap._tcp"

    private let queue = DispatchQueue(label: "projmap.bonjour")
    private var browser: NWBrowser?
    private var resolving: [String: NWConnection] = [:]
    private var found: [String: Server] = [:]
    private var continuation: AsyncStream<[Server]>.Continuation?

    public init() {}

    /// Every change of the list of servers found; ends when the task is cancelled.
    public func servers() -> AsyncStream<[Server]> {
        AsyncStream { cont in
            queue.async {
                self.continuation = cont
                self.start()
            }
            cont.onTermination = { [weak self] _ in
                guard let self else { return }
                self.queue.async { self.stop() }
            }
        }
    }

    private func start() {
        let params = NWParameters()
        params.includePeerToPeer = false
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: nil), using: params)
        b.browseResultsChangedHandler = { [weak self] results, _ in self?.update(results) }
        b.start(queue: queue)
        browser = b
    }

    private func stop() {
        browser?.cancel()
        browser = nil
        resolving.values.forEach { $0.cancel() }
        resolving = [:]
        continuation?.finish()
        continuation = nil
    }

    private func update(_ results: Set<NWBrowser.Result>) {
        var live = Set<String>()
        for r in results {
            guard case .service(let name, _, _, _) = r.endpoint else { continue }
            live.insert(name)
            if found[name] != nil || resolving[name] != nil { continue }
            var txt: [String: String] = [:]
            if case .bonjour(let record) = r.metadata { txt = record.dictionary }
            resolve(r.endpoint, name: name, txt: txt)
        }
        for k in found.keys where !live.contains(k) { found[k] = nil }
        publish()
    }

    private func resolve(_ endpoint: NWEndpoint, name: String, txt: [String: String]) {
        let params = NWParameters.tcp
        if let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options { ip.version = .v4 }
        let conn = NWConnection(to: endpoint, using: params)
        resolving[name] = conn
        let label = txt["name"] ?? name
        conn.stateUpdateHandler = { [weak self, weak conn] state in
            guard let self, let conn else { return }
            switch state {
            case .ready:
                if case .hostPort(let host, let port) = conn.currentPath?.remoteEndpoint {
                    var h = "\(host)"
                    if let pct = h.firstIndex(of: "%") { h = String(h[..<pct]) }
                    if h.contains(":") { h = "[\(h)]" }
                    if let url = URL(string: "http://\(h):\(port.rawValue)") {
                        self.found[name] = Server(name: label, url: url, serverId: txt["id"])
                    }
                }
                conn.cancel()
                self.resolving[name] = nil
                self.publish()
            case .failed, .cancelled:
                if self.found[name] == nil, let url = URL(string: "http://\(label).local:\(ConnectLink.defaultPort)") {
                    self.found[name] = Server(name: label, url: url, serverId: txt["id"])
                    self.publish()
                }
                self.resolving[name] = nil
            default:
                break
            }
        }
        conn.start(queue: queue)
    }

    private func publish() {
        continuation?.yield(found.values.sorted { $0.name < $1.name })
    }
}
