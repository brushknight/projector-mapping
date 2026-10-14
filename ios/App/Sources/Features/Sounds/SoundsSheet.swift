import SwiftUI
import PMKit
import PMDesign

/// The sounds sheet (protocol §14), reachable from every tab header: the active scene's soundboard, the wall's audio
/// output (where sound plays, master volume, mute) and the sound library with previews.
struct SoundsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("sounds").titleStyle(26)
                Spacer()
                IconPill(.close, size: 16, label: "close") { dismiss() }
            }
            .padding(.top, 4)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Soundboard(columns: 4)
                    WallAudioCard()
                    SoundLibrary()
                }
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .presentationBackground(Palette.sheet)
        .presentationCornerRadius(38)
        .presentationDragIndicator(.visible)
        .presentationDetents([.large])
    }
}

/// The active scene's pads: tap plays (`cmd sound.play`), hold stops, looping pads stay lit while they play.
struct Soundboard: View {
    var columns: Int = 3
    var limit: Int?
    @Environment(AppModel.self) private var model

    var body: some View {
        let pads = model.scene?.sounds.pads ?? []
        let loops = Set(model.audioState.loops)
        let shown = limit.map { Array(pads.prefix($0)) } ?? pads
        VStack(alignment: .leading, spacing: 10) {
            CapRow("soundboard", padding: 4) {
                if !loops.isEmpty {
                    Button { stopAll() } label: {
                        HStack(spacing: 6) { Icon(.stop, size: 12); Text("stop all") }
                            .font(.pm(12)).tracking(1.2).textCase(.uppercase).foregroundStyle(Palette.ink)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("stop every sound")
                } else {
                    CapText(pads.isEmpty ? "" : "tap plays · hold stops")
                }
            }
            if pads.isEmpty {
                EmptyCard(title: "no pads in this scene", detail: "add pads in the show space on the laptop. each scene keeps its own soundboard.")
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
                    ForEach(shown) { pad in
                        PadTile(pad.name, color: pad.color, icon: pad.icon, playing: loops.contains(pad.id), loop: pad.loop,
                                missing: pad.sound.isEmpty || (!model.sounds.isEmpty && model.sound(pad.sound) == nil),
                                onTap: { model.playPad(pad) }, onHold: { model.stopPad(pad) })
                    }
                }
            }
        }
    }

    func stopAll() {
        guard model.hub.isLive else { return }
        Task { try? await model.hub.stopSound() }
    }
}

/// "wall": which client plays the show's sound, the master volume and mute (`cmd show.audio`).
struct WallAudioCard: View {
    @Environment(AppModel.self) private var model
    @State private var lastSent = Date.distantPast

    static let outputs = ["projector", "editor", "phone"]

    var body: some View {
        let audio = model.audioState
        let live = model.hub.isLive
        VStack(alignment: .leading, spacing: 10) {
            CapRow("wall", padding: 4) { CapText(audio.muted ? "muted" : "sound on") }
            Card {
                VStack(alignment: .leading, spacing: 9) {
                    Text("plays on").capStyle().padding(.horizontal, 2)
                    Segmented(["projector", "laptop", "this phone"], selected: Self.outputs.firstIndex(of: audio.output) ?? 0) { n in
                        model.setAudio(output: Self.outputs[n])
                    }
                }
                FillSlider("volume", icon: audio.muted ? .speakerOff : .speaker, value: audio.volume, enabled: live) { v in
                    if Date().timeIntervalSince(lastSent) > 0.12 {
                        lastSent = Date()
                        model.setAudio(volume: (v * 100).rounded() / 100)
                    }
                } onEnd: { v in
                    model.setAudio(volume: (v * 100).rounded() / 100)
                }
                Toggle("mute", isOn: Binding(get: { audio.muted }, set: { model.setAudio(muted: $0) }))
                    .toggleStyle(PMSwitchStyle())
                Text(hint(audio.output))
                    .font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(4).padding(.horizontal, 2)
            }
        }
    }

    func hint(_ output: String) -> String {
        switch output {
        case "phone": "this phone plays every sound and follows the timeline. keep the app open near a speaker."
        case "editor": "the laptop editor plays every sound while it is open."
        default: "the projector computer plays every sound. click its window once if the browser asks."
        }
    }
}

/// The sound library: tap a sound to hear it on the wall's audio output.
struct SoundLibrary: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let sounds = model.sounds
        VStack(alignment: .leading, spacing: 10) {
            CapRow("library", sounds.isEmpty ? "" : "\(sounds.count)")
            if sounds.isEmpty {
                EmptyCard(title: "no sounds yet", detail: "drop wav, mp3, m4a, aiff or ogg files on the show space on the laptop.")
            } else {
                ListCard {
                    ForEach(Array(sounds.enumerated()), id: \.element.sha) { n, s in
                        Button { model.preview(s) } label: {
                            ListRow(s.displayName, meta: Self.length(s.duration), separator: n > 0) {
                                Icon(.play, size: 14)
                                    .frame(width: 44, height: 44)
                                    .foregroundStyle(Palette.ink)
                                    .background(Palette.track)
                            } trailing: {
                                Waveform(s.peaks, bars: 28)
                                    .foregroundStyle(Palette.dim)
                                    .frame(width: 92, height: 26)
                                    .padding(.trailing, 6)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("play \(s.displayName)")
                    }
                }
            }
        }
    }

    /// "12.5 s", "1:04".
    static func length(_ d: Double?) -> String {
        guard let d, d > 0 else { return "length unknown" }
        if d < 60 { return String(format: "%.1f s", d) }
        return String(format: "%d:%02d", Int(d) / 60, Int(d) % 60)
    }
}
