import AVFoundation
import Foundation
import PMKit

/// The phone as the show's audio output (protocol §14). Silent unless `show.audio.output` is `phone`; then it plays
/// `sound.play` messages (pads, cue sounds, library previews) with `AVAudioPlayer`, stops on `sound.stop`, applies the
/// master volume and mute live, loops looping pads, and plays the active scene's timeline sound clips from
/// `show.transport` on the server clock, scheduling them again on every show or scene change.
@MainActor
final class AudioOutput {
    /// Where a sound's bytes are (a cached `/a/{sha}` download, or a generated file in the demo).
    var source: (String) async -> URL? = { _ in nil }
    /// The server clock now (Unix ms).
    var serverNowMs: () -> Double = { Date().timeIntervalSince1970 * 1000 }

    private struct Play {
        var player: AVAudioPlayer
        var padId: String?
        var gain: Double
    }

    /// What the timeline schedule depends on; a change means stop and schedule again.
    private struct TimelineKey: Equatable {
        var sceneId: String
        var timeline: Timeline
        var transport: Transport
        var master: Double
        var durations: [String: Double]
    }

    private var enabled = false
    private var master = 1.0
    private var plays: [String: Play] = [:]
    private var timelinePlayers: [AVAudioPlayer] = []
    private var timelineTasks: [Task<Void, Never>] = []
    private var timelineKey: TimelineKey?
    private var files: [String: URL] = [:]
    private var loading: Set<String> = []
    private var warm: [String: AVAudioPlayer] = [:]
    private var last: (show: Show, scene: Scene?, durations: [String: Double])?
    private var sessionReady = false

    var isEnabled: Bool { enabled }

    // MARK: State

    /// Called on every show, scene or sound library change.
    func update(show: Show?, scene: Scene?, durations: [String: Double]) {
        guard let show, show.audio.output == "phone" else {
            if enabled { stopEverything() }
            enabled = false
            last = nil
            return
        }
        if !enabled { activateSession() }
        enabled = true
        last = (show, scene, durations)
        if show.audio.master != master {
            master = show.audio.master
            for p in plays.values { p.player.volume = Float(p.gain * master) }
        }
        preload(scene?.soundShas ?? [])
        scheduleTimeline(show: show, scene: scene, durations: durations)
    }

    private func activateSession() {
        guard !sessionReady else { return }
        sessionReady = true
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? s.setActive(true)
    }

    // MARK: sound.play / sound.stop

    func handle(_ event: SoundEvent) {
        guard enabled else { return }
        switch event {
        case .play(let p): Task { await play(p) }
        case .stop(let s): stop(s)
        }
    }

    private func play(_ p: SoundPlay) async {
        guard let url = await file(p.sound), enabled, let player = try? AVAudioPlayer(contentsOf: url) else { return }
        // A loop that was stopped while the file loaded must not start.
        player.numberOfLoops = p.loop ? -1 : 0
        let gain = min(1, max(0, p.volume))
        player.volume = Float(gain * master)
        player.prepareToPlay()
        player.play()
        plays[p.playId] = Play(player: player, padId: p.padId, gain: gain)
        if !p.loop {
            let id = p.playId
            let length = player.duration
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(length + 0.5))
                self?.plays[id] = nil
            }
        }
    }

    private func stop(_ s: SoundStop) {
        for (id, p) in plays where (s.playId == nil && s.padId == nil) || id == s.playId || (s.padId != nil && p.padId == s.padId) {
            p.player.stop()
            plays[id] = nil
        }
    }

    private func stopEverything() {
        for p in plays.values { p.player.stop() }
        plays = [:]
        clearTimeline()
        timelineKey = nil
    }

    // MARK: Timeline

    private func clearTimeline() {
        for t in timelineTasks { t.cancel() }
        timelineTasks = []
        for p in timelinePlayers { p.stop() }
        timelinePlayers = []
    }

    private func scheduleTimeline(show: Show, scene: Scene?, durations: [String: Double], force: Bool = false) {
        guard let scene else { clearTimeline(); timelineKey = nil; return }
        let key = TimelineKey(sceneId: scene.id, timeline: scene.timeline, transport: show.transport, master: master, durations: durations)
        guard force || key != timelineKey else { return }
        timelineKey = key
        clearTimeline()
        let plan = SoundSchedule.plan(scene: scene, transport: show.transport, serverNowMs: serverNowMs(), durations: durations)
        for item in plan {
            guard let url = files[item.sound], let player = try? AVAudioPlayer(contentsOf: url) else { continue }
            schedule(item, player: player)
        }
    }

    private func schedule(_ item: ScheduledSound, player: AVAudioPlayer) {
        let m = master
        player.currentTime = min(item.fileOffset, max(0, player.duration - 0.01))
        player.volume = Float(item.startGain * item.volume * m)
        player.prepareToPlay()
        player.play(atTime: player.deviceCurrentTime + max(0, item.delay))
        timelinePlayers.append(player)
        for ramp in item.ramps {
            timelineTasks.append(Task {
                if ramp.at > 0 { try? await Task.sleep(for: .seconds(ramp.at)) }
                guard !Task.isCancelled else { return }
                player.setVolume(Float(ramp.gain * item.volume * m), fadeDuration: max(0.01, ramp.over))
            })
        }
        timelineTasks.append(Task {
            try? await Task.sleep(for: .seconds(item.delay + item.length))
            guard !Task.isCancelled else { return }
            player.stop()
        })
    }

    // MARK: Files

    /// Downloads every sound the scene can play and warms a player for each, so a pad starts without a wait.
    private func preload(_ shas: [String]) {
        for sha in shas where files[sha] == nil && !loading.contains(sha) {
            loading.insert(sha)
            Task {
                let url = await source(sha)
                loading.remove(sha)
                guard let url else { return }
                files[sha] = url
                if let p = try? AVAudioPlayer(contentsOf: url) { p.prepareToPlay(); warm[sha] = p }
                // A clip whose file just arrived may need to start now.
                if let last, enabled { scheduleTimeline(show: last.show, scene: last.scene, durations: last.durations, force: true) }
            }
        }
    }

    private func file(_ sha: String) async -> URL? {
        if let f = files[sha] { return f }
        guard let url = await source(sha) else { return nil }
        files[sha] = url
        return url
    }
}

/// `/a/{sha}` downloads kept in Caches (sounds are immutable by sha).
enum SoundCache {
    static var directory: URL {
        URL.cachesDirectory.appendingPathComponent("projmap-sounds", isDirectory: true)
    }

    static func file(_ sha: String, api: APIClient?) async -> URL? {
        let dest = directory.appendingPathComponent(sha)
        if FileManager.default.fileExists(atPath: dest.path) { return dest }
        guard let api else { return nil }
        guard let data = try? await api.data(api.request("GET", "/a/\(sha)", timeout: 60)), !data.isEmpty else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: dest, options: .atomic)
        return dest
    }
}
