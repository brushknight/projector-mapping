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
    /// (§20) the converge: a light closing onto a cube
    public static let converge = LineIcon([.circle(12, 12, 9.5, dash: [2.4, 2.6]), .path("M12 7.2l4.2 2.4v4.8L12 16.8l-4.2-2.4V9.6z"), .path("M12 12v4.8M12 12l4.2-2.4M12 12L7.8 9.6")])

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
    /// (§16) window geometry: panes in a frame
    public static let panes = LineIcon([.rect(4, 4, 16, 16, rx: 2), .path("M12 4v16M4 12h16")])
    public static let rotate = LineIcon([.path("M20 12a8 8 0 1 1-2.3-5.7"), .path("M20 4v4h-4")])
    public static let trash = LineIcon([.path("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3")])
    public static let qr = LineIcon([.rect(3.5, 3.5, 7, 7, rx: 1.5), .rect(13.5, 3.5, 7, 7, rx: 1.5), .rect(3.5, 13.5, 7, 7, rx: 1.5), .path("M14 14h2.5v2.5M20 14v.01M14 20h.01M17 17h3v3")])
    public static let wifi = LineIcon([.path("M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0"), .circle(12, 19.3, 0.9, fill: true)])

    // Show control, sound and video (protocol §14)
    public static let scenes = LineIcon([.rect(3.5, 8, 13, 12.5, rx: 2), .path("M7 5h11.5a2 2 0 0 1 2 2v9.5")])
    public static let speaker = LineIcon([.path("M4 9.5h3.5L12 5.5v13l-4.5-4H4z"), .path("M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11")])
    public static let speakerOff = LineIcon([.path("M4 9.5h3.5L12 5.5v13l-4.5-4H4z"), .path("M16 9.5l5 5M21 9.5l-5 5")])
    public static let film = LineIcon([.rect(3.5, 5, 17, 14, rx: 2.5), .path("M10 9.2v5.6l4.8-2.8z", fill: true)])
    public static let link = LineIcon([.path("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"), .path("M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1")])
    public static let clipboard = LineIcon([.rect(5.5, 5, 13, 16, rx: 2), .path("M9 5V3.5h6V5"), .path("M9 11h6M9 15h4")])
    public static let loop = LineIcon([.path("M4 12a6 6 0 0 1 6-6h9"), .path("M16 3l3 3-3 3"), .path("M20 12a6 6 0 0 1-6 6H5"), .path("M8 21l-3-3 3-3")])
    public static let phone = LineIcon([.rect(7, 2.5, 10, 19, rx: 2.5), .path("M11 18.5h2")])
    public static let note = LineIcon([.path("M9 18V5.5l11-2V16"), .circle(6.5, 18, 2.5), .circle(17.5, 16, 2.5)])
    public static let waveform = LineIcon([.path("M3 12h1.5M6.5 8v8M10 4.5v15M13.5 8.5v7M17 6v12M20.5 10.5v3")])

    // Pad icons (§14 icon set)
    public static let bell = LineIcon([.path("M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"), .path("M10 21h4")])
    public static let door = LineIcon([.path("M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"), .path("M3.5 21h17"), .circle(14.5, 12.5, 0.9, fill: true)])
    public static let rain = LineIcon([.path("M7 14.5a4.5 4.5 0 0 1-.4-9 5.5 5.5 0 0 1 10.6 1.5A3.8 3.8 0 0 1 17 14.5z"), .path("M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5")])
    public static let bird = LineIcon([.path("M3 11c3-1 5 0 6.5 1.5C11 9 14 6.5 18 7l2.5-1.5L20 8.5c0 5-4 9-10 9-2.5 0-4.5-1-6-3 2 0 3.5-.5 4.5-1.5C5.5 13 4 12.5 3 11z")])
    public static let voice = LineIcon([.path("M4 18.5V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8z"), .path("M8.5 9h7M8.5 12.5h4.5")])
    public static let knock = LineIcon([.path("M7 11V7.5a1.5 1.5 0 0 1 3 0V10m0-3a1.5 1.5 0 0 1 3 0v3m0-2a1.5 1.5 0 0 1 3 0v3m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.5 14a1.5 1.5 0 0 1 2.5-1.6l1 1.3")])
    public static let spark = LineIcon([.path("M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8")])
    public static let heart = LineIcon([.path("M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z")])

    /// The glyph of a pad icon name (§14), nil for `none` or a name this app has no glyph for.
    public static func pad(_ icon: String) -> LineIcon? {
        switch icon {
        case "bell": .bell
        case "door": .door
        case "thunder": .lightning
        case "rain": .rain
        case "wind": .wind
        case "bird": .bird
        case "music": .note
        case "voice": .voice
        case "knock": .knock
        case "spark": .spark
        case "heart": .heart
        default: nil
        }
    }

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
        case "angle", "taper", "taperY", "slant", "slantY": .angle
        case "sashes", "cols", "rows", "gap", "width", "height", "frame", "mullion", "diamonds", "slats", "slatWidth", "spokes", "hub", "archHeight": .panes
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
