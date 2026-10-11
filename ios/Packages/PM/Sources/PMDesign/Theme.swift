import SwiftUI
import CoreText

/// Colours of the phone v4 boards (`design/html/phone/*.dc.html`, shared CSS).
public enum Palette {
    public static let ground = Color(hex: 0x000000)
    public static let ink = Color(hex: 0xF5F4F0)
    public static let dim = Color(hex: 0x8C8A85)
    public static let red = Color(hex: 0xFF3B30)
    public static let green = Color(hex: 0x34C759)
    /// `.pill`, `.seg`, `.btn`, `.fxt`, `.prompt`
    public static let pill = Color(hex: 0x1C1C1E)
    /// `.card`, `.list`, `.addrow`
    public static let card = Color(hex: 0x141415)
    /// `.big` slider track, `.field`, thumbs
    public static let track = Color(hex: 0x232325)
    public static let hero = Color(hex: 0x111111)
    public static let sheet = Color(hex: 0x161618)
    public static let grab = Color(hex: 0x48484A)
    public static let detent = Color(hex: 0x3A3A3C)
    public static let detentMajor = Color(hex: 0x6E6C68)
    public static let switchOff = Color(hex: 0x39393D)
    public static let off = Color(hex: 0x2C2C2E)
    public static let separator = Color.white.opacity(0.07)
    /// `.meta` on a selected (light) row
    public static let metaOnLight = Color(hex: 0x5A5955)
    public static let logTime = Color(hex: 0x5E5C57)
    public static let glass = Color.black.opacity(0.45)
}

extension Color {
    public init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255, opacity: opacity)
    }

    /// `#rrggbb` (or `#rgb`) from the wire.
    public init?(css: String?) {
        guard var s = css?.trimmingCharacters(in: .whitespaces), s.hasPrefix("#") else { return nil }
        s.removeFirst()
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(hex: v)
    }
}

/// Share Tech Mono (body) and Roboto Mono (titles, values), bundled OFL TTFs.
public enum PMFont {
    public static let body = "ShareTechMono-Regular"
    public static let mono = "RobotoMono-Regular"
    public static let monoMedium = "RobotoMono-Medium"
    public static let monoBold = "RobotoMono-Bold"

    /// Registers the bundled fonts once per process.
    @MainActor public static func register() {
        guard !registered else { return }
        registered = true
        guard let dir = Bundle.module.url(forResource: "Fonts", withExtension: nil),
              let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        for url in files where url.pathExtension == "ttf" {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    @MainActor private static var registered = false
}

extension Font {
    /// Share Tech Mono, the body face (`.ph` 15 px).
    public static func pm(_ size: CGFloat) -> Font { .custom(PMFont.body, fixedSize: size) }
    /// Roboto Mono (`.h`, values).
    public static func pmMono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        switch weight {
        case .bold, .heavy, .black, .semibold: .custom(PMFont.monoBold, fixedSize: size)
        case .medium: .custom(PMFont.monoMedium, fixedSize: size)
        default: .custom(PMFont.mono, fixedSize: size)
        }
    }
    /// `.ttl`: Roboto Mono 700, 32 px, −1 px tracking.
    public static func pmTitle(_ size: CGFloat = 32) -> Font { .custom(PMFont.monoBold, fixedSize: size) }
}

extension View {
    /// `.cap`: 12 px, 1.2 px tracking, uppercase, dim.
    public func capStyle() -> some View {
        font(.pm(12)).tracking(1.2).textCase(.uppercase).foregroundStyle(Palette.dim)
    }

    /// `.ttl`
    public func titleStyle(_ size: CGFloat = 32) -> some View {
        font(.pmTitle(size)).tracking(-1).foregroundStyle(Palette.ink)
    }
}

/// Light colour helpers for the CCT strip, tint and previews.
public enum LightMath {
    /// Approximate sRGB of a black body at `kelvin` (Tanner Helland's fit), 1000…40000 K.
    public static func kelvin(_ k: Double) -> (r: Double, g: Double, b: Double) {
        let t = min(40000, max(1000, k)) / 100
        var r: Double, g: Double, b: Double
        if t <= 66 { r = 255 } else { r = 329.698727446 * pow(t - 60, -0.1332047592) }
        if t <= 66 { g = 99.4708025861 * log(t) - 161.1195681661 } else { g = 288.1221695283 * pow(t - 60, -0.0755148492) }
        if t >= 66 { b = 255 } else if t <= 19 { b = 0 } else { b = 138.5177312231 * log(t - 10) - 305.0447927307 }
        func c(_ v: Double) -> Double { min(255, max(0, v)) / 255 }
        return (c(r), c(g), c(b))
    }

    public static func kelvinColor(_ k: Double, tint: Double = 0) -> Color {
        var (r, g, b) = kelvin(k)
        // Tint: negative = green, positive = magenta.
        if tint > 0 { r = min(1, r + tint * 0.15); b = min(1, b + tint * 0.15); g = max(0, g - tint * 0.1) }
        if tint < 0 { g = min(1, g - tint * 0.15); r = max(0, r + tint * 0.1); b = max(0, b + tint * 0.1) }
        return Color(.sRGB, red: r, green: g, blue: b)
    }

    /// The colour of a light (`cct` or `hsi`).
    public static func color(mode: String, kelvin: Double, tint: Double, hue: Double, sat: Double) -> Color {
        if mode == "hsi" { return Color(hue: hue / 360, saturation: sat, brightness: 1) }
        return kelvinColor(kelvin, tint: tint)
    }
}
