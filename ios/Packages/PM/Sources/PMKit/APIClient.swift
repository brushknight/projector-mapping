import Foundation

/// Sends one HTTP request. `URLSession` in the app; a fake in tests.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

extension URLSession: HTTPTransport {
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, resp) = try await data(for: request)
        guard let http = resp as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

public enum APIError: Error, Sendable, Equatable, LocalizedError {
    /// The server could not be reached.
    case unreachable(String)
    /// The server answered with an error status; `code` and `message` come from `{ code, message }`.
    case http(status: Int, code: String, message: String)
    case decoding(String)

    public var status: Int? { if case .http(let s, _, _) = self { s } else { nil } }
    public var code: String? { if case .http(_, let c, _) = self { c } else { nil } }
    public var isUnreachable: Bool { if case .unreachable = self { true } else { false } }

    public var errorDescription: String? {
        switch self {
        case .unreachable(let m): "The server is not reachable: \(m)"
        case .http(let s, _, let m): m.isEmpty ? "The server answered \(s)." : m
        case .decoding(let m): "The server sent something unexpected: \(m)"
        }
    }
}

/// The projmap REST API (protocol §2) with this phone's device token.
public struct APIClient: Sendable {
    public let server: URL
    public let token: String?
    let transport: any HTTPTransport

    public init(server: URL, token: String?, transport: any HTTPTransport = URLSession.shared) {
        self.server = server
        self.token = token
        self.transport = transport
    }

    public func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var c = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        c.path = path.hasPrefix("/") ? path : "/" + path
        if !query.isEmpty { c.queryItems = query }
        return c.url!
    }

    /// `ws://host:7400/ws`.
    public var webSocketURL: URL {
        var c = URLComponents(url: server, resolvingAgainstBaseURL: false)!
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        c.path = "/ws"
        return c.url!
    }

    public var authHeaders: [String: String] { token.map { ["Authorization": "Bearer \($0)"] } ?? [:] }

    public func request(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
                        contentType: String = "application/json", timeout: TimeInterval = 20) -> URLRequest {
        var r = URLRequest(url: url(path, query: query), timeoutInterval: timeout)
        r.httpMethod = method
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            r.httpBody = body
            r.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    public func data(_ req: URLRequest) async throws -> Data {
        let data: Data, resp: HTTPURLResponse
        do {
            (data, resp) = try await transport.send(req)
        } catch let e as APIError {
            throw e
        } catch {
            throw APIError.unreachable(error.localizedDescription)
        }
        guard (200..<300).contains(resp.statusCode) else {
            let e = try? JSONDecoder().decode(WireError.self, from: data)
            throw APIError.http(status: resp.statusCode, code: e?.code ?? "", message: e?.message ?? String(decoding: data.prefix(200), as: UTF8.self))
        }
        return data
    }

    public func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as: T.Type = T.self) async throws -> T {
        try decode(await data(request("GET", path, query: query)))
    }

    public func send<T: Decodable>(_ method: String, _ path: String, body: JSONValue? = nil, as: T.Type = T.self) async throws -> T {
        try decode(await data(request(method, path, body: body?.jsonData ?? Data("{}".utf8))))
    }

    public func call(_ method: String, _ path: String, body: JSONValue? = nil) async throws {
        _ = try await data(request(method, path, body: body?.jsonData ?? Data("{}".utf8)))
    }

    func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw APIError.decoding(String(describing: error)) }
    }
}

// MARK: - Endpoints

extension APIClient {
    static let v1 = "/api/v1"

    public func info() async throws -> ServerInfo {
        try decode(await data(request("GET", "\(Self.v1)/info", timeout: 4)))
    }

    /// Exchanges the code the output shows for a device token.
    public func pair(code: String, name: String, role: String = "remote") async throws -> PairResult {
        try await send("POST", "\(Self.v1)/pair", body: ["code": .string(code.uppercased()), "name": .string(name), "role": .string(role)])
    }

    /// The raw catalog bytes (decode with `Catalog.decode` to keep param order).
    public func catalogData() async throws -> Data { try await data(request("GET", "\(Self.v1)/catalog")) }

    public func setups() async throws -> [Setup] { try await get("\(Self.v1)/setups") }
    public func scenes() async throws -> [SceneSummary] { try await get("\(Self.v1)/scenes") }
    public func scene(_ id: String) async throws -> JSONValue { try await get("\(Self.v1)/scenes/\(id)") }

    public func patchScene(_ id: String, base: Int, ops: [PatchOp]) async throws -> Int {
        let body: JSONValue = ["base": .number(Double(base)), "ops": try JSONValue(encoding: ops)]
        let r: VersionResult = try await send("POST", "\(Self.v1)/scenes/\(id)/patch", body: body)
        return r.version
    }

    public func patchSetup(_ id: String, _ partial: JSONValue) async throws -> Setup {
        try await send("PATCH", "\(Self.v1)/setups/\(id)", body: partial)
    }

    public func presets() async throws -> [Preset] { try await get("\(Self.v1)/presets") }

    public func createPreset(name: String, mode: String, sceneId: String) async throws -> Preset {
        try await send("POST", "\(Self.v1)/presets", body: ["name": .string(name), "mode": .string(mode), "sceneId": .string(sceneId)])
    }

    public func applyPreset(_ id: String, sceneId: String) async throws {
        try await call("POST", "\(Self.v1)/presets/\(id)/apply", body: ["sceneId": .string(sceneId)])
    }

    public func deletePreset(_ id: String) async throws { try await call("DELETE", "\(Self.v1)/presets/\(id)") }

    public func show() async throws -> Show { try await get("\(Self.v1)/show") }

    /// `POST /show/{action}`: go, back, play, pause, stop, seek {t}, blackout {on}, activate {sceneId}.
    public func show(_ action: String, _ body: JSONValue? = nil) async throws {
        try await call("POST", "\(Self.v1)/show/\(action)", body: body)
    }

    public func devices() async throws -> [Device] { try await get("\(Self.v1)/devices") }

    /// `POST /assets` (multipart `file`, optional `kind`).
    public func uploadAsset(_ bytes: Data, filename: String = "photo.jpg", mime: String = "image/jpeg", kind: String = "photo") async throws -> Asset {
        let (body, type) = Multipart.body(file: bytes, filename: filename, mime: mime, fields: ["kind": kind])
        return try decode(await data(request("POST", "\(Self.v1)/assets", body: body, contentType: type, timeout: 60)))
    }

    /// `POST /camera/stills?request={id}` answering a `camera.capture` request; returns the stored still's sha.
    public func uploadStill(requestId: String, jpeg: Data) async throws -> String {
        let (body, type) = Multipart.body(file: jpeg, filename: "\(requestId).jpg", mime: "image/jpeg", fields: [:])
        let d = try await data(request("POST", "\(Self.v1)/camera/stills", query: [.init(name: "request", value: requestId)],
                                       body: body, contentType: type, timeout: 60))
        let any = try? JSONDecoder().decode(JSONValue.self, from: d)
        return any?["sha"]?.string ?? any?["asset"]?["sha"]?.string ?? ""
    }

    public func startCalibration(setupId: String) async throws -> String {
        let r: IDResult = try await send("POST", "\(Self.v1)/calibrations", body: ["setupId": .string(setupId)])
        return r.id
    }

    /// The calibration and its candidate surfaces (`/calibrations/{id}/candidates`, protocol §9).
    public func calibration(_ id: String) async throws -> CalibrationResult {
        var r: CalibrationResult = try await get("\(Self.v1)/calibrations/\(id)")
        if r.objects.isEmpty, let list: [CalibrationResult.Candidate] = try? await get("\(Self.v1)/calibrations/\(id)/candidates") {
            r.attach(list)
        }
        return r
    }

    public func startAgent(agent: String, prompt: String, sceneId: String) async throws -> AgentSession {
        try await send("POST", "\(Self.v1)/agents/sessions", body: ["agent": .string(agent), "prompt": .string(prompt), "sceneId": .string(sceneId)])
    }

    public func agentEvents(_ id: String) async throws -> [AgentEvent] { try await get("\(Self.v1)/agents/sessions/\(id)/events") }
    public func cancelAgent(_ id: String) async throws { try await call("POST", "\(Self.v1)/agents/sessions/\(id)/cancel") }
    public func applyDraft(_ id: String) async throws { try await call("POST", "\(Self.v1)/drafts/\(id)/apply") }
    public func discardDraft(_ id: String) async throws { try await call("POST", "\(Self.v1)/drafts/\(id)/discard") }

    // MARK: URLs for images and the preview page

    public func assetURL(sha: String) -> URL { url("/a/\(sha)") }

    /// `/catalog/assets/scenery/<id>.jpg`.
    public func catalogAssetURL(_ path: String) -> URL { url("/catalog/assets/\(path)") }

    /// `/preview?token=…&w=…&mode=hero|layer&layer=<id>` (protocol §6).
    public func previewURL(width: Int, mode: String = "hero", layer: String? = nil) -> URL {
        var q: [URLQueryItem] = []
        if let token { q.append(.init(name: "token", value: token)) }
        q.append(.init(name: "w", value: String(width)))
        q.append(.init(name: "mode", value: mode))
        if let layer { q.append(.init(name: "layer", value: layer)) }
        return url("/preview", query: q)
    }
}

enum Multipart {
    static func body(file: Data, filename: String, mime: String, fields: [String: String]) -> (Data, String) {
        let boundary = "pm-\(UUID().uuidString)"
        var d = Data()
        func line(_ s: String) { d.append(Data((s + "\r\n").utf8)) }
        for (k, v) in fields.sorted(by: { $0.key < $1.key }) {
            line("--\(boundary)")
            line("Content-Disposition: form-data; name=\"\(k)\"")
            line("")
            line(v)
        }
        line("--\(boundary)")
        line("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"")
        line("Content-Type: \(mime)")
        line("")
        d.append(file)
        line("")
        line("--\(boundary)--")
        return (d, "multipart/form-data; boundary=\(boundary)")
    }
}
