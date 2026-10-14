import SwiftUI
import PMKit

// Soundboard pieces in the phone v4 kit: pad tiles (like `.fxt`, tinted by the pad colour) and a peaks waveform.

extension Palette {
    /// A pad's colour. `red` is a softer coral so the on-air red stays the only #FF3B30 on screen.
    public static func pad(_ c: PadColor) -> Color {
        switch c {
        case .ink: ink
        case .red: Color(hex: 0xFF7A6B)
        case .amber: Color(hex: 0xFFB547)
        case .green: Color(hex: 0x63D68C)
        case .teal: Color(hex: 0x4FD1C5)
        case .blue: Color(hex: 0x6AAEFF)
        case .violet: Color(hex: 0xAE92FF)
        case .pink: Color(hex: 0xFF85BD)
        }
    }
}

/// A soundboard pad: a square tile with its glyph and name in the pad colour; ink-filled while it plays. Tap plays,
/// long press stops.
public struct PadTile: View {
    var name: String
    var color: PadColor
    var icon: PadIcon
    var playing: Bool
    var loop: Bool
    var missing: Bool
    var onTap: () -> Void
    var onHold: () -> Void
    @State private var flash = false
    @State private var taps = 0
    @Environment(\.hapticsEnabled) private var haptics

    public init(_ name: String, color: PadColor, icon: PadIcon, playing: Bool = false, loop: Bool = false, missing: Bool = false,
                onTap: @escaping () -> Void, onHold: @escaping () -> Void) {
        self.name = name; self.color = color; self.icon = icon; self.playing = playing; self.loop = loop; self.missing = missing
        self.onTap = onTap; self.onHold = onHold
    }

    public var body: some View {
        let tint = Palette.pad(color)
        let lit = playing || flash
        Color.clear
        .aspectRatio(1, contentMode: .fit)
        .overlay {
            VStack(spacing: 8) {
                if let glyph = LineIcon.pad(icon.rawValue) {
                    Icon(glyph, size: 28)
                } else {
                    Text(String(name.prefix(1))).font(.pmMono(22, .bold))
                }
                Text(missing ? "missing sound" : name).font(.pm(12)).lineLimit(1).minimumScaleFactor(0.75).padding(.horizontal, 8)
            }
        }
        .foregroundStyle(lit ? Color.black : (missing ? Palette.dim : tint))
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(lit ? tint : Palette.pill)
            if !lit {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(tint.opacity(0.08))
            }
        }
        .overlay(alignment: .topTrailing) {
            if loop {
                Icon(.loop, size: 13, stroke: 2)
                    .foregroundStyle(lit ? Color.black : Palette.dim)
                    .padding(9)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onTapGesture {
            taps += 1
            onTap()
            guard !loop else { return }
            withAnimation(.easeOut(duration: 0.08)) { flash = true }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(260))
                withAnimation(.easeOut(duration: 0.35)) { flash = false }
            }
        }
        .onLongPressGesture(minimumDuration: 0.45) { taps -= 1; onHold() }
        .sensoryFeedback(trigger: taps) { old, new in
            guard haptics else { return nil }
            return new > old ? .impact(weight: .medium, intensity: 0.9) : .impact(weight: .heavy, intensity: 1)
        }
        .accessibilityElement()
        .accessibilityLabel(missing ? "\(name), missing sound" : name)
        .accessibilityValue(playing ? "playing" : "")
        .accessibilityHint(loop ? "tap to start or stop the loop" : "tap to play, hold to stop")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onTap() }
        .accessibilityAction(named: "stop") { onHold() }
    }
}

/// A sound's peaks (0…1) as centred bars.
public struct Waveform: View {
    var peaks: [Double]
    var bars: Int
    public init(_ peaks: [Double], bars: Int = 32) { self.peaks = peaks; self.bars = bars }

    public var body: some View {
        Canvas { ctx, size in
            let n = max(1, bars)
            let values = Self.resample(peaks, to: n)
            let step = size.width / CGFloat(n)
            let w = max(1, step * 0.55)
            for (i, v) in values.enumerated() {
                let h = max(2, CGFloat(v) * size.height)
                let r = CGRect(x: CGFloat(i) * step + (step - w) / 2, y: (size.height - h) / 2, width: w, height: h)
                ctx.fill(Path(roundedRect: r, cornerRadius: w / 2), with: .foreground)
            }
        }
        .accessibilityHidden(true)
    }

    /// The largest peak per slice, so short and long lists draw the same number of bars.
    static func resample(_ peaks: [Double], to n: Int) -> [Double] {
        guard !peaks.isEmpty else { return Array(repeating: 0.06, count: n) }
        return (0..<n).map { i in
            let a = i * peaks.count / n, b = max(a + 1, (i + 1) * peaks.count / n)
            return min(1, max(0, peaks[a..<min(b, peaks.count)].max() ?? 0))
        }
    }
}
