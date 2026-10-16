import SwiftUI
import PMKit
import PMDesign

/// One slot on a scrub rail: an option, the group it belongs to (a gap and a firmer haptic between groups), and its
/// small picture.
struct ScrubEntry: Identifiable {
    var id: String
    var name: String
    var group: String
    var thumb: AnyView

    init<T: View>(id: String, name: String, group: String, @ViewBuilder thumb: () -> T) {
        self.id = id
        self.name = name
        self.group = group
        self.thumb = AnyView(thumb())
    }
}

/// The one-finger scrub rail on the right edge of a tab: every option, small, top to bottom. Slide a finger along it and
/// each option goes on the wall as the finger passes it, with a selection tick per option and a firmer tap at each new
/// group; a bigger picture with the name follows the finger. The arrow at its top folds it into a thin tab (and back),
/// remembered per rail.
struct ScrubRail: View {
    var entries: [ScrubEntry]
    /// the option on the wall
    var current: String?
    var hideKey: String
    var pick: (ScrubEntry) -> Void
    @Environment(AppModel.self) private var model
    @AppStorage private var hidden: Bool
    /// the option under the finger while it is down
    @State private var index: Int?
    @State private var lastSent = Date.distantPast
    @State private var pending: ScrubEntry?
    @State private var flush: Task<Void, Never>?

    /// sends at most this often while scrubbing; the last option under the finger always goes out
    private static let minInterval: TimeInterval = 0.05
    private static let gap: CGFloat = 5
    private static let cap: CGFloat = 30

    init(entries: [ScrubEntry], current: String?, hideKey: String, pick: @escaping (ScrubEntry) -> Void) {
        self.entries = entries
        self.current = current
        self.hideKey = hideKey
        self.pick = pick
        _hidden = AppStorage(wrappedValue: false, "pm.rail.hidden." + hideKey)
    }

    var body: some View {
        GeometryReader { geo in
            let railH = max(40, geo.size.height - Self.cap - 4)
            let layout = Layout(entries: entries, height: railH)
            let active = index != nil
            ZStack(alignment: .topTrailing) {
                if hidden {
                    Button { withAnimation(.snappy(duration: 0.2)) { hidden = false } } label: {
                        Capsule().fill(Palette.ink.opacity(0.55)).frame(width: 5, height: 64)
                            .frame(width: 22, height: 96)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(maxHeight: .infinity)
                    .accessibilityLabel("show the scrub rail")
                } else {
                    VStack(spacing: 4) {
                        Button { withAnimation(.snappy(duration: 0.2)) { hidden = true } } label: {
                            Icon(.chevronRight, size: 13)
                                .foregroundStyle(Palette.ink)
                                .frame(width: active ? 46 : 22, height: Self.cap)
                                .background(Palette.glass, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("hide the scrub rail")
                        rail(layout: layout, active: active)
                            .frame(width: active ? 46 : 22, height: railH)
                            .contentShape(Rectangle())
                            .highPriorityGesture(
                                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                                    .onChanged { v in scrub(to: layout.index(at: v.location.y)) }
                                    .onEnded { _ in end() }
                            )
                    }
                    if let i = index, entries.indices.contains(i) {
                        bubble(entries[i])
                            .offset(x: -58, y: min(max(0, Self.cap + 4 + layout.mid(i) - 62), geo.size.height - 124))
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .animation(.snappy(duration: 0.18), value: active)
        }
        .sensoryFeedback(trigger: index) { old, new in
            guard model.haptics, let new, entries.indices.contains(new) else { return nil }
            if let old, entries.indices.contains(old), entries[new].group != entries[old].group { return .impact(weight: .medium, intensity: 0.9) }
            return .selection
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("scrub rail")
        .accessibilityValue(entries.first { $0.id == current }?.name ?? "none")
        .accessibilityAdjustableAction { dir in
            let cur = entries.firstIndex { $0.id == current } ?? -1
            let next = dir == .increment ? cur + 1 : cur - 1
            if entries.indices.contains(next) { pick(entries[next]) }
        }
    }

    /// The column of small pictures, a gap between groups, the one on the wall ringed.
    func rail(layout: Layout, active: Bool) -> some View {
        let shown = index.flatMap { entries.indices.contains($0) ? entries[$0].id : nil } ?? current
        return ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: active ? 12 : 8, style: .continuous).fill(Palette.glass)
            ForEach(Array(entries.enumerated()), id: \.element.id) { i, e in
                let on = shown == e.id
                e.thumb
                    .frame(width: (active ? 46 : 22) - 6, height: max(2, layout.size - 1))
                    .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
                    .overlay {
                        if on { RoundedRectangle(cornerRadius: 2, style: .continuous).stroke(Palette.ink, lineWidth: 1.5) }
                    }
                    .opacity(on ? 1 : active ? 0.75 : 0.55)
                    .offset(y: layout.top(i))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: active ? 12 : 8, style: .continuous))
    }

    /// What the finger is on: bigger, with its name and group.
    func bubble(_ e: ScrubEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            e.thumb
                .frame(width: 148, height: 92)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(e.name).font(.pm(12)).foregroundStyle(Palette.ink).lineLimit(1)
            Text(e.group).font(.pm(11)).foregroundStyle(Palette.dim).lineLimit(1)
        }
        .padding(8)
        .frame(width: 164, alignment: .leading)
        .background(Palette.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    func scrub(to i: Int) {
        guard entries.indices.contains(i), i != index else { return }
        index = i
        let e = entries[i]
        if Date().timeIntervalSince(lastSent) >= Self.minInterval {
            send(e)
        } else {
            pending = e
            if flush == nil {
                flush = Task { @MainActor in
                    try? await Task.sleep(for: .seconds(Self.minInterval))
                    flush = nil
                    if let p = pending { send(p) }
                }
            }
        }
    }

    func end() {
        flush?.cancel()
        flush = nil
        if let p = pending { send(p) }
        index = nil
    }

    func send(_ e: ScrubEntry) {
        pending = nil
        lastSent = Date()
        pick(e)
    }

    /// Where each option sits on the rail: equal slots, a gap between groups.
    struct Layout {
        var tops: [CGFloat] = []
        var size: CGFloat = 0

        init(entries: [ScrubEntry], height: CGFloat) {
            guard !entries.isEmpty else { return }
            var breaks = 0
            for i in entries.indices.dropFirst() where entries[i].group != entries[i - 1].group { breaks += 1 }
            let inner = height - 6 - CGFloat(breaks) * ScrubRail.gap
            size = max(1, inner / CGFloat(entries.count))
            var y: CGFloat = 3
            for i in entries.indices {
                if i > 0, entries[i].group != entries[i - 1].group { y += ScrubRail.gap }
                tops.append(y)
                y += size
            }
        }

        func top(_ i: Int) -> CGFloat { tops.indices.contains(i) ? tops[i] : 0 }
        func mid(_ i: Int) -> CGFloat { top(i) + size / 2 }

        /// The option nearest a y on the rail.
        func index(at y: CGFloat) -> Int {
            guard !tops.isEmpty else { return -1 }
            var best = 0
            var dist = CGFloat.infinity
            for (i, t) in tops.enumerated() {
                let d = abs(t + size / 2 - y)
                if d < dist { dist = d; best = i }
            }
            return best
        }
    }
}

extension View {
    /// Puts a scrub rail on the right edge of a tab, clear of the header and the bottom island.
    func scrubRail(_ rail: ScrubRail) -> some View {
        overlay(alignment: .trailing) {
            rail.padding(.top, 130).padding(.bottom, 150).padding(.trailing, 2)
        }
    }
}
