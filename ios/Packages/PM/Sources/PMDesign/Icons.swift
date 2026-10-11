import SwiftUI

/// The boards' line icons (24×24 viewBox, round caps and joins), drawn from their SVG sources.
public struct LineIcon: Sendable, Hashable {
    public enum Part: Sendable, Hashable {
        case path(String, fill: Bool = false)
        case circle(Double, Double, Double, fill: Bool = false, dash: [Double]? = nil)
        case rect(Double, Double, Double, Double, rx: Double = 0, fill: Bool = false)
    }

    public var parts: [Part]
    public var stroke: Double

    public init(_ parts: [Part], stroke: Double = 1.75) { self.parts = parts; self.stroke = stroke }

    func with(stroke: Double) -> LineIcon { LineIcon(parts, stroke: stroke) }
}

extension LineIcon {
    public static let projector = LineIcon([.rect(2.5, 7, 19, 10, rx: 3), .circle(16, 12, 2.6), .path("M6 10.5h4M6 13.5h4M6 17v1.5M18 17v1.5")])
    public static let sun = LineIcon([.circle(12, 12, 4), .path("M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4")])
    public static let softness = LineIcon([.circle(12, 12, 8.5, dash: [2, 2.6]), .circle(12, 12, 4)])
    public static let angle = LineIcon([.path("M4 20h16"), .path("M4 20L16 6"), .path("M10.5 20a6.5 6.5 0 0 0-2-4.7")])
    public static let wind = LineIcon([.path("M3 9h11a3 3 0 1 0-3-3"), .path("M3 15h15a3 3 0 1 1-3 3")])
    public static let plus = LineIcon([.path("M12 5v14M5 12h14")])
    public static let grain = LineIcon([(6, 6), (13, 5), (18, 9), (9, 11), (15, 14), (6, 17), (12, 19), (19, 18)].map { .circle($0.0, $0.1, 1, fill: true) })

    // Tabs
    public static let tabStatic = LineIcon([.rect(4, 3.5, 16, 17, rx: 2), .path("M12 3.5v17M4 12h16")])
    public static let tabLive = LineIcon([.path("M3 8.5h10.5a3 3 0 1 0-3-3"), .path("M3 12.5h15a3 3 0 1 1-3 3"), .path("M3 16.5h7")])
    public static let tabColor = LineIcon([.circle(12, 12, 8.5), .path("M12 3.5a8.5 8.5 0 0 1 0 17z", fill: true)])
    public static let tabScenery = LineIcon([.rect(3.5, 4.5, 17, 15, rx: 2.5), .path("M3.5 16l5-5 4 4 2.5-2.5 5 5"), .circle(15.5, 9, 1.6)])
    public static let cube = LineIcon([.path("M12 3l8 4.5v9L12 21l-8-4.5v-9z"), .path("M4 7.5l8 4.5 8-4.5M12 12v9")])

    // Light FX (stroke 1.6)
    public static let candle = LineIcon([.path("M12 3c1.6 1.8 2 3.2 0 5-2-1.8-1.6-3.2 0-5z"), .rect(9, 10, 6, 10, rx: 1)], stroke: 1.6)
    public static let fire = LineIcon([.path("M12 21a6 6 0 0 0 6-6c0-4-3-5.5-4-9-2 2-2.5 3.5-2.5 5-1.5-.8-2-2-2-3C7 9.5 6 12 6 15a6 6 0 0 0 6 6z")], stroke: 1.6)
    public static let lightning = LineIcon([.path("M13 2.5L5 13.5h6l-1 8 8-11h-6z")], stroke: 1.6)
    public static let paparazzi = LineIcon([.rect(3, 7, 18, 12, rx: 2.5), .circle(12, 13, 3.2), .path("M8.5 7l1.5-2.5h4L15.5 7")], stroke: 1.6)
    public static let tv = LineIcon([.rect(3, 6.5, 18, 12.5, rx: 2), .path("M8 3l4 3.5L16 3")], stroke: 1.6)
    public static let breathe = LineIcon([.path("M2.5 12h4l2.5-6 4 12 2.5-6h6")], stroke: 1.6)
    public static let strobe = LineIcon([.path("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"), .circle(12, 12, 3.5, fill: true)], stroke: 1.6)
    public static let police = LineIcon([.path("M6 18v-6a6 6 0 0 1 12 0v6"), .path("M4 18h16v2.5H4z"), .path("M12 2.5v2M4 6l1.5 1.5M20 6l-1.5 1.5")], stroke: 1.6)
    public static let none = LineIcon([.circle(12, 12, 8.5), .path("M6 18L18 6")], stroke: 1.6)

    // Rows and actions
    public static let eye = LineIcon([.path("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"), .circle(12, 12, 2.8)])
    public static let eyeOff = LineIcon([.path("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"), .circle(12, 12, 2.8), .path("M4 4l16 16")])
    public static let grip = LineIcon([(9, 7), (15, 7), (9, 12), (15, 12), (9, 17), (15, 17)].map { .circle($0.0, $0.1, 0.9, fill: true) })
    public static let camera = LineIcon([.rect(3, 7, 18, 12.5, rx: 2.5), .circle(12, 13, 3.2), .path("M9 7l1.2-2.5h3.6L15 7")])
    public static let chevronRight = LineIcon([.path("M9 5l7 7-7 7")])
    public static let back = LineIcon([.path("M15 5l-7 7 7 7")], stroke: 2.2)
    public static let close = LineIcon([.path("M6 6l12 12M18 6L6 18")], stroke: 2.2)
    public static let search = LineIcon([.circle(11, 11, 6.5), .path("M20 20l-4.2-4.2")])
    public static let previous = LineIcon([.path("M6 5v14"), .path("M18 5v14l-10-7z", fill: true)])
    public static let arrowRight = LineIcon([.path("M5 12h14M13 6l6 6-6 6")], stroke: 2.2)
    public static let stop = LineIcon([.rect(6, 6, 12, 12, rx: 1.5, fill: true)])
    public static let wand = LineIcon([.path("M4 20L15 9"), .path("M15 9l2-2 2 2-2 2z"), .path("M18 3v2M21 6h-2M10 4v1.5M20 13v1.5")])
    public static let play = LineIcon([.path("M7 4.5v15l12-7.5z", fill: true)])
    public static let lamp = LineIcon([.path("M8 3h8l3 8H5z"), .path("M12 11v8M8 21h8")])
    public static let shelf = LineIcon([.path("M4 5h16M4 12h16M4 19h16M6 5v14M18 5v14")])
    public static let plant = LineIcon([.path("M12 21v-9"), .path("M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6.5-5.5 0 3 2.5 5.5 6.5 5.5z"), .path("M8 21h8")])
    public static let laptop = LineIcon([.rect(4.5, 5, 15, 10, rx: 1.5), .path("M2.5 19h19")])
    public static let help = LineIcon([.circle(12, 12, 9), .path("M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7"), .circle(12, 17, 0.8, fill: true)])
    public static let level = LineIcon([.path("M3 12h18"), .circle(12, 12, 3.5)])
    public static let check = LineIcon([.path("M5 12.5l4.5 4.5L19 7.5")], stroke: 2.4)
    public static let more = LineIcon([.circle(5, 12, 1.3, fill: true), .circle(12, 12, 1.3, fill: true), .circle(19, 12, 1.3, fill: true)], stroke: 2.2)
    public static let pencil = LineIcon([.path("M4 20l4-1 11-11-3-3L5 16z"), .path("M14 6l3 3")])
    public static let mic = LineIcon([.rect(9, 3, 6, 11, rx: 3), .path("M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21")])
    public static let send = LineIcon([.path("M4 12l16-8-6 16-2.5-6.5z")])
    public static let flipH = LineIcon([.path("M12 3v18"), .path("M9 7L4 17h5zM15 7l5 10h-5z")])
    public static let rotate = LineIcon([.path("M20 12a8 8 0 1 1-2.3-5.7"), .path("M20 4v4h-4")])
    public static let trash = LineIcon([.path("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3")])
    public static let qr = LineIcon([.rect(3.5, 3.5, 7, 7, rx: 1.5), .rect(13.5, 3.5, 7, 7, rx: 1.5), .rect(3.5, 13.5, 7, 7, rx: 1.5), .path("M14 14h2.5v2.5M20 14v.01M14 20h.01M17 17h3v3")])
    public static let wifi = LineIcon([.path("M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0"), .circle(12, 19.3, 0.9, fill: true)])

    /// The icon for a light FX kind.
    public static func fx(_ kind: String) -> LineIcon {
        switch kind {
        case "candle": .candle
        case "fire": .fire
        case "lightning": .lightning
        case "paparazzi": .paparazzi
        case "tv": .tv
        case "breathe": .breathe
        case "strobe": .strobe
        case "police": .police
        default: .none
        }
    }

    /// The icon for a param of a catalog item (by key or label).
    public static func param(_ key: String) -> LineIcon {
        switch key {
        case "intensity", "brightness", "master", "fromKelvin", "toKelvin", "warmth", "travel": .sun
        case "softness", "focus", "blur", "sharpness", "haze": .softness
        case "angle": .angle
        case "grain", "amount", "density", "drops", "size", "seed": .grain
        default: .wind
        }
    }
}

/// Draws a `LineIcon` in the current foreground style.
public struct Icon: View {
    let icon: LineIcon
    let size: CGFloat
    let stroke: Double?

    public init(_ icon: LineIcon, size: CGFloat = 18, stroke: Double? = nil) {
        self.icon = icon
        self.size = size
        self.stroke = stroke
    }

    public var body: some View {
        let icon = icon
        let width = stroke ?? icon.stroke
        Canvas { ctx, sz in
            let s = sz.width / 24
            ctx.scaleBy(x: s, y: s)
            let style = StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
            for part in icon.parts {
                switch part {
                case .path(let d, let fill):
                    let p = SVGPath.parse(d)
                    if fill { ctx.fill(p, with: .foreground); ctx.stroke(p, with: .foreground, style: style) } else { ctx.stroke(p, with: .foreground, style: style) }
                case .circle(let cx, let cy, let r, let fill, let dash):
                    let p = Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r))
                    if fill { ctx.fill(p, with: .foreground); ctx.stroke(p, with: .foreground, style: style) }
                    else {
                        var st = style
                        if let dash { st.dash = dash.map { CGFloat($0) }; st.lineCap = .butt }
                        ctx.stroke(p, with: .foreground, style: st)
                    }
                case .rect(let x, let y, let w, let h, let rx, let fill):
                    let p = Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: rx)
                    if fill { ctx.fill(p, with: .foreground) }
                    ctx.stroke(p, with: .foreground, style: style)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
