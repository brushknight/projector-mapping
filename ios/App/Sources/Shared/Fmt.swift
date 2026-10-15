import Foundation
import PMKit

/// Value formatting as the boards show it.
enum Fmt {
    static func percent(_ f: Double) -> String { "\(Int((f * 100).rounded()))%" }

    /// "−22°" (a real minus sign).
    static func signed(_ v: Double, unit: String = "") -> String {
        let n = Int(v.rounded())
        return (n < 0 ? "−\(-n)" : "\(n)") + unit
    }

    static func plusMinus(_ n: Int) -> String { n > 0 ? "+\(n)" : n < 0 ? "−\(-n)" : "0" }

    /// "16:9 · 1080p" (portrait outputs read "9:16").
    static func format(_ o: OutputConfig?) -> String {
        let o = o ?? OutputConfig()
        var w = o.width, h = o.height
        if o.isPortrait { swap(&w, &h) }
        func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? max(1, a) : gcd(b, a % b) }
        let g = gcd(w, h)
        return "\(w / g):\(h / g) · \(min(w, h))p"
    }

    static func kelvin(_ k: Double) -> String { "\(Int(k.rounded())) K" }

    /// Tint −1…1 as the board writes it: "+4 m" (magenta) or "−4 g" (green).
    static func tint(_ t: Double) -> String {
        let n = Int((t * 100).rounded())
        if n == 0 { return "0" }
        return n > 0 ? "+\(n) m" : "−\(-n) g"
    }

    /// Background blur as an aperture: 0.74 → "f/1.4".
    static func aperture(_ blur: Double) -> String {
        let stops = ["f/22", "f/16", "f/11", "f/8", "f/5.6", "f/4", "f/2.8", "f/2", "f/1.4", "f/1"]
        return stops[min(stops.count - 1, max(0, Int(blur * 12)))]
    }

    static func speedWord(_ v: Double) -> String {
        switch v {
        case ..<0.03: "still"
        case ..<0.35: "slow"
        case ..<0.7: "medium"
        default: "fast"
        }
    }

    static func focusWord(_ v: Double) -> String {
        switch v {
        case ..<0.33: "sharp"
        case ..<0.6: "medium"
        default: "soft"
        }
    }

    /// The display of a catalog param's value.
    static func param(_ key: String, _ spec: ParamSpec, _ value: Double) -> String {
        switch key {
        case "focus": return focusWord(value)
        case "blur": return aperture(value)
        case "drift" where spec.label == "slow drift": return speedWord(value)
        case "warmth": return plusMinus(Int((value * 50).rounded()))
        // (§16) gain 1.0 at 100 %: the picture as it is
        case "brightness": return value >= 0.995 ? "100% · original" : percent(value)
        default: break
        }
        if spec.type == "integer" { return "\(Int(value.rounded()))" + (spec.unit.map { " \($0)" } ?? "") }
        if let unit = spec.unit {
            if unit == "°" { return signed(value, unit: "°") }
            if unit == "×" { return String(format: "%.1f×", value) }
            return "\(Int(value.rounded())) \(unit)"
        }
        if spec.lower == 0 && spec.upper == 1 { return percent(value) }
        if spec.lower == -1 && spec.upper == 1 { return plusMinus(Int((value * 100).rounded())) + "%" }
        return String(format: "%.2f", value)
    }

    /// "0:12", "1:05:00".
    static func clock(_ t: Double) -> String {
        let s = Int(max(0, t).rounded())
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }

    /// A move's length: "5 s", "45 s", "1 min 30 s", "10 min", "1 h 20 min", "2 h".
    static func duration(_ seconds: Double) -> String {
        let s = Int(seconds.rounded())
        if s < 60 { return "\(s) s" }
        if s < 600 { return s % 60 == 0 ? "\(s / 60) min" : "\(s / 60) min \(s % 60) s" }
        let m = Int((seconds / 60).rounded())
        if m < 60 { return "\(m) min" }
        return m % 60 == 0 ? "\(m / 60) h" : "\(m / 60) h \(m % 60) min"
    }

    /// Focus 0…1 (1 is sharp): "sharp", "soft", or a percentage between.
    static func focus(_ f: Double) -> String {
        if f >= 0.97 { return "sharp" }
        if f <= 0.03 { return "fully soft" }
        return percent(f)
    }

    /// A slide offset −1…1 in frame fractions: "0", "+25 %", "−10 %".
    static func slide(_ v: Double) -> String {
        let n = Int((v * 100).rounded())
        return n == 0 ? "centred" : (n > 0 ? "+\(n) %" : "−\(-n) %")
    }

    /// "06.4 s"
    static func playhead(_ t: Double) -> String { String(format: "%04.1f s", max(0, t)) }
}
