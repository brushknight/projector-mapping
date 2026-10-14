import Foundation

// Protocol §14: show control, sound and video. Every field is optional on decode and falls back to the protocol's
// default, so a scene or show from an older server decodes with no pads, the projector as audio output and so on.

// MARK: - Soundboard

/// A pad's colour (§14). Unknown values decode as `ink`.
public enum PadColor: String, CaseIterable, Codable, Sendable, Hashable {
    case ink, red, amber, green, teal, blue, violet, pink

    public init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? "ink"
        self = PadColor(rawValue: raw) ?? .ink
    }
}

/// A pad's icon (§14). Unknown values decode as `none` (the pad shows its name only).
public enum PadIcon: String, CaseIterable, Codable, Sendable, Hashable {
    case none, bell, door, thunder, rain, wind, bird, music, voice, knock, spark, heart

    public init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? "none"
        self = PadIcon(rawValue: raw) ?? .none
    }
}

/// One soundboard pad: `{ id, name, sound, volume, color, icon, key?, loop }`.
public struct Pad: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// A sound sha (not checked against the library: a deleted sound leaves a "missing sound" pad).
    public var sound: String
    public var volume: Double
    public var color: PadColor
    public var icon: PadIcon
    /// `a-z` or `0-9`: the web Show space plays the pad on that key.
    public var key: String?
    public var loop: Bool

    enum CodingKeys: String, CodingKey { case id, name, sound, volume, color, icon, key, loop }

    public init(id: String, name: String, sound: String, volume: Double = 1, color: PadColor = .ink, icon: PadIcon = .none,
                key: String? = nil, loop: Bool = false) {
        self.id = id; self.name = name; self.sound = sound; self.volume = volume; self.color = color; self.icon = icon
        self.key = key; self.loop = loop
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        sound = c.v(.sound, "")
        volume = c.v(.volume, 1)
        color = c.v(.color, PadColor.ink)
        icon = c.v(.icon, PadIcon.none)
        key = c.opt(.key)
        loop = c.v(.loop, false)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(sound, forKey: .sound)
        try c.encode(volume, forKey: .volume)
        try c.encode(color, forKey: .color)
        try c.encode(icon, forKey: .icon)
        try c.encodeIfPresent(key, forKey: .key)
        try c.encode(loop, forKey: .loop)
    }
}

/// `scene.sounds`: the scene's soundboard, pads in grid order.
public struct SceneSounds: Codable, Sendable, Hashable {
    public var pads: [Pad]
    public init(pads: [Pad] = []) { self.pads = pads }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pads = c.v(.pads, [])
    }
}

/// `cue.sound`: `{ sound, volume }`.
public struct CueSound: Codable, Sendable, Hashable {
    public var sound: String
    public var volume: Double
    public init(sound: String, volume: Double = 1) { self.sound = sound; self.volume = volume }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sound = c.v(.sound, "")
        volume = c.v(.volume, 1)
    }
}

/// The params of a clip on a sound track: `{ sound, offset, volume }`.
public struct SoundClipParams: Codable, Sendable, Hashable {
    public var sound: String
    /// Seconds into the file where the clip starts.
    public var offset: Double
    public var volume: Double

    public init(sound: String, offset: Double = 0, volume: Double = 1) { self.sound = sound; self.offset = offset; self.volume = volume }

    public init(_ params: JSONObject) {
        sound = params["sound"]?.string ?? ""
        offset = max(0, params["offset"]?.double ?? 0)
        volume = min(1, max(0, params["volume"]?.double ?? 1))
    }
}

// MARK: - Audio output

/// `show.audio`: which client plays every sound, the master volume, mute and the looping pads playing now.
public struct ShowAudio: Codable, Sendable, Hashable {
    public enum Output: String, CaseIterable, Sendable { case projector, editor, phone }

    /// `projector` | `editor` | `phone`
    public var output: String
    public var volume: Double
    public var muted: Bool
    /// Pad ids of the looping pads the server started (read only for clients).
    public var loops: [String]

    public init(output: String = "projector", volume: Double = 1, muted: Bool = false, loops: [String] = []) {
        self.output = output; self.volume = volume; self.muted = muted; self.loops = loops
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        output = c.v(.output, "projector")
        volume = c.v(.volume, 1)
        muted = c.v(.muted, false)
        loops = c.v(.loops, [])
    }

    /// The gain every sound is multiplied by: 0 while muted.
    public var master: Double { muted ? 0 : min(1, max(0, volume)) }
}

/// `sound.play { playId, sound, padId?, cueId?, name, volume, loop }` (server → audio clients).
public struct SoundPlay: Codable, Sendable, Hashable {
    public var playId: String
    public var sound: String
    public var padId: String?
    public var cueId: String?
    public var name: String
    public var volume: Double
    public var loop: Bool

    public init(playId: String, sound: String, padId: String? = nil, cueId: String? = nil, name: String = "", volume: Double = 1, loop: Bool = false) {
        self.playId = playId; self.sound = sound; self.padId = padId; self.cueId = cueId; self.name = name; self.volume = volume; self.loop = loop
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        playId = c.v(.playId, "")
        sound = c.v(.sound, "")
        padId = c.opt(.padId)
        cueId = c.opt(.cueId)
        name = c.v(.name, "")
        volume = c.v(.volume, 1)
        loop = c.v(.loop, false)
    }
}

/// `sound.stop { playId?, padId? }`: one play, every play of a pad, or (neither) every pad and cue sound.
public struct SoundStop: Codable, Sendable, Hashable {
    public var playId: String?
    public var padId: String?
    public init(playId: String? = nil, padId: String? = nil) { self.playId = playId; self.padId = padId }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        playId = c.opt(.playId)
        padId = c.opt(.padId)
    }
}

/// What the hub hands the audio output.
public enum SoundEvent: Sendable, Hashable {
    case play(SoundPlay)
    case stop(SoundStop)
}

// MARK: - Video

/// A tile of the scenery "videos" category (§14).
public struct Video: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// `asset:<sha>` or `youtube:<id>`: what a video layer uses.
    public var ref: String
    /// `file` | `youtube`
    public var source: String
    public var url: String?
    public var youtubeId: String?
    public var sha: String?
    /// A JPEG asset sha, or nil (embeds show YouTube's hqdefault image).
    public var thumb: String?
    public var duration: Double
    public var width: Int
    public var height: Int
    public var createdAt: String?

    public init(id: String, name: String, ref: String, source: String = "file", url: String? = nil, youtubeId: String? = nil,
                sha: String? = nil, thumb: String? = nil, duration: Double = 0, width: Int = 0, height: Int = 0, createdAt: String? = nil) {
        self.id = id; self.name = name; self.ref = ref; self.source = source; self.url = url; self.youtubeId = youtubeId
        self.sha = sha; self.thumb = thumb; self.duration = duration; self.width = width; self.height = height; self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        name = c.v(.name, "")
        ref = c.v(.ref, "")
        source = c.v(.source, "file")
        url = c.opt(.url)
        youtubeId = c.opt(.youtubeId)
        sha = c.opt(.sha)
        thumb = c.opt(.thumb)
        duration = c.v(.duration, 0)
        width = c.v(.width, 0)
        height = c.v(.height, 0)
        createdAt = c.opt(.createdAt)
    }

    /// True for an embedded YouTube player (needs the internet, cannot be fully blurred).
    public var isEmbed: Bool { VideoRef(ref)?.youtubeId != nil }
}

/// A YouTube import (§14): `download` with yt-dlp, else `embed`.
public struct ImportJob: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var url: String
    public var youtubeId: String
    /// `download` | `embed`
    public var mode: String
    /// `running` | `done` | `failed`
    public var status: String
    public var progress: Double
    public var message: String
    public var maxHeight: Int
    public var start: Double
    public var end: Double
    public var videoId: String?
    public var ref: String?
    public var createdAt: String?

    public init(id: String, url: String, youtubeId: String, mode: String = "download", status: String = "running", progress: Double = 0,
                message: String = "", maxHeight: Int = 1080, start: Double = 0, end: Double = 0, videoId: String? = nil, ref: String? = nil) {
        self.id = id; self.url = url; self.youtubeId = youtubeId; self.mode = mode; self.status = status; self.progress = progress
        self.message = message; self.maxHeight = maxHeight; self.start = start; self.end = end; self.videoId = videoId; self.ref = ref
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.v(.id, "")
        url = c.v(.url, "")
        youtubeId = c.v(.youtubeId, "")
        mode = c.v(.mode, "download")
        status = c.v(.status, "running")
        progress = c.v(.progress, 0)
        message = c.v(.message, "")
        maxHeight = c.v(.maxHeight, 1080)
        start = c.v(.start, 0)
        end = c.v(.end, 0)
        videoId = c.opt(.videoId)
        ref = c.opt(.ref)
        createdAt = c.opt(.createdAt)
    }

    public var isRunning: Bool { status == "running" }
    public var isDone: Bool { status == "done" }
    public var isFailed: Bool { status == "failed" }
}

/// `GET /videos/tools`: what the server found on its PATH.
public struct VideoTools: Codable, Sendable, Hashable {
    public var ytdlp: Bool
    public var ffmpeg: Bool
    public init(ytdlp: Bool = false, ffmpeg: Bool = false) { self.ytdlp = ytdlp; self.ffmpeg = ffmpeg }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ytdlp = c.v(.ytdlp, false)
        ffmpeg = c.v(.ffmpeg, false)
    }
}

/// A video layer's `ref`: `asset:<sha>` or `youtube:<11 chars>`; anything else is invalid.
public enum VideoRef: Sendable, Hashable {
    case asset(String)
    case youtube(String)

    public init?(_ ref: String) {
        if ref.hasPrefix("asset:"), ref.count > 6 { self = .asset(String(ref.dropFirst(6))); return }
        if ref.hasPrefix("youtube:"), YouTube.isValidId(String(ref.dropFirst(8))) { self = .youtube(String(ref.dropFirst(8))); return }
        return nil
    }

    public var ref: String {
        switch self {
        case .asset(let sha): "asset:\(sha)"
        case .youtube(let id): "youtube:\(id)"
        }
    }

    public var youtubeId: String? { if case .youtube(let id) = self { id } else { nil } }
    public var sha: String? { if case .asset(let sha) = self { sha } else { nil } }
}

/// YouTube links (§14): watch, youtu.be and Shorts links, http or https, extra query parameters ignored. The same rules
/// as the web client's `youtubeId()`.
public enum YouTube {
    public static let maxHeights = [360, 480, 720, 1080, 1440, 2160]
    public static let invalidMessage = "Paste a YouTube link: youtube.com/watch, youtu.be or a Shorts link."
    public static let ytdlpHint = "install yt-dlp on the Mac (brew install yt-dlp) for offline, sharper loops you can fully blur."

    /// 11 characters of `[A-Za-z0-9_-]`.
    public static func isValidId(_ id: String) -> Bool {
        id.count == 11 && id.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "_" || $0 == "-" }
    }

    /// The video id of a YouTube link, or nil.
    public static func videoId(_ link: String) -> String? {
        guard let c = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = c.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = c.host?.lowercased() else { return nil }
        func ok(_ id: String?) -> String? { id.flatMap { isValidId($0) ? $0 : nil } }
        let parts = c.path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if host == "youtu.be" { return ok(parts.count > 1 ? parts[1] : nil) }
        guard ["youtube.com", "www.youtube.com", "m.youtube.com"].contains(host) else { return nil }
        if c.path == "/watch" { return ok(c.queryItems?.first { $0.name == "v" }?.value) }
        if parts.count > 2, parts[1] == "shorts" { return ok(parts[2]) }
        return nil
    }

    /// `https://i.ytimg.com/vi/<id>/hqdefault.jpg` for embeds without a thumb.
    public static func thumbnailURL(_ id: String) -> URL { URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg")! }
}
