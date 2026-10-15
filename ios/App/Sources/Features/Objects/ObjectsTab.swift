import SwiftUI
import PMKit
import PMDesign

/// Board `phone-objects`: scene chips, the reveal preview, cue progress with GO / back / stop, auto map, objects.
struct ObjectsTab: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let scene = model.scene
        let cues = scene?.timeline.cues ?? []
        let transport = model.active.show?.transport ?? Transport()
        TabPage {
            TabHeader(title: "objects")
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(model.scenes) { s in
                        PillButton(s.name, on: s.id == model.sceneId) {
                            if s.id != model.sceneId { model.command("show.activate", ["sceneId": .string(s.id)]) }
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            TimelineView(.periodic(from: .now, by: transport.state == "playing" ? 0.1 : 3600)) { _ in
                let t = transport.playhead(serverNowMs: model.hub.serverNowMs)
                Hero(aspect: 370 / 305) {
                    ObjectsHeroArt(progress: heroProgress(t, scene: scene))
                        .aspectRatio(344 / 280, contentMode: .fit)
                        .frame(maxHeight: .infinity, alignment: .top)
                } leading: {
                    OnAirLabel(detail: cues.isEmpty ? nil : "cue \(min(cues.count, transport.cue + 1)) / \(cues.count)")
                } trailing: {
                    GlassPill { Text(Fmt.playhead(t)) }
                }
            }
            cueCard(cues: cues, transport: transport)
            autoMapCard
            objectsSection(scene: scene, transport: transport)
            Soundboard(columns: 4)
            HStack(spacing: 7) {
                Icon(.laptop, size: 16)
                Text("objects are mapped on the laptop").font(.pm(13))
            }
            .foregroundStyle(Palette.dim)
            .frame(maxWidth: .infinity)
            .frame(height: 34)
        }
    }

    /// How far the outline has run (0…1) for the native preview: through the trace clip playing now, else through
    /// whatever clip plays now, so the stand-in moves with the wall's clock for the whole show.
    func heroProgress(_ t: Double, scene: PMKit.Scene?) -> Double {
        let timeline = scene?.timeline ?? Timeline()
        let sound = Set(timeline.tracks.filter(\.target.isSound).map(\.id))
        let playing = timeline.clips.filter { !sound.contains($0.trackId) && $0.start <= t && t < $0.end }
        guard let clip = playing.first(where: { $0.effect == "trace" }) ?? playing.first else { return 1 }
        return (t - clip.start) / max(0.01, clip.end - clip.start) * 1.15
    }

    // MARK: Cues

    func cueCard(cues: [Cue], transport: Transport) -> some View {
        let i = min(max(0, transport.cue), max(0, cues.count - 1))
        let current = cues.isEmpty ? nil : cues[i]
        let next = i + 1 < cues.count ? cues[i + 1] : nil
        return Card(spacing: 12) {
            HStack {
                Text(current.map { "\(i + 1) · \($0.label)" } ?? "no cues").font(.pm(15)).tracking(0.2).foregroundStyle(Palette.ink)
                Spacer()
                Text(next.map { "next · \($0.label)" } ?? "last cue").font(.pm(13)).tracking(0.2).foregroundStyle(Palette.dim)
            }
            .padding(.horizontal, 2)
            if let cs = current?.sound {
                HStack(spacing: 7) {
                    Icon(.speaker, size: 15)
                    Text("plays \(model.sound(cs.sound)?.displayName ?? (model.sounds.isEmpty ? "a sound" : "a missing sound"))")
                        .font(.pm(13)).tracking(0.2).lineLimit(1)
                }
                .foregroundStyle(Palette.dim)
                .padding(.horizontal, 2)
                .padding(.top, -4)
                .accessibilityElement(children: .combine)
            }
            HStack(spacing: 4) {
                ForEach(0..<max(1, cues.count), id: \.self) { k in
                    Capsule().fill(!cues.isEmpty && k <= i ? Palette.ink : Palette.off)
                        .frame(height: 6)
                }
            }
            convergeButton
            HStack(spacing: 10) {
                WideButton("", icon: .previous, iconSize: 20) { model.command("show.back") }
                    .frame(width: 54)
                    .accessibilityLabel("previous cue")
                GoButton()
                WideButton("", icon: .stop, iconSize: 18) { model.command("show.stop") }
                    .frame(width: 54)
                    .accessibilityLabel("stop")
            }
        }
    }

    /// (§20 "Step 0") The opening: the opening look holds on the wall until GO, which converges onto the object or
    /// fades (or cuts) into the mapping. The controls pick the look, a preset of it and how GO leaves it.
    var convergeButton: some View {
        let target = model.scene?.objects.first(where: \.visible)?.name
        let intro = model.intro
        let live = model.hub.isLive
        let step0 = model.active.show?.transport.inIntro == true
        let presets = model.presets(intro.source.mode)
        let how = intro.converge ? "closes onto \(target ?? "the object") over \(introSeconds(intro.convergeDuration))"
            : intro.transition == "cut" ? "cuts to the mapping" : "fades into the mapping"
        return VStack(spacing: 10) {
            if step0 {
                Text("step 0 · the \(intro.source.mode) look holds. go \(intro.converge ? "converges" : intro.transition == "cut" ? "cuts" : "fades").")
                    .font(.pm(13)).tracking(0.2).foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 2)
            }
            WideButton("start sequence", icon: .converge, iconSize: 20, on: target != nil, height: 50, font: .pmMono(15, .bold)) {
                if target == nil { model.flash("Map an object first: the light needs a shape to close onto.") } else { model.startSequence() }
            }
            .accessibilityLabel("start sequence")
            .accessibilityHint("the \(intro.source.mode) look holds on the wall until go, then \(how)")
            Segmented(SceneMode.backdrops, selected: SceneMode.backdrops.firstIndex(of: intro.source.mode) ?? 0, height: 30) { i in
                model.editIntro { $0.source = .init(mode: SceneMode.backdrops[i]) }
            }
            .accessibilityLabel("opening look")
            .disabled(!live)
            if !presets.isEmpty {
                Menu {
                    Button("as it is") { model.editIntro { $0.source.presetId = nil } }
                    ForEach(presets) { p in Button(p.name) { model.editIntro { $0.source.presetId = p.id } } }
                } label: {
                    Pill { Text("preset · \(presets.first { $0.id == intro.source.presetId }?.name ?? "as it is")") }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .disabled(!live)
            }
            Toggle("converge into the object", isOn: Binding(get: { intro.converge }, set: { v in model.editIntro { $0.converge = v } }))
                .toggleStyle(PMSwitchStyle())
                .disabled(!live)
            if intro.converge {
                FillSlider("converge", icon: .softness, value: min(1, intro.convergeDuration / 10), enabled: live, format: { introSeconds(max(0.1, ($0 * 100).rounded() / 10)) }) { _ in
                } onEnd: { f in model.editIntro { $0.convergeDuration = max(0.1, (f * 100).rounded() / 10) } }
                Segmented(["its shape", "circle", "frame"], selected: Intro.froms.firstIndex(of: intro.from) ?? 0, height: 30) { i in
                    model.editIntro { $0.from = Intro.froms[i] }
                }
                .accessibilityLabel("converge from")
            } else {
                Segmented(["fade", "cut"], selected: intro.transition == "cut" ? 1 : 0, height: 30) { i in
                    model.editIntro { $0.transition = i == 1 ? "cut" : "fade" }
                }
                .accessibilityLabel("into the mapping")
                if intro.transition == "fade" {
                    FillSlider("fade", icon: .softness, value: min(1, intro.transitionMs / 3000), enabled: live, format: { introSeconds(($0 * 30).rounded() / 10) }) { _ in
                    } onEnd: { f in model.editIntro { $0.transitionMs = (f * 30).rounded() * 100 } }
                }
            }
            Text(target.map { _ in "the \(intro.source.mode) look holds until go, then \(how)" } ?? "map an object first")
                .font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 2)
        }
    }

    var autoMapCard: some View {
        Button { model.autoMapStep = 0; model.showAutoMap = true } label: {
            HStack(spacing: 14) {
                Icon(.wand, size: 22).frame(width: 44, height: 44).foregroundStyle(Color.black)
                    .background(Palette.ink, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("auto map with the camera").font(.pm(15)).tracking(0.2).foregroundStyle(Palette.ink)
                    Text("phone on a stand · codex or claude maps it").font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Icon(.chevronRight, size: 18).foregroundStyle(Palette.dim)
            }
            .padding(16)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: Objects

    func objectsSection(scene: PMKit.Scene?, transport: Transport) -> some View {
        let objects = scene?.objects ?? []
        let t = transport.playhead(serverNowMs: model.hub.serverNowMs)
        return VStack(spacing: 10) {
            CapRow("objects in scene", "tap ▸ to reveal")
            if objects.isEmpty {
                EmptyCard(title: "no objects yet", detail: "map them on the laptop, or let codex or claude map them with auto map.")
            } else {
                ListCard {
                    ForEach(Array(objects.enumerated()), id: \.element.id) { n, o in
                        let state = status(o, scene: scene, t: t)
                        let lit = state == "lit"
                        let prevLit = n > 0 && status(objects[n - 1], scene: scene, t: t) == "lit"
                        ListRow(o.name, meta: meta(o, scene: scene), on: lit, separator: n > 0 && !prevLit) {
                            Icon(icon(o), size: 22)
                                .frame(width: 44, height: 44)
                                .foregroundStyle(Palette.ink)
                                .background(lit ? Color.black : Palette.track)
                        } trailing: {
                            Text(state).capStyle().foregroundStyle(lit ? Color.black : Palette.dim).padding(.trailing, 6)
                            RowIconButton(.play, size: 16, label: "reveal \(o.name)") { reveal(o, scene: scene) }
                        }
                    }
                }
            }
        }
    }

    func tracks(of o: MapObject, scene: PMKit.Scene?) -> [Track] {
        let surfaces = Set(o.surfaces.map(\.id))
        return (scene?.timeline.tracks ?? []).filter {
            ($0.target.kind == "object" && $0.target.id == o.id) || ($0.target.kind == "surface" && surfaces.contains($0.target.id ?? ""))
        }
    }

    func clips(of o: MapObject, scene: PMKit.Scene?) -> [Clip] {
        let ids = Set(tracks(of: o, scene: scene).map(\.id))
        return (scene?.timeline.clips ?? []).filter { ids.contains($0.trackId) }
    }

    /// lit (a clip plays on it now, or holds its end, §20), waiting (one comes later), off.
    func status(_ o: MapObject, scene: PMKit.Scene?, t: Double) -> String {
        guard o.visible else { return "off" }
        let c = clips(of: o, scene: scene)
        let all = scene?.timeline.clips ?? []
        if c.contains(where: { x in x.inEffect(at: t, track: all.filter { $0.trackId == x.trackId }) }) { return "lit" }
        if c.contains(where: { $0.start > t }) { return "waiting" }
        return "off"
    }

    func meta(_ o: MapObject, scene: PMKit.Scene?) -> String {
        let objectTracks = Set((scene?.timeline.tracks ?? []).filter { $0.target.kind == "object" && $0.target.id == o.id }.map(\.id))
        let effects = o.effectCount + (scene?.timeline.clips ?? []).filter { objectTracks.contains($0.trackId) }.count
        let faces = o.faces
        if o.surfaces.count >= 1, o.surfaces.allSatisfy({ $0.kind == "poly" || $0.kind == "line" || $0.kind == "mask" }) {
            return o.surfaces.map(\.name).joined(separator: " · ")
        }
        var parts = ["\(faces) face\(faces == 1 ? "" : "s")"]
        if effects > 0 { parts.append("\(effects) effect\(effects == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }

    func icon(_ o: MapObject) -> LineIcon {
        let n = o.name.lowercased()
        if n.contains("lamp") { return .lamp }
        if n.contains("shelf") { return .shelf }
        if n.contains("plant") { return .plant }
        return .cube
    }

    /// Jumps to the object's first clip and plays.
    func reveal(_ o: MapObject, scene: PMKit.Scene?) {
        guard let start = clips(of: o, scene: scene).map(\.start).min() else {
            model.flash("\(o.name) has no clips on the timeline yet.")
            return
        }
        Task {
            do {
                try await model.hub.command("show.seek", ["t": .number(start)])
                try await model.hub.command("show.play")
            } catch { model.flash(error.localizedDescription) }
        }
    }
}

/// The big GO: ink, 64 pt, Roboto Mono 22 bold, with a strong haptic.
struct GoButton: View {
    @Environment(AppModel.self) private var model
    @State private var taps = 0

    var body: some View {
        Button {
            taps += 1
            model.command("show.go")
        } label: {
            HStack(spacing: 10) {
                Text("go").font(.pmMono(22, .bold)).tracking(2)
                Icon(.arrowRight, size: 22)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 64)
            .foregroundStyle(Color.black)
            .background(Palette.ink, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.impact(weight: .heavy, intensity: 1), trigger: taps) { _, _ in model.haptics }
        .accessibilityLabel("go to the next cue")
    }
}

/// "2.0 s" (step 0 durations).
func introSeconds(_ v: Double) -> String { String(format: "%.1f s", v) }
