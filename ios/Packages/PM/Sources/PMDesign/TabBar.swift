import SwiftUI

/// `.island`: the floating tab capsule (16 pt from the sides, 24 pt from the bottom, 64 pt tall). The active tab gets
/// a soft highlight, a slightly larger icon and a dot instead of its label. The tab whose mode is on air carries a
/// small red dot in its top right corner.
public struct IslandTabBar<Tab: Hashable>: View {
    public struct Item {
        public var tab: Tab
        public var title: String
        public var icon: LineIcon
        public init(_ tab: Tab, _ title: String, _ icon: LineIcon) { self.tab = tab; self.title = title; self.icon = icon }
    }

    var items: [Item]
    var selection: Tab
    var onAir: Tab?
    var onSelect: (Tab) -> Void
    @Environment(\.hapticsEnabled) private var haptics

    public init(_ items: [Item], selection: Tab, onAir: Tab? = nil, onSelect: @escaping (Tab) -> Void) {
        self.items = items; self.selection = selection; self.onAir = onAir; self.onSelect = onSelect
    }

    public var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.tab) { item in
                let on = item.tab == selection
                Button { onSelect(item.tab) } label: {
                    VStack(spacing: 3) {
                        Icon(item.icon, size: on ? 23 : 21)
                        if !on { Text(item.title).font(.pm(11)).tracking(0.2) }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .foregroundStyle(on ? Palette.ink : Palette.dim)
                    .background {
                        if on { RoundedRectangle(cornerRadius: 26, style: .continuous).fill(Color.white.opacity(0.13)) }
                    }
                    .overlay(alignment: .bottom) {
                        if on { Circle().fill(Palette.ink).frame(width: 4, height: 4).padding(.bottom, 5) }
                    }
                    .overlay(alignment: .topTrailing) {
                        if item.tab == onAir {
                            Circle().fill(Palette.red).frame(width: 6, height: 6)
                                .shadow(color: Palette.red.opacity(0.8), radius: 3)
                                .padding(.top, 9).padding(.trailing, 12)
                                .accessibilityHidden(true)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.tab == onAir ? "\(item.title), on air" : item.title)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(5)
        .frame(height: 64)
        .background {
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).fill(Color(red: 30 / 255, green: 30 / 255, blue: 32 / 255).opacity(0.72)))
                .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                .shadow(color: .black.opacity(0.6), radius: 16, y: 12)
        }
        .sensoryFeedback(trigger: selection) { _, _ in haptics ? .selection : nil }
    }
}
