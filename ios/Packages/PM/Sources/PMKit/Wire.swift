import Foundation

/// One WebSocket frame (protocol §3): `{ t, ch?, id?, re?, v?, base?, d? }`.
public struct Envelope: Codable, Sendable, Hashable {
    public var t: String
    public var ch: String?
    public var id: String?
    public var re: String?
    public var v: Int?
    public var base: Int?
    public var d: JSONValue?

    public init(t: String, ch: String? = nil, id: String? = nil, re: String? = nil, v: Int? = nil, base: Int? = nil, d: JSONValue? = nil) {
        self.t = t; self.ch = ch; self.id = id; self.re = re; self.v = v; self.base = base; self.d = d
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        t = try c.decode(String.self, forKey: .t)
        ch = c.opt(.ch)
        id = c.opt(.id)
        re = c.opt(.re)
        let vd: Double? = c.opt(.v)
        v = vd.map { Int($0) }
        let bd: Double? = c.opt(.base)
        base = bd.map { Int($0) }
        d = c.opt(.d)
    }

    public static func decode(_ text: String) throws -> Envelope {
        try JSONDecoder().decode(Envelope.self, from: Data(text.utf8))
    }

    public var text: String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.withoutEscapingSlashes]
        return (try? String(decoding: enc.encode(self), as: UTF8.self)) ?? "{}"
    }
}

/// Message type names (protocol §3).
public enum MessageType {
    public static let hello = "hello", welcome = "welcome", ping = "ping", pong = "pong"
    public static let sub = "sub", unsub = "unsub", snapshot = "snapshot"
    public static let param = "param", patch = "patch", patched = "patched", reject = "reject"
    public static let cmd = "cmd", ack = "ack", error = "error"
    public static let rpc = "rpc", rpcResult = "rpc.result", rpcError = "rpc.error"
    public static let telemetry = "telemetry"
    public static let cameraFrame = "camera.frame", cameraStatus = "camera.status"
    /// Direct messages to audio clients (no `ch`, protocol §14).
    public static let soundPlay = "sound.play", soundStop = "sound.stop"
}

/// Channel names (protocol §3).
public enum Channel {
    public static let show = "show", presets = "presets", devices = "devices", camera = "camera"
    /// Lists with a millisecond `v` (protocol §14).
    public static let scenes = "scenes", sounds = "sounds", videos = "videos"
    public static func importJob(_ id: String) -> String { "import:\(id)" }
    public static func scene(_ id: String) -> String { "scene:\(id)" }
    public static func setup(_ id: String) -> String { "setup:\(id)" }
    public static func draft(_ id: String) -> String { "draft:\(id)" }
    public static func agent(_ id: String) -> String { "agent:\(id)" }
    public static func calib(_ id: String) -> String { "calib:\(id)" }

    /// `("scene", "scn_desk")` for `scene:scn_desk`.
    public static func split(_ ch: String) -> (kind: String, id: String?) {
        guard let i = ch.firstIndex(of: ":") else { return (ch, nil) }
        return (String(ch[..<i]), String(ch[ch.index(after: i)...]))
    }
}

/// `hello { token?, role, name, caps, build }`.
public struct Hello: Codable, Sendable, Hashable {
    public var token: String?
    public var role: String
    public var name: String
    public var caps: [String]
    public var build: String
    public init(token: String?, role: String = "remote", name: String, caps: [String] = ["haptics", "camera", "audio"], build: String) {
        self.token = token; self.role = role; self.name = name; self.caps = caps; self.build = build
    }
}

/// `welcome { device, serverTime, show, catalogVersion }`.
public struct Welcome: Codable, Sendable, Hashable {
    public var device: Device?
    public var serverTime: Int64
    public var show: Show?
    public var catalogVersion: Int

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        device = c.opt(.device)
        let exact: Int64? = c.opt(.serverTime)
        let approx: Double? = c.opt(.serverTime)
        serverTime = exact ?? approx.map { Int64($0) } ?? 0
        show = c.opt(.show)
        catalogVersion = c.v(.catalogVersion, 0)
    }
}

/// `param { path, value, by? }`.
public struct ParamMessage: Codable, Sendable, Hashable {
    public var path: String
    public var value: JSONValue
    public var by: String?
    public init(path: String, value: JSONValue, by: String? = nil) { self.path = path; self.value = value; self.by = by }
}

/// `patched { ops, by }`; a `patch` may carry its ops as `d` directly (an array) or as `{ ops }`.
public struct PatchedMessage: Sendable, Hashable {
    public var ops: [PatchOp]
    public var by: String?

    public init(ops: [PatchOp], by: String?) { self.ops = ops; self.by = by }

    public init?(_ d: JSONValue?) {
        guard let d else { return nil }
        if case .array = d {
            guard let ops = try? d.decode([PatchOp].self) else { return nil }
            self.ops = ops
            by = nil
        } else {
            guard let opsV = d["ops"], let ops = try? opsV.decode([PatchOp].self) else { return nil }
            self.ops = ops
            by = d["by"]?.string
        }
    }
}

/// `error { code, message }` / `reject { code, message }`.
public struct WireError: Codable, Sendable, Hashable, Error, LocalizedError {
    public var code: String
    public var message: String
    public init(code: String, message: String) { self.code = code; self.message = message }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = c.v(.code, "error")
        message = c.v(.message, "")
    }
    public var errorDescription: String? { message.isEmpty ? code : message }
}

/// `rpc { method, args }`.
public struct RPCRequest: Codable, Sendable, Hashable {
    public var method: String
    public var args: JSONValue
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        method = c.v(.method, "")
        args = c.v(.args, JSONValue.object([:]))
    }
}

/// `camera.frame { seq, width, height, jpeg }` (jpeg is base64).
public struct CameraFrame: Codable, Sendable, Hashable {
    public var seq: Int
    public var width: Int
    public var height: Int
    public var jpeg: String
    public init(seq: Int, width: Int, height: Int, jpeg: String) { self.seq = seq; self.width = width; self.height = height; self.jpeg = jpeg }
}

/// `camera.status { streaming, fps, width, height, steady, level }`.
public struct CameraStatus: Codable, Sendable, Hashable {
    public var streaming: Bool
    public var fps: Double
    public var width: Int
    public var height: Int
    public var steady: Bool
    public var level: Double
    public init(streaming: Bool, fps: Double, width: Int, height: Int, steady: Bool, level: Double) {
        self.streaming = streaming; self.fps = fps; self.width = width; self.height = height; self.steady = steady; self.level = level
    }
}
