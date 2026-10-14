import Foundation

/// One timeline sound clip as the audio output plays it from a playhead (protocol §14, "Sound on the timeline").
/// Times are seconds from the moment of planning.
public struct ScheduledSound: Sendable, Hashable {
    /// A gain change: from `at` seconds, ramp linearly to `gain` over `over` seconds.
    public struct Ramp: Sendable, Hashable {
        public var at: Double
        public var gain: Double
        public var over: Double
        public init(at: Double, gain: Double, over: Double) { self.at = at; self.gain = gain; self.over = over }
    }

    public var clipId: String
    public var sound: String
    /// Seconds until the clip starts (0 when the playhead is already inside it: it starts at once).
    public var delay: Double
    /// Where in the file playback starts: `offset + (startT − clip.start)`.
    public var fileOffset: Double
    /// How long it plays (to the clip's end, or the file's end when known).
    public var length: Double
    /// The clip's own volume (0…1); the master multiplies on top.
    public var volume: Double
    /// The fade gain (0…1) when it starts.
    public var startGain: Double
    /// The fade-in remainder and the fade-out, in order.
    public var ramps: [Ramp]

    public init(clipId: String, sound: String, delay: Double, fileOffset: Double, length: Double, volume: Double, startGain: Double, ramps: [Ramp]) {
        self.clipId = clipId; self.sound = sound; self.delay = delay; self.fileOffset = fileOffset; self.length = length
        self.volume = volume; self.startGain = startGain; self.ramps = ramps
    }
}

/// Pure math for playing a scene's timeline sound clips from `show.transport` (unit tested; the app's audio output
/// turns the plan into `AVAudioPlayer.play(atTime:)` and `setVolume(_:fadeDuration:)`).
public enum SoundSchedule {
    /// Linear fade gain of a clip at playhead `t`: ramps up over `fadeIn` after `start`, down over `fadeOut` before
    /// `end`; 0 outside the clip.
    public static func fadeGain(start: Double, end: Double, fadeIn: Double, fadeOut: Double, at t: Double) -> Double {
        guard t >= start, t < end else { return 0 }
        var g = 1.0
        if fadeIn > 0, t < start + fadeIn { g = min(g, (t - start) / fadeIn) }
        if fadeOut > 0, t > end - fadeOut { g = min(g, (end - t) / fadeOut) }
        return min(1, max(0, g))
    }

    public static func fadeGain(_ clip: Clip, at t: Double) -> Double {
        fadeGain(start: clip.start, end: clip.end, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, at: t)
    }

    /// Only a playing transport makes timeline sound (paused and stopped are silent).
    public static func isAudible(_ transport: Transport) -> Bool { transport.state == "playing" }

    /// The clips that sound from playhead `t` on: a clip that already started plays at once from the right file
    /// position, later ones wait `delay`. Clips that ended, or whose file position is past the file's end (when
    /// `durations[sha]` is known), are left out. `horizon` limits how far ahead to plan.
    public static func plan(_ clips: [(clip: Clip, params: SoundClipParams)], at t: Double, durations: [String: Double] = [:],
                            horizon: Double = .infinity) -> [ScheduledSound] {
        var out: [ScheduledSound] = []
        for (clip, p) in clips {
            guard clip.end > clip.start, clip.end > t, !p.sound.isEmpty else { continue }
            let startT = max(t, clip.start)
            let delay = startT - t
            guard delay <= horizon else { continue }
            let fileOffset = p.offset + (startT - clip.start)
            var length = clip.end - startT
            if let d = durations[p.sound], d > 0 {
                guard fileOffset < d else { continue }
                length = min(length, d - fileOffset)
            }
            guard length > 0.001 else { continue }
            let startGain = fadeGain(clip, at: startT)
            var ramps: [ScheduledSound.Ramp] = []
            let fadeOutStart = clip.fadeOut > 0 ? max(startT, clip.end - clip.fadeOut) : clip.end
            if clip.fadeIn > 0, startT < clip.start + clip.fadeIn {
                let full = min(clip.start + clip.fadeIn, fadeOutStart)
                ramps.append(.init(at: delay, gain: fadeGain(clip, at: full), over: full - startT))
            }
            if clip.fadeOut > 0 {
                ramps.append(.init(at: fadeOutStart - t, gain: 0, over: clip.end - fadeOutStart))
            }
            out.append(ScheduledSound(clipId: clip.id, sound: p.sound, delay: delay, fileOffset: fileOffset, length: length,
                                      volume: p.volume, startGain: startGain, ramps: ramps))
        }
        return out
    }

    /// The plan for a scene and a transport at a server clock reading; empty unless playing.
    public static func plan(scene: Scene, transport: Transport, serverNowMs: Double, durations: [String: Double] = [:]) -> [ScheduledSound] {
        guard isAudible(transport) else { return [] }
        return plan(scene.timeline.soundClips, at: transport.playhead(serverNowMs: serverNowMs), durations: durations)
    }
}
