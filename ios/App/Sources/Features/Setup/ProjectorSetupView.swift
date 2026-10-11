import SwiftUI
import PMKit
import PMDesign

/// Board `phone-setup`: the linked computer, orientation, flips, test pattern, master, blackout fade, this phone.
struct ProjectorSetupView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmUnpair = false

    var body: some View {
        @Bindable var model = model
        let setup = model.active.setup
        let output = model.devices.first { $0.role == "output" }
        let live = model.hub.isLive
        ZStack {
            Palette.ground.ignoresSafeArea()
            TabPage(bottom: 40) {
                HStack(spacing: 0) {
                    IconPill(.back, size: 18, label: "back") { dismiss() }
                    Text("projector").titleStyle(26).padding(.leading, 6 + 8)
                    Spacer()
                }
                .frame(height: 35)
                .padding(EdgeInsets(top: 4, leading: 4, bottom: 2, trailing: 4))
                linkedCard(output)
                orientation(setup, live: live)
                testPatternCard(setup)
                Card {
                    FillSlider("master", icon: .sun, value: setup?.master ?? 1, enabled: live) { model.setupParam("/master", .number(($0 * 100).rounded() / 100)) }
                    HStack(spacing: 12) {
                        Text("blackout fade").font(.pm(15)).tracking(0.2).foregroundStyle(Palette.ink)
                        Spacer()
                        let fades = [0, 500, 2000]
                        let current = fades.firstIndex(of: setup?.blackoutFadeMs ?? 500) ?? 1
                        Segmented(["cut", "0.5 s", "2 s"], selected: current) { n in
                            if !model.setupParam("/blackoutFadeMs", .number(Double(fades[n]))) { model.flash("Not connected to the projector.") }
                        }
                        .frame(width: 176)
                    }
                    .frame(minHeight: 44)
                    Text("blackout sends black but keeps the scene loaded. tap on air to bring it back.")
                        .font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(4.3).padding(.horizontal, 2)
                }
                Card(spacing: 4) {
                    Toggle("haptics", isOn: $model.haptics).toggleStyle(PMSwitchStyle())
                    Toggle("keep phone awake", isOn: $model.keepAwake).toggleStyle(PMSwitchStyle())
                }
                if model.debugScreen == nil {
                    Button { if model.demo { dismiss(); model.unpair() } else { confirmUnpair = true } } label: {
                        Text(model.demo ? "leave the demo" : "disconnect from \(model.serverName)").font(.pm(14)).foregroundStyle(Palette.dim).frame(maxWidth: .infinity).frame(height: 44)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .preferredColorScheme(.dark)
        .confirmationDialog("disconnect from \(model.serverName)?", isPresented: $confirmUnpair, titleVisibility: .visible) {
            Button("disconnect", role: .destructive) { dismiss(); model.unpair() }
        } message: {
            Text("this phone forgets the server and its token. you pair again with the code on the projector.")
        }
    }

    func linkedCard(_ output: Device?) -> some View {
        let linked = model.hub.isLive && (output?.online ?? model.demo)
        let t = output?.telemetry
        let size = t.map { "\($0.width)×\($0.height)" } ?? model.active.setup.map { "\($0.output.width)×\($0.output.height)" } ?? "1920×1080"
        let hz = t.map { "\(Int($0.refresh)) hz" } ?? "60 hz"
        let rtt = model.demo ? 12 : Int(model.hub.clock.medianRttMs ?? 0)
        return HStack(spacing: 14) {
            Icon(.projector, size: 28, stroke: 1.5)
                .frame(width: 56, height: 56)
                .foregroundStyle(Palette.ink)
                .background(Palette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text([model.serverName, output?.name].compactMap { $0 }.joined(separator: " · ")).font(.pm(15)).tracking(0.2).foregroundStyle(Palette.ink)
                Text("\(size) · \(hz) · \(rtt) ms").font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            GlassPill(tint: Palette.track) {
                OnAirDot(color: linked ? Palette.green : Palette.dim, pulse: false).shadow(radius: 0)
                Text(linked ? "linked" : "offline")
            }
        }
        .padding(16)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    func orientation(_ setup: Setup?, live: Bool) -> some View {
        let o = setup?.output ?? OutputConfig()
        let options: [(String, String, String)] = [("landscape", "landscape", "16:9"), ("portrait-cw", "portrait", "rotate cw"), ("portrait-ccw", "portrait", "rotate ccw")]
        return VStack(spacing: 10) {
            CapRow("orientation", "vertical videos")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(options, id: \.0) { id, name, meta in
                    let on = o.orientation == id
                    ImageCard(name, meta: meta, on: on, aspect: 1, action: { setOutput("/output/orientation", .string(id)) }) {
                        ZStack {
                            Palette.pill
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(on ? Palette.ink : Palette.metaOnLight, lineWidth: 2)
                                .frame(width: id == "landscape" ? 58 : 34, height: id == "landscape" ? 34 : 58)
                        }
                    }
                }
            }
            HStack(spacing: 10) {
                WideButton("flip horizontal", icon: .flipH, on: o.flipH) { setOutput("/output/flipH", .bool(!o.flipH)) }
                WideButton("flip vertical", icon: .rotate, on: o.flipV) { setOutput("/output/flipV", .bool(!o.flipV)) }
            }
        }
    }

    func setOutput(_ path: String, _ value: JSONValue) {
        if !model.setupParam(path, value) { model.flash("Not connected to the projector.") }
    }

    /// Test patterns switch back to off after 60 s on the server (protocol §1 `testPatternUntil`), so a grid never
    /// stays lit on camera. The card counts down and "keep on" renews it.
    func testPatternCard(_ setup: Setup?) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let now = model.hub.serverNowMs
            let active = setup?.activeTestPattern(serverNowMs: now) ?? "off"
            let left = setup?.testPatternRemaining(serverNowMs: now)
            Card {
                HStack {
                    Text("test pattern").capStyle()
                    Spacer()
                    if active != "off", let left {
                        Text("off in \(left) s").font(.pmMono(13)).foregroundStyle(Palette.dim).monospacedDigit()
                            .accessibilityLabel("switches off in \(left) seconds")
                    }
                }
                .padding(.horizontal, 2)
                HStack(spacing: 8) {
                    ForEach(["off", "grid", "white", "corners"], id: \.self) { p in
                        PillButton(p, on: active == p) { testPattern(p) }
                    }
                }
                if active != "off" {
                    HStack(spacing: 10) {
                        Text("goes dark after a minute so it never stays lit on camera.")
                            .font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        PillButton("keep on", icon: .plus) { testPattern(active) }
                    }
                    .padding(.horizontal, 2)
                }
            }
        }
    }

    /// Sends the pattern for 60 s; sending it again renews the timer.
    func testPattern(_ p: String) {
        guard let setup = model.active.setup else { return }
        model.command("setup.testPattern", ["setupId": .string(setup.id), "pattern": .string(p), "seconds": 60])
    }
}
