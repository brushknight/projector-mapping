import Foundation
import Security

/// The QR code on the output's idle screen: `projmap://connect?server=<host[:port]>&code=<K7Q2>` (a `token` may
/// stand in for the code when the server already issued one).
public struct ConnectLink: Sendable, Equatable {
    public var server: URL
    public var code: String?
    public var token: String?

    public init(server: URL, code: String? = nil, token: String? = nil) {
        self.server = server; self.code = code; self.token = token
    }

    public init?(_ text: String) {
        guard let c = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              c.scheme == "projmap", c.host == "connect",
              let s = c.queryItems?.first(where: { $0.name == "server" })?.value,
              let url = ConnectLink.normalize(server: s)
        else { return nil }
        let code = c.queryItems?.first(where: { $0.name == "code" })?.value
        let token = c.queryItems?.first(where: { $0.name == "token" })?.value
        guard code?.isEmpty == false || token?.isEmpty == false else { return nil }
        self.server = url
        self.code = code?.uppercased()
        self.token = token
    }

    public static let defaultPort = 7400

    /// `studio-mac.local` → `http://studio-mac.local:7400`; keeps an explicit scheme and port, drops any path.
    public static func normalize(server: String) -> URL? {
        var s = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") { s = "http://" + s }
        guard var c = URLComponents(string: s), let host = c.host, !host.isEmpty,
              c.scheme == "http" || c.scheme == "https" else { return nil }
        if c.port == nil { c.port = defaultPort }
        c.path = ""
        c.query = nil
        c.fragment = nil
        return c.url
    }
}

/// The paired server, kept in the Keychain.
public struct Credentials: Codable, Sendable, Equatable {
    public var server: URL
    public var token: String
    public var deviceId: String
    /// The server's display name (`studio-mac`).
    public var serverName: String

    public init(server: URL, token: String, deviceId: String, serverName: String) {
        self.server = server; self.token = token; self.deviceId = deviceId; self.serverName = serverName
    }
}

public struct TokenStore: Sendable {
    let service: String
    let account = "server"

    public init(service: String = "com.brushknight.projmap") { self.service = service }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func load() -> Credentials? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }

    public func save(_ c: Credentials) throws {
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecValueData as String] = try JSONEncoder().encode(c)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    public func clear() { SecItemDelete(query as CFDictionary) }
}
