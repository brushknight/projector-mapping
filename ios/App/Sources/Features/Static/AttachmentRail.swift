import SwiftUI
import PMKit
import PMDesign

/// The one-finger scrub rail on the right edge of the static tab: every attachment, small, top to bottom in browse order
/// (windows, nature, sky, patterns, beams), with "full frame" (nothing in front of the light) at the top. Slide a finger along it and each plate goes in front of the light as the
/// finger passes it, with a selection tick per plate and a firmer tap at each new collection. It replaces the selected
/// attachment and keeps its placement, like a tap in the browser.
struct AttachmentRail: View {
    var mode: String
    @Binding var selected: String?
    @Environment(AppModel.self) private var model
    /// the plate under the finger while it is down
    @State private var index: Int?
    @State private var lastSent = Date.distantPast
    /// the plate to send next (nil inside: the full frame), when one is waiting
    @State private var pending: GoboItem??
    /// the attachment the full frame took off, so scrubbing back onto a plate keeps its placement
    @State private var kept: Attachment?
    @State private var flush: Task<Void, Never>?

    /// picks at most this often while scrubbing; the last one under the finger always goes out
    private static let minInterval: TimeInterval = 0.05
    private static let gap: CGFloat = 5

    /// One slot on the rail: a plate, or the full frame (item nil).
    struct Entry: Identifiable {
        var item: GoboItem?
        var category: GoboCategory
        var id: String { item?.id ?? "" }
    }

    static let fullFrame = Entry(item: nil, category: GoboCategory(id: "", name: "nothing in front of the light"))

    var body: some View {
        let cats = model.catalog.goboCategories.filter { !model.catalog.gobos(in: $0.id).isEmpty }
        let entries = [Self.fullFrame] + cats.flatMap { c in model.catalog.gobos(in: c.id).map { Entry(item: $0, category: c) } }
        let onWall = model.attachments(mode).last?.gobo ?? ""
        GeometryReader { geo in
            let layout = Layout(entries: entries, height: geo.size.height)
            let active = index != nil
            ZStack(alignment: .topTrailing) {
                rail(entries, layout: layout, onWall: onWall, active: active)
                    .frame(width: active ? 46 : 20, height: geo.size.height)
                    .contentShape(Rectangle())
                    .highPriorityGesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .local)
                            .onChanged { v in scrub(to: layout.index(at: v.location.y), entries) }
                            .onEnded { _ in end() }
                    )
                if let i = index, entries.indices.contains(i) {
                    bubble(entries[i])
                        .offset(x: -58, y: min(max(0, layout.mid(i) - 62), geo.size.height - 124))
                        .allowsHitTesting(false)
                        .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .animation(.snappy(duration: 0.18), value: active)
        }
        .sensoryFeedback(trigger: index) { old, new in
            guard model.haptics, let new, entries.indices.contains(new) else { return nil }
            if let old, entries.indices.contains(old), entries[new].category.id != entries[old].category.id { return .impact(weight: .medium, intensity: 0.9) }
            return .selection
        }
        .accessibilityElement()
        .accessibilityLabel("attachment rail")
        .accessibilityValue(entries.first { $0.id == onWall }?.item?.name ?? "full frame")
        .accessibilityAdjustableAction { dir in
            let cur = entries.firstIndex { $0.id == onWall } ?? -1
            let next = dir == .increment ? cur + 1 : cur - 1
            if entries.indices.contains(next) { send(entries[next].item) }
        }
    }

    /// The column of small plates, a gap between collections, the one on the wall ringed.
    func rail(_ entries: [Entry], layout: Layout, onWall: String, active: Bool) -> some View {
        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: active ? 12 : 8, style: .continuous).fill(Palette.glass)
            ForEach(Array(entries.enumerated()), id: \.element.id) { i, e in
                let on = (index.map { entries.indices.contains($0) ? entries[$0].id : nil } ?? onWall) == e.id
                Group {
                    if e.item == nil { Palette.ink } else { GoboThumb(gobo: e.id) }
                }
                    .frame(width: (active ? 46 : 20) - 6, height: max(2, layout.size - 1))
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

    /// What the finger is on: the plate, bigger, with its name and collection.
    func bubble(_ e: Entry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Group {
                if e.item == nil { Palette.ink.overlay { Icon(.sun, size: 28).foregroundStyle(Palette.ground) } } else { GoboThumb(gobo: e.id) }
            }
                .frame(width: 148, height: 92)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(e.item?.name ?? "full frame").font(.pm(12)).foregroundStyle(Palette.ink).lineLimit(1)
            Text(e.category.name).font(.pm(11)).foregroundStyle(Palette.dim).lineLimit(1)
        }
        .padding(8)
        .frame(width: 164, alignment: .leading)
        .background(Palette.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    func scrub(to i: Int, _ entries: [Entry]) {
        guard entries.indices.contains(i), i != index else { return }
        index = i
        let g = entries[i].item
        if Date().timeIntervalSince(lastSent) >= Self.minInterval {
            send(g)
        } else {
            pending = g
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

    /// Puts this plate in front of the light in place of the selected attachment, keeping its placement (§16); nil takes
    /// every attachment off (the full frame is lit).
    func send(_ g: GoboItem?) {
        pending = nil
        lastSent = Date()
        guard model.sceneId != nil else { model.flash("No scene is active on the projector."); return }
        let list = model.attachments(mode)
        guard let g else {
            if list.isEmpty { return }
            kept = list.first { $0.id == selected } ?? list.last
            model.pickFast(path: ScenePath.attachments(mode), value: [], fallback: .replaceAttachments(mode: mode, attachments: []))
            selected = nil
            return
        }
        if list.count == 1, list[0].gobo == g.id { return }
        let a = AttachmentSwap.replacing(list.first { $0.id == selected } ?? list.last ?? kept, with: g, catalog: model.catalog)
        guard let json = try? JSONValue(encoding: a) else { return }
        model.pickFast(path: ScenePath.attachments(mode), value: [json], fallback: .replaceAttachments(mode: mode, attachments: [json]))
        selected = a.id
    }

    /// Where each plate sits on the rail: equal slots, a gap between collections.
    struct Layout {
        var tops: [CGFloat] = []
        var size: CGFloat = 0

        init(entries: [Entry], height: CGFloat) {
            guard !entries.isEmpty else { return }
            var breaks = 0
            for i in entries.indices.dropFirst() where entries[i].category.id != entries[i - 1].category.id { breaks += 1 }
            let inner = height - 6 - CGFloat(breaks) * AttachmentRail.gap
            size = max(1, inner / CGFloat(entries.count))
            var y: CGFloat = 3
            for i in entries.indices {
                if i > 0, entries[i].category.id != entries[i - 1].category.id { y += AttachmentRail.gap }
                tops.append(y)
                y += size
            }
        }

        func top(_ i: Int) -> CGFloat { tops.indices.contains(i) ? tops[i] : 0 }
        func mid(_ i: Int) -> CGFloat { top(i) + size / 2 }

        /// The plate nearest a y on the rail.
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
