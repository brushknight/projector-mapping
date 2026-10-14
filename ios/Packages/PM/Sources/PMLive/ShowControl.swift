import Foundation
import PMKit
import PMStore

/// Protocol §14 on the hub: scenes (create, duplicate, rename, delete), the soundboard and audio output, the video
/// library and YouTube imports. Each call has an offline demo twin so every screen works without a server.
extension LiveHub {
    // MARK: Scenes

    /// Creates an empty scene on the active setup, or a copy of `duplicate`. Returns the new scene's id.
    @discardableResult
    public func createScene(name: String, duplicate: String? = nil) async throws -> String {
        if status == .demo { return try demoCreateScene(name: name, duplicate: duplicate) }
        guard let api, status == .online else { throw LiveError.notConnected }
        let doc = try await api.createScene(name: name, duplicate: duplicate)
        await refreshScenes()
        return doc["id"]?.string ?? ""
    }

    /// Renames a scene (shown at once, then `PATCH /scenes/{id}`).
    public func renameScene(_ id: String, name: String) async throws {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        if status == .demo { try? db.renameScene(id, name: String(n.prefix(80))); return }
        guard let api, status == .online else { throw LiveError.notConnected }
        let before = try? db.read(Queries.scenes).first { $0.id == id }?.name
        try? db.renameScene(id, name: String(n.prefix(80)))
        do { _ = try await api.renameScene(id, name: String(n.prefix(80))) } catch {
            if let before { try? db.renameScene(id, name: before) }
            throw error
        }
    }

    /// Deletes a scene that is not on the wall (the server answers `scene_active` for the active one).
    public func deleteScene(_ id: String) async throws {
        let active = (try? db.read(Queries.show))??.activeSceneId
        if id == active { throw WireError(code: "scene_active", message: "Activate another scene first.") }
        if status == .demo { try? db.removeScene(id); return }
        guard let api, status == .online else { throw LiveError.notConnected }
        try await api.deleteScene(id)
        try? db.removeScene(id)
        await refreshScenes()
    }

    func refreshScenes() async {
        guard let api, let list = try? await api.scenes() else { return }
        let active = (try? db.read(Queries.show))??.activeSceneId
        try? db.saveSceneList(list, prune: true, keep: active)
    }

    // MARK: Sound

    /// `cmd sound.play { padId }` in the active scene. The answer says `stopped: true` when it ended a looping pad.
    @discardableResult
    public func playPad(_ padId: String, volume: Double? = nil) async throws -> JSONValue? {
        try await command("sound.play", .object(SoundArgs.play(padId: padId, volume: volume)))
    }

    /// `cmd sound.play { soundId }`: a library sound (a preview).
    @discardableResult
    public func playSound(_ sha: String, volume: Double? = nil) async throws -> JSONValue? {
        try await command("sound.play", .object(SoundArgs.play(soundId: sha, volume: volume)))
    }

    /// `cmd sound.stop`: one play, every play of a pad, or (neither) every pad and cue sound.
    public func stopSound(playId: String? = nil, padId: String? = nil) async throws {
        try await command("sound.stop", .object(SoundArgs.stop(playId: playId, padId: padId)))
    }

    /// `cmd show.audio { output?, volume?, muted? }`.
    public func setAudio(output: String? = nil, volume: Double? = nil, muted: Bool? = nil) async throws {
        try await command("show.audio", .object(SoundArgs.audio(output: output, volume: volume, muted: muted)))
    }

    // MARK: Videos

    public func videoTools() async -> VideoTools? {
        if status == .demo { return VideoTools(ytdlp: false, ffmpeg: true) }
        return try? await api?.videoTools()
    }

    /// Starts a YouTube import and follows it on `import:{id}` (and by polling, for servers that do not push).
    public func importVideo(url: String, maxHeight: Int, start: Double, end: Double, name: String? = nil) async throws -> ImportJob {
        if status == .demo { return demoImport(url: url, maxHeight: maxHeight, start: start, end: end, name: name) }
        guard let api, status == .online else { throw LiveError.notConnected }
        let job = try await api.importVideo(url: url, maxHeight: maxHeight, start: start, end: end, name: name)
        imports[job.id] = job
        subscribe(Channel.importJob(job.id))
        Task { await self.pollImport(job.id) }
        return job
    }

    private func pollImport(_ id: String) async {
        var tries = 0
        while let job = imports[id], job.isRunning, tries < 900, status == .online {
            try? await Task.sleep(for: .seconds(1))
            tries += 1
            if let next = try? await api?.importJob(id), imports[id]?.isRunning ?? false { imports[id] = next }
        }
        unsubscribe(Channel.importJob(id))
        if imports[id]?.isDone == true, let list = try? await api?.videos() { try? db.saveVideos(list) }
    }

    /// `POST /videos` with progress; the new tile shows at once.
    public func uploadVideo(_ data: Data, filename: String, mime: String, name: String?, progress: @escaping @Sendable (Double) -> Void) async throws -> Video {
        if status == .demo { return try await demoUpload(name: name ?? "my video", progress: progress) }
        guard let api, status == .online else { throw LiveError.notConnected }
        let v = try await api.uploadVideo(data, filename: filename, mime: mime, name: name, progress: progress)
        var list = (try? db.read(Queries.videos)) ?? []
        if !list.contains(where: { $0.id == v.id }) { list.insert(v, at: 0); try? db.saveVideos(list) }
        return v
    }

    // MARK: Demo

    private func demoCreateScene(name: String, duplicate: String?) throws -> String {
        let id = "scn_" + String(UUID().uuidString.prefix(8)).lowercased()
        var doc: JSONValue
        if let duplicate, let src = (try? db.sceneDoc(duplicate)) ?? nil {
            doc = (try? src.applying([.replace("/id", .string(id)), .replace("/name", .string(name))])) ?? src
        } else {
            let setupId = ((try? db.read(Queries.show)) ?? nil)?.activeSetupId ?? "set_desk"
            doc = ["id": .string(id), "setupId": .string(setupId), "name": .string(name), "version": 1, "mode": "static",
                   "backdrop": ["static": ["layers": []], "live": ["layers": []], "color": ["layers": []], "scenery": ["layers": []]],
                   "underlay": ["on": false, "from": "static", "level": 0.35], "points": [], "objects": [],
                   "timeline": ["duration": 20, "tracks": [], "clips": [], "cues": []], "sounds": ["pads": []]]
        }
        try? db.saveSceneSnapshot(doc, version: 1)
        var list = (try? db.read(Queries.scenes)) ?? []
        list.removeAll { $0.id == id }
        list.append(SceneSummary(id: id, name: name, setupId: doc["setupId"]?.string ?? "", version: 1))
        try? db.saveSceneList(list)
        return id
    }

    private func demoImport(url: String, maxHeight: Int, start: Double, end: Double, name: String?) -> ImportJob {
        let yt = YouTube.videoId(url) ?? "aqz-KE-bpKQ"
        let videoId = "vid_" + String(UUID().uuidString.prefix(8)).lowercased()
        let job = ImportJob(id: "imp_demo", url: url, youtubeId: yt, mode: "embed", status: "done", progress: 1,
                            message: "yt-dlp is not installed, so this loop plays as an embedded YouTube player. Install it with brew install yt-dlp for offline, sharper loops you can fully blur.",
                            maxHeight: maxHeight, start: start, end: end, videoId: videoId, ref: "youtube:\(yt)")
        imports[job.id] = job
        var list = (try? db.read(Queries.videos)) ?? []
        list.insert(Video(id: videoId, name: name?.isEmpty == false ? name! : "youtube \(yt)", ref: "youtube:\(yt)", source: "youtube",
                          url: url, youtubeId: yt, duration: end > start ? end - start : 0), at: 0)
        try? db.saveVideos(list)
        return job
    }

    private func demoUpload(name: String, progress: @escaping @Sendable (Double) -> Void) async throws -> Video {
        for n in 1...10 {
            try? await Task.sleep(for: .milliseconds(120))
            progress(Double(n) / 10)
        }
        let v = Video(id: "vid_" + String(UUID().uuidString.prefix(8)).lowercased(), name: name, ref: "asset:demo", source: "file",
                      sha: "demo", thumb: "waterfall", duration: 12, width: 1920, height: 1080)
        var list = (try? db.read(Queries.videos)) ?? []
        list.insert(v, at: 0)
        try? db.saveVideos(list)
        return v
    }

    /// Demo `sound.play` / `sound.stop` / `show.audio`, as the server does them (§14): loops toggle, the phone plays
    /// only while it is the output.
    func demoSoundCommand(_ name: String, _ args: JSONValue, show: inout Show, scene: Scene?) throws -> JSONValue? {
        switch name {
        case "sound.play":
            let volume = min(1, max(0, args["volume"]?.double ?? 1))
            if let padId = args["padId"]?.string {
                guard let pad = scene?.sounds.pads.first(where: { $0.id == padId }) else {
                    throw WireError(code: "not_found", message: "That pad is not in this scene.")
                }
                guard !pad.sound.isEmpty else { throw WireError(code: "bad_request", message: "This pad has no sound yet.") }
                if pad.loop, show.audio.loops.contains(padId) {
                    show.audio.loops.removeAll { $0 == padId }
                    demoSound(.stop(SoundStop(padId: padId)), show: show)
                    return ["stopped": true]
                }
                if pad.loop { show.audio.loops.append(padId) }
                let play = SoundPlay(playId: Self.demoPlayId(), sound: pad.sound, padId: pad.id, name: pad.name, volume: pad.volume * volume, loop: pad.loop)
                demoSound(.play(play), show: show)
                return ["playId": .string(play.playId), "outputs": 1]
            }
            guard let sha = args["soundId"]?.string else { throw WireError(code: "bad_request", message: "Name a pad or a sound.") }
            let sounds = (try? db.read(Queries.sounds)) ?? []
            let play = SoundPlay(playId: Self.demoPlayId(), sound: sha, name: sounds.first { $0.sha == sha }?.displayName ?? "", volume: volume)
            demoSound(.play(play), show: show)
            return ["playId": .string(play.playId), "outputs": 1]
        case "sound.stop":
            let stop = (try? args.decode(SoundStop.self)) ?? SoundStop()
            if let padId = stop.padId { show.audio.loops.removeAll { $0 == padId } }
            if stop.padId == nil && stop.playId == nil { show.audio.loops = [] }
            demoSound(.stop(stop), show: show)
            return nil
        case "show.audio":
            if let o = args["output"]?.string, ShowAudio.Output(rawValue: o) != nil { show.audio.output = o }
            if let v = args["volume"]?.double { show.audio.volume = min(1, max(0, v)) }
            if let m = args["muted"]?.bool { show.audio.muted = m }
            return nil
        default:
            return nil
        }
    }

    func demoSound(_ event: SoundEvent, show: Show) {
        guard show.audio.output == "phone" else { return }
        onSound?(event)
    }

    static func demoPlayId() -> String { "ply_" + String(UUID().uuidString.prefix(8)).lowercased() }
}
