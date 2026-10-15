import SwiftUI
import PMKit

// The phone v4 kit (shared CSS of design/html/phone/*.dc.html). Each view notes the class it ports.

extension EnvironmentValues {
    /// Projector settings › haptics.
    @Entry public var hapticsEnabled: Bool = true
}

/// `.rd`: the red on-air dot, 8 pt with a glow, pulsing (opacity 1 → .35 over 1.6 s).
public struct OnAirDot: View {
    var color: Color
    var pulse: Bool
    @State private var dim = false

    public init(color: Color = Palette.red, pulse: Bool = true) { self.color = color; self.pulse = pulse }

    public var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .shadow(color: pulse ? color : .clear, radius: 4)
            .opacity(dim ? 0.35 : 1)
            .onAppear {
                guard pulse else { return }
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true }
            }
    }
}

/// `.pill` (34 pt, #1C1C1E, 13 px) and `.pill.on` (ink, black).
public struct Pill<Content: View>: View {
    var on: Bool
    var height: CGFloat
    var content: Content

    public init(on: Bool = false, height: CGFloat = 34, @ViewBuilder content: () -> Content) {
        self.on = on; self.height = height; self.content = content()
    }

    public var body: some View {
        HStack(spacing: 7) { content }
            .font(.pm(13))
            .lineLimit(1)
            .padding(.horizontal, 13)
            .frame(height: height)
            .foregroundStyle(on ? Color.black : Palette.ink)
            .background(on ? Palette.ink : Palette.pill, in: Capsule())
            .contentShape(Capsule())
    }
}

/// A tappable `.pill` with text (and an optional leading icon).
public struct PillButton: View {
    var title: String
    var icon: LineIcon?
    var iconSize: CGFloat
    var on: Bool
    var action: () -> Void

    public init(_ title: String, icon: LineIcon? = nil, iconSize: CGFloat = 15, on: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.iconSize = iconSize; self.on = on; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Pill(on: on) {
                if let icon { Icon(icon, size: iconSize) }
                Text(title)
            }
        }
        .buttonStyle(.plain)
    }
}

/// `.pill.icon`: a 34 pt circle with one icon.
public struct IconPill: View {
    var icon: LineIcon
    var size: CGFloat
    var diameter: CGFloat
    var on: Bool
    var label: String
    var action: () -> Void

    public init(_ icon: LineIcon, size: CGFloat = 19, diameter: CGFloat = 34, on: Bool = false, label: String, action: @escaping () -> Void) {
        self.icon = icon; self.size = size; self.diameter = diameter; self.on = on; self.label = label; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Icon(icon, size: size)
                .frame(width: diameter, height: diameter)
                .foregroundStyle(on ? Color.black : Palette.ink)
                .background(on ? Palette.ink : Palette.pill, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// `.glass`: 28 pt capsule, black 45 % over a blur, 12 px.
public struct GlassPill<Content: View>: View {
    var content: Content
    var tint: Color?
    public init(tint: Color? = nil, @ViewBuilder content: () -> Content) { self.tint = tint; self.content = content() }

    public var body: some View {
        HStack(spacing: 7) { content }
            .font(.pm(12))
            .lineLimit(1)
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 11)
            .frame(height: 28)
            .background {
                if let tint { Capsule().fill(tint) } else {
                    Capsule().fill(.ultraThinMaterial).overlay(Capsule().fill(Palette.glass))
                }
            }
    }
}

/// `.card`: #141415, radius 24, padding 16, gap 14.
public struct Card<Content: View>: View {
    var spacing: CGFloat
    var padding: EdgeInsets
    var content: Content

    public init(spacing: CGFloat = 14, padding: EdgeInsets = EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16), @ViewBuilder content: () -> Content) {
        self.spacing = spacing; self.padding = padding; self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// `.row2` with two `.cap` labels (section headers: "ATTACHMENT  8").
public struct CapRow<Trailing: View>: View {
    var title: String
    var padding: CGFloat
    var trailing: Trailing

    public init(_ title: String, padding: CGFloat = 4, @ViewBuilder trailing: () -> Trailing) {
        self.title = title; self.padding = padding; self.trailing = trailing()
    }

    public var body: some View {
        HStack {
            Text(title).capStyle()
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, padding)
    }
}

extension CapRow where Trailing == CapText {
    public init(_ title: String, _ trailing: String, padding: CGFloat = 4) {
        self.init(title, padding: padding) { CapText(trailing) }
    }
}

/// A `.cap` label.
public struct CapText: View {
    var text: String
    public init(_ text: String) { self.text = text }
    public var body: some View { Text(text).capStyle() }
}

/// `.det`: 21 detent dots under a fill slider (every 5 %, brighter every 25 %).
public struct DetentDots: View {
    public init() {}
    public var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<21, id: \.self) { i in
                Circle().fill(i % 5 == 0 ? Palette.detentMajor : Palette.detent).frame(width: 3, height: 3)
                if i < 20 { Spacer(minLength: 0) }
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 3)
    }
}

/// `.big`: the 54 pt fill slider. White fill from the left; label and value in difference blend; relative drags;
/// a tick at every 10 % and a stronger one at 0 and 100 %. `value` is a 0…1 fraction.
public struct FillSlider: View {
    var label: String
    var icon: LineIcon
    var value: Double
    var format: (Double) -> String
    var enabled: Bool
    var detents: Bool
    var onChange: (Double) -> Void
    var onEnd: ((Double) -> Void)?

    @State private var start: Double?
    @State private var local: Double?
    @Environment(\.hapticsEnabled) private var haptics

    public init(_ label: String, icon: LineIcon, value: Double, enabled: Bool = true, detents: Bool = true,
                format: @escaping (Double) -> String = { "\(Int(($0 * 100).rounded()))%" },
                onChange: @escaping (Double) -> Void, onEnd: ((Double) -> Void)? = nil) {
        self.label = label; self.icon = icon; self.value = value; self.enabled = enabled; self.detents = detents
        self.format = format; self.onChange = onChange; self.onEnd = onEnd
    }

    public var body: some View {
        let v = min(1, max(0, local ?? value))
        VStack(spacing: 7) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Palette.track
                    Palette.ink.frame(width: g.size.width * v)
                    HStack(spacing: 10) {
                        Icon(icon, size: 18)
                        Text(label).font(.pm(14)).tracking(0.2)
                    }
                    .padding(.leading, 16)
                    .foregroundStyle(.white)
                    .blendMode(.difference)
                    Text(enabled ? format(v) : "not connected")
                        .font(enabled ? .pmMono(15, .medium) : .pm(13))
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.trailing, 16)
                        .foregroundStyle(.white)
                        .blendMode(.difference)
                }
                .compositingGroup()
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .opacity(enabled ? 1 : 0.55)
                .contentShape(Rectangle())
                .horizontalPan(enabled: enabled) { p in
                    switch p.phase {
                    case .began, .changed:
                        if start == nil { start = value }
                        let next = min(1, max(0, (start ?? value) + p.translation.width / max(1, g.size.width)))
                        local = next
                        onChange(next)
                    case .tap:
                        break
                    case .ended, .cancelled:
                        let last = local
                        start = nil
                        if let last { onEnd?(last) }
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(350))
                            if start == nil { local = nil }
                        }
                    }
                }
            }
            .frame(height: 54)
            if detents { DetentDots() }
        }
        .sensoryFeedback(trigger: Int((v * 10).rounded(.down))) { old, new in
            guard haptics, local != nil else { return nil }
            if new >= 10 || new <= 0 { return .impact(weight: .heavy, intensity: 1) }
            return .selection
        }
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue(enabled ? format(v) : "not connected")
        .accessibilityAdjustableAction { dir in
            guard enabled else { return }
            let next = min(1, max(0, value + (dir == .increment ? 0.05 : -0.05)))
            onChange(next)
            onEnd?(next)
        }
    }
}

/// `.strip`: a 40 pt gradient strip with a ring knob (temperature, tint, hue, saturation). Absolute drags.
public struct StripSlider: View {
    var gradient: Gradient
    var value: Double
    var enabled: Bool
    var onChange: (Double) -> Void
    @Environment(\.hapticsEnabled) private var haptics
    @State private var dragging = false

    public init(gradient: Gradient, value: Double, enabled: Bool = true, onChange: @escaping (Double) -> Void) {
        self.gradient = gradient; self.value = value; self.enabled = enabled; self.onChange = onChange
    }

    public var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                LinearGradient(gradient: gradient, startPoint: .leading, endPoint: .trailing)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                Circle()
                    .strokeBorder(.white, lineWidth: 3)
                    .frame(width: 26, height: 26)
                    .shadow(color: .black.opacity(0.4), radius: 0.5)
                    .shadow(color: .black.opacity(0.5), radius: 4, y: 2)
                    .offset(x: g.size.width * min(1, max(0, value)) - 13)
            }
            .contentShape(Rectangle())
            .opacity(enabled ? 1 : 0.5)
            // A sideways drag moves the knob to the finger; a tap jumps there. Vertical swipes scroll the page.
            // A tap only counts when the page was still (the lock gives `.tap`): catching a scroll never moves it.
            .horizontalPan(enabled: enabled) { p in
                switch p.phase {
                case .began, .changed:
                    dragging = true
                    onChange(min(1, max(0, p.location.x / max(1, g.size.width))))
                case .tap:
                    onChange(min(1, max(0, p.location.x / max(1, g.size.width))))
                case .ended, .cancelled:
                    dragging = false
                }
            }
        }
        .frame(height: 40)
        .sensoryFeedback(trigger: Int((value * 10).rounded(.down))) { _, _ in haptics && dragging ? .selection : nil }
    }
}

/// `.seg`: a segmented control (#1C1C1E, radius 14, padding 3; selected = ink pill with a shadow).
public struct Segmented: View {
    var options: [String]
    var selected: Int
    var height: CGFloat
    var onSelect: (Int) -> Void
    @Environment(\.hapticsEnabled) private var haptics

    public init(_ options: [String], selected: Int, height: CGFloat = 34, onSelect: @escaping (Int) -> Void) {
        self.options = options; self.selected = selected; self.height = height; self.onSelect = onSelect
    }

    public var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { i, title in
                Button { onSelect(i) } label: {
                    Text(title)
                        .font(.pm(13))
                        .frame(maxWidth: .infinity)
                        .frame(height: height)
                        .foregroundStyle(i == selected ? Color.black : Palette.dim)
                        .background {
                            if i == selected {
                                RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Palette.ink)
                                    .shadow(color: .black.opacity(0.4), radius: 4, y: 2)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(i == selected ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Palette.pill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .sensoryFeedback(trigger: selected) { _, _ in haptics ? .selection : nil }
    }
}

/// The selection ring of tiles and cards: 2 pt black, then 2 pt ink (`box-shadow: 0 0 0 2px #000, 0 0 0 4px ink`).
extension View {
    public func selectionRing(_ on: Bool, radius: CGFloat) -> some View {
        overlay {
            if on {
                RoundedRectangle(cornerRadius: radius + 4, style: .continuous).strokeBorder(Palette.ink, lineWidth: 2).padding(-4)
                RoundedRectangle(cornerRadius: radius + 2, style: .continuous).strokeBorder(Color.black, lineWidth: 2).padding(-2)
            } else {
                RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
            }
        }
    }
}

/// `.tile`: a square thumbnail (radius 18) with a 12 px name under it.
public struct Tile<Art: View>: View {
    var name: String
    var on: Bool
    var art: Art
    var action: () -> Void

    public init(_ name: String, on: Bool, action: @escaping () -> Void, @ViewBuilder art: () -> Art) {
        self.name = name; self.on = on; self.action = action; self.art = art()
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Color.clear
                    .aspectRatio(1, contentMode: .fit)
                    .overlay { art }
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .selectionRing(on, radius: 18)
                Text(name).font(.pm(12)).tracking(0.2).lineLimit(1)
                    .foregroundStyle(on ? Palette.ink : Palette.dim)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// `.fxt`: a square light-FX tile (icon 26 + name).
public struct FXTile: View {
    var name: String
    var icon: LineIcon
    var on: Bool
    var action: () -> Void

    public init(_ name: String, icon: LineIcon, on: Bool, action: @escaping () -> Void) {
        self.name = name; self.icon = icon; self.on = on; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Icon(icon, size: 26)
                Text(name).font(.pm(12)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .foregroundStyle(on ? Color.black : Palette.ink)
            .background(on ? Palette.ink : Palette.pill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// `.scard`: a card with an image (radius 20) and a 14 px name; `.badge` on the image when `badge` is set.
public struct ImageCard<Art: View>: View {
    var name: String
    var meta: String?
    var on: Bool
    var aspect: CGFloat
    var badge: String?
    var art: Art
    var action: () -> Void

    public init(_ name: String, meta: String? = nil, on: Bool = false, aspect: CGFloat = 4 / 3, badge: String? = nil,
                action: @escaping () -> Void, @ViewBuilder art: () -> Art) {
        self.name = name; self.meta = meta; self.on = on; self.aspect = aspect; self.badge = badge; self.action = action; self.art = art()
    }

    public var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Color.clear
                    .aspectRatio(aspect, contentMode: .fit)
                    .overlay { art }
                    .overlay(alignment: .topTrailing) { if let badge { Badge(badge).padding(8) } }
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .selectionRing(on, radius: 20)
                Text(name).font(.pm(14)).tracking(0.2).lineLimit(1).padding(.horizontal, 4)
                    .foregroundStyle(Palette.ink)
                if let meta {
                    Text(meta).font(.pm(12)).foregroundStyle(Palette.dim).lineLimit(1).padding(.horizontal, 4).padding(.top, -6)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// `.badge`: "LIVE" on catalog cards.
public struct Badge: View {
    var text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
        Text(text.uppercased())
            .font(.pm(10)).tracking(0.8)
            .foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Capsule().fill(.ultraThinMaterial).overlay(Capsule().fill(Color.black.opacity(0.5))))
    }
}

/// `.btn` (54 pt, radius 18, #1C1C1E) and `.btn.on` (ink, black).
public struct WideButton: View {
    var title: String
    var icon: LineIcon?
    var iconSize: CGFloat
    var on: Bool
    var height: CGFloat
    var font: Font
    var action: () -> Void

    public init(_ title: String, icon: LineIcon? = nil, iconSize: CGFloat = 18, on: Bool = false, height: CGFloat = 54,
                font: Font = .pm(15), action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.iconSize = iconSize; self.on = on; self.height = height; self.font = font; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon { Icon(icon, size: iconSize) }
                if !title.isEmpty { Text(title).tracking(0.2) }
            }
            .font(font)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .foregroundStyle(on ? Color.black : Palette.ink)
            .background(on ? Palette.ink : Palette.pill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }
}

/// `.sw`: 51×31 switch (off #39393D with a white knob; on ink with a black knob).
public struct PMSwitchStyle: ToggleStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 12) {
            configuration.label.font(.pm(15)).foregroundStyle(Palette.ink)
            Spacer(minLength: 8)
            Capsule()
                .fill(configuration.isOn ? Palette.ink : Palette.switchOff)
                .frame(width: 51, height: 31)
                .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                    Circle().fill(configuration.isOn ? Color.black : Color.white)
                        .frame(width: 27, height: 27)
                        .shadow(color: .black.opacity(0.35), radius: 3, y: 2)
                        .padding(2)
                }
                .animation(.snappy(duration: 0.2), value: configuration.isOn)
                .onTapGesture { configuration.isOn.toggle() }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// `.list` + `.li`: rows in a #141415 card (radius 22), separators from 68 pt, the selected row in ink.
public struct ListCard<Content: View>: View {
    var content: Content
    public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public var body: some View {
        VStack(spacing: 0) { content }
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

public struct ListRow<Thumb: View, Trailing: View>: View {
    var name: String
    var meta: String?
    var on: Bool
    var separator: Bool
    var thumb: Thumb
    var trailing: Trailing

    public init(_ name: String, meta: String? = nil, on: Bool = false, separator: Bool = false,
                @ViewBuilder thumb: () -> Thumb, @ViewBuilder trailing: () -> Trailing) {
        self.name = name; self.meta = meta; self.on = on; self.separator = separator; self.thumb = thumb(); self.trailing = trailing()
    }

    public var body: some View {
        HStack(spacing: 12) {
            thumb.frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(.pm(15)).tracking(0.2).lineLimit(1)
                if let meta { Text(meta).font(.pm(12)).tracking(0.2).lineLimit(1).foregroundStyle(on ? Palette.metaOnLight : Palette.dim) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 8))
        .frame(minHeight: 64)
        .foregroundStyle(on ? Color.black : Palette.ink)
        .background(on ? Palette.ink : Color.clear)
        .overlay(alignment: .top) {
            if separator && !on { Palette.separator.frame(height: 1).padding(.leading, 68) }
        }
    }
}

/// `.ib`: a 44 pt icon button inside rows.
public struct RowIconButton: View {
    var icon: LineIcon
    var size: CGFloat
    var label: String
    var action: () -> Void
    public init(_ icon: LineIcon, size: CGFloat = 20, label: String, action: @escaping () -> Void) {
        self.icon = icon; self.size = size; self.label = label; self.action = action
    }
    public var body: some View {
        Button(action: action) {
            Icon(icon, size: size).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// `.ck`: a checklist row (24 pt badge: ink with a check, or #2C2C2E when not yet).
public struct CheckRow: View {
    var title: String
    var meta: String
    var done: Bool
    public init(_ title: String, meta: String, done: Bool) { self.title = title; self.meta = meta; self.done = done }
    public var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(done ? Palette.ink : Palette.off)
                if done { Icon(.check, size: 14, stroke: 2.6).foregroundStyle(Color.black) }
            }
            .frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.pm(15)).tracking(0.2).foregroundStyle(Palette.ink)
                Text(meta).font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 40)
        .animation(.snappy, value: done)
    }
}

/// `.field`: the 40 pt search field.
public struct SearchField: View {
    var placeholder: String
    @Binding var text: String
    public init(_ placeholder: String, text: Binding<String>) { self.placeholder = placeholder; self._text = text }
    public var body: some View {
        HStack(spacing: 8) {
            Icon(.search, size: 17).foregroundStyle(Palette.dim)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Palette.dim))
                .font(.pm(16))
                .foregroundStyle(Palette.ink)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(Palette.track, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// The page title row of pushed and flow screens.
public struct PageDots: View {
    var count: Int
    var current: Int
    public init(count: Int, current: Int) { self.count = count; self.current = current }
    public var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { i in
                Capsule().fill(i <= current ? Palette.ink : Palette.detent)
                    .frame(width: i == current ? 18 : 6, height: 6)
            }
        }
    }
}

/// A thin progress bar (`height 6, radius 3`).
public struct ProgressLine: View {
    var value: Double
    public init(_ value: Double) { self.value = value }
    public var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.off)
                Capsule().fill(Palette.ink).frame(width: g.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 6)
        .animation(.linear(duration: 0.3), value: value)
    }
}
