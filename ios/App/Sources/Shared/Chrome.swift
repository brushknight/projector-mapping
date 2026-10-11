import SwiftUI
import PMKit
import PMDesign
import PMPreview

/// `.scroll`: a tab's page (64 pt from the top, 16 pt sides, room for the island at the bottom, 16 pt gaps).
struct TabPage<Content: View>: View {
    var bottom: CGFloat
    var content: Content

    init(bottom: CGFloat = 132, @ViewBuilder content: () -> Content) {
        self.bottom = bottom
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) { content }
                .padding(.top, 64)
                .padding(.horizontal, 16)
                .padding(.bottom, bottom)
        }
        .scrollIndicators(.hidden)
        .ignoresSafeArea(edges: [.top, .bottom])
        .debugScroll()
    }
}

/// `.hd`: the large mono title, the projector settings button and the on-air pill.
struct TabHeader: View {
    var title: String
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 8) {
            Text(title).titleStyle()
            Spacer(minLength: 8)
            IconPill(.projector, size: 19, label: "projector settings") { model.showSetup = true }
            OnAirPill()
        }
        .frame(height: 35)
        .padding(EdgeInsets(top: 4, leading: 4, bottom: 2, trailing: 4))
    }
}

/// The on-air pill: tap to black out (cmd `show.blackout`) and to bring the scene back.
struct OnAirPill: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { model.toggleBlackout() } label: {
            Pill {
                switch (model.hub.status, model.active.onAir) {
                case (.online, true), (.demo, true):
                    OnAirDot()
                    Text("on air")
                case (.online, false), (.demo, false):
                    OnAirDot(color: Palette.dim, pulse: false)
                    Text("blackout")
                case (.connecting, _):
                    OnAirDot(color: Palette.dim, pulse: true)
                    Text("connecting")
                default:
                    OnAirDot(color: Palette.dim, pulse: false)
                    Text("offline")
                }
            }
            .padding(.horizontal, 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.active.onAir ? "on air, tap to black out" : "blacked out, tap to go on air")
        .sensoryFeedback(.impact(weight: .medium), trigger: model.active.onAir) { _, _ in model.haptics }
    }
}

/// `.hero`: radius 26 with glass labels on top. Shows the server's `/preview` page, or `fallback` when there is no
/// server (demo) or the page fails.
struct Hero<Fallback: View, Leading: View, Trailing: View>: View {
    var aspect: CGFloat
    var mode: String
    var layer: String?
    var fallback: Fallback
    var leading: Leading
    var trailing: Trailing
    @Environment(AppModel.self) private var model

    init(aspect: CGFloat = 344 / 190, mode: String = "hero", layer: String? = nil, @ViewBuilder fallback: () -> Fallback,
         @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.aspect = aspect; self.mode = mode; self.layer = layer
        self.fallback = fallback(); self.leading = leading(); self.trailing = trailing()
    }

    var body: some View {
        Palette.hero
            .aspectRatio(aspect, contentMode: .fit)
            .overlay {
                if model.demo || model.api == nil {
                    fallback
                } else {
                    PreviewWebView(url: model.api?.previewURL(width: 1110, mode: mode, layer: layer)) { fallback }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(alignment: .top) {
                HStack(spacing: 8) {
                    leading
                    Spacer(minLength: 0)
                    trailing
                }
                .padding(12)
            }
            .overlay {
                if !model.active.onAir && model.hub.isLive {
                    RoundedRectangle(cornerRadius: 26, style: .continuous).fill(Color.black.opacity(0.55))
                        .overlay(GlassPill { Text("blackout · tap on air to bring it back") })
                        .allowsHitTesting(false)
                }
            }
    }
}

/// The hero's left label: "● on air · <detail>".
struct OnAirLabel: View {
    var detail: String?
    @Environment(AppModel.self) private var model

    var body: some View {
        GlassPill {
            if model.hub.isLive && model.active.onAir && model.mode == model.tab.rawValue { OnAirDot() } else { OnAirDot(color: Palette.dim, pulse: false) }
            Text(([status] + [detail].compactMap { $0 }).joined(separator: " · "))
        }
    }

    var status: String {
        guard model.hub.isLive else { return model.hub.status == .connecting ? "connecting" : "offline" }
        guard model.active.onAir else { return "blackout" }
        return model.mode == model.tab.rawValue ? "on air" : "\(model.mode) on air"
    }
}

/// "16:9 · 1080p" for the active setup.
struct FormatLabel: View {
    @Environment(AppModel.self) private var model
    var body: some View { GlassPill { Text(Fmt.format(model.active.setup?.output)) } }
}

/// `.chips` with wrapping, for presets.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += row + spacing; row = 0 }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            row = max(row, size.height)
        }
        return CGSize(width: min(width, maxX), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

/// Presets of one mode: chips (tap applies, hold to delete) and "save".
struct PresetsSection: View {
    var mode: String
    @Environment(AppModel.self) private var model
    @State private var naming = false
    @State private var name = ""

    var body: some View {
        let presets = model.presets(mode)
        let last = model.presetsVersion >= 0 ? model.lastPreset(mode) : nil
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("presets").capStyle()
                Spacer()
                PillButton("save", icon: .plus) { name = ""; naming = true }
            }
            .padding(.horizontal, 4)
            if presets.isEmpty {
                Text("save this look to bring it back with one tap.").font(.pm(13)).foregroundStyle(Palette.dim).padding(.horizontal, 4)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(presets) { p in
                        PillButton(p.name, on: p.id == last) { model.apply(p) }
                            .contextMenu {
                                Button("delete preset", role: .destructive) {
                                    try? model.db.removePreset(p.id)
                                    if !p.id.hasPrefix("tmp_") { model.hub.enqueue(.deletePreset(id: p.id)) }
                                }
                            }
                    }
                }
            }
        }
        .alert("save preset", isPresented: $naming) {
            TextField("name", text: $name)
            Button("save") {
                let n = name.trimmingCharacters(in: .whitespaces)
                if !n.isEmpty { model.savePreset(name: n, mode: mode) }
            }
            Button("cancel", role: .cancel) {}
        } message: {
            Text("saves this tab's look.")
        }
    }
}

/// An empty state card for a tab whose layer is missing.
struct EmptyCard: View {
    var title: String
    var detail: String
    var body: some View {
        Card(spacing: 6) {
            Text(title).font(.pm(15)).foregroundStyle(Palette.ink)
            Text(detail).font(.pm(13)).foregroundStyle(Palette.dim).lineSpacing(3)
        }
    }
}

extension View {
    /// `-pm-scroll <points>` scrolls the opened screen's page (screenshots of lower parts of a board).
    func debugScroll() -> some View { modifier(DebugScroll()) }
}

struct DebugScroll: ViewModifier {
    func body(content: Content) -> some View {
        let pt = UserDefaults.standard.double(forKey: "pm-scroll")
        if pt > 0 {
            content.scrollPosition(.constant(ScrollPosition(point: CGPoint(x: 0, y: pt))))
        } else {
            content
        }
    }
}
