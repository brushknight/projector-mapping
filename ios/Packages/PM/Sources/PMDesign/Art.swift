import SwiftUI

/// Native drawings of the boards' artwork: gobo tiles, the hero light, gradients, the objects grid and the camera
/// view. They stand in for the web renderer when it is not reachable (demo mode, offline) and draw catalog tiles.
public enum Art {
    static let warmLight = Color(hex: 0xFFE2B8)
    static let heroLight = Color(hex: 0xFFD9A6)
    static let tileDark = Color(hex: 0x15120F)
    static let paper = Color(hex: 0xE8C792)
    /// `GraphicsContext` blur radii read about twice an SVG `stdDeviation`; this maps the boards' values.
    public static let blurScale = 0.72

    /// skewX(a) as an affine transform.
    static func skewX(_ deg: Double) -> CGAffineTransform { CGAffineTransform(a: 1, b: 0, c: tan(deg * .pi / 180), d: 1, tx: 0, ty: 0) }

    static func rotate(_ deg: Double, around c: CGPoint) -> CGAffineTransform {
        CGAffineTransform(translationX: c.x, y: c.y).rotated(by: deg * .pi / 180).translatedBy(x: -c.x, y: -c.y)
    }

    /// Draws a gobo's light pattern in a 64×64 space (light = `light`, shadow = clear).
    static func gobo(_ id: String, in ctx: inout GraphicsContext, light: Color) {
        switch id {
        case "window":
            let t = skewX(-14).concatenating(.identity).translatedBy(x: 6, y: 2)
            var p = Path()
            for (x, y) in [(14.0, 10.0), (34, 10), (14, 32), (34, 32)] { p.addRect(CGRect(x: x, y: y, width: 17, height: 19)) }
            ctx.fill(p.applying(t), with: .color(light))
        case "blinds":
            var p = Path()
            for k in 0..<8 { p.addRect(CGRect(x: -10, y: 4 + 8 * Double(k), width: 90, height: 4.5)) }
            ctx.fill(p.applying(rotate(-18, around: CGPoint(x: 32, y: 32))), with: .color(light))
        case "arch":
            ctx.fill(SVGPath.parse("M16 58V30a16 16 0 0 1 32 0v28z"), with: .color(light))
            ctx.stroke(SVGPath.parse("M32 14v44M16 40h32"), with: .color(Color(hex: 0x0B0A09)), lineWidth: 3)
        case "lattice":
            var p = Path()
            for x in stride(from: -8.0, through: 64, by: 12) { for y in stride(from: -8.0, through: 64, by: 12) { p.addRect(CGRect(x: x, y: y, width: 9, height: 9)) } }
            ctx.fill(p.applying(rotate(45, around: CGPoint(x: 32, y: 32))), with: .color(light))
        case "dots", "dapple":
            var p = Path()
            for (x, y, r) in ArtData.dots { p.addEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
            ctx.fill(p, with: .color(light))
        case "spot", "sun-drift":
            ctx.fill(Path(ellipseIn: CGRect(x: 12, y: 12, width: 40, height: 40)), with: .color(light))
        case "palm", "palm-sway":
            ctx.fill(Path(CGRect(x: 0, y: 0, width: 64, height: 64)), with: .color(paper))
            for d in ArtData.palmFronds { ctx.stroke(SVGPath.parse(d), with: .color(.black), lineWidth: 4) }
        case "tree", "tree-sway":
            ctx.fill(Path(CGRect(x: 0, y: 0, width: 64, height: 64)), with: .color(paper))
            var sub = ctx
            sub.transform = sub.transform.translatedBy(x: -24, y: -2).scaledBy(x: 0.31, y: 0.31)
            tree(&sub, color: .black)
        default:
            ctx.fill(Path(ellipseIn: CGRect(x: 12, y: 12, width: 40, height: 40)), with: .color(light))
        }
    }

    /// The tree silhouette (344×190 space).
    static func tree(_ ctx: inout GraphicsContext, color: Color) {
        for (d, w) in ArtData.treeBranches { ctx.stroke(SVGPath.parse(d), with: .color(color), lineWidth: w) }
        for (cx, cy, rx, ry, rot) in ArtData.treeLeaves {
            let p = Path(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry))
            ctx.fill(p.applying(rotate(rot, around: CGPoint(x: cx, y: cy))), with: .color(color))
        }
    }

    /// Tile background: dark for light-on-dark gobos, paper for tree/palm.
    /// The tree's filter sits on a group scaled by .31, so its blur is 1.1 × .31 in tile units.
    static func tileBlur(_ id: String) -> Double { id == "tree" || id == "tree-sway" ? 0.34 : 1.6 }
}

/// A gobo or live-layer tile (`.tile .th`, `.thumb`, `.scard .im`): the board's 64×64 art, blurred, filling the frame.
public struct GoboArt: View {
    let id: String
    let light: Color

    public init(_ id: String, light: Color = Color(hex: 0xFFE2B8)) { self.id = id; self.light = light }

    public var body: some View {
        let id = id, light = light
        Canvas { ctx, size in
            let side = max(size.width, size.height)
            let s = side / 64
            ctx.translateBy(x: (size.width - side) / 2, y: (size.height - side) / 2)
            ctx.scaleBy(x: s, y: s)
            ctx.fill(Path(CGRect(x: 0, y: 0, width: 64, height: 64)), with: .color(Art.tileDark))
            ctx.drawLayer { layer in
                layer.addFilter(.blur(radius: Art.tileBlur(id) * s * 0.9))
                Art.gobo(id, in: &layer, light: light)
            }
        }
        .clipped()
    }
}

/// The hero's native stand-in for a gobo (+ optional tree) backdrop, 344×190 like the board.
public struct LightHeroArt: View {
    public var gobo: String
    public var angle: Double
    public var softness: Double
    public var intensity: Double
    public var color: Color
    public var tree: Bool
    public var sway: Bool

    public init(gobo: String, angle: Double = -22, softness: Double = 0.62, intensity: Double = 0.8, color: Color = Color(hex: 0xFFD9A6),
                tree: Bool = false, sway: Bool = true) {
        self.gobo = gobo; self.angle = angle; self.softness = softness; self.intensity = intensity; self.color = color
        self.tree = tree; self.sway = sway
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !(tree && sway))) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in draw(&ctx, size, t) }
        }
    }

    func draw(_ ctx: inout GraphicsContext, _ size: CGSize, _ t: Double) {
        let s = size.width / 344
        ctx.scaleBy(x: s, y: s)
        let full = CGRect(x: 0, y: 0, width: 344, height: size.height / s)
        ctx.fill(Path(full), with: .radialGradient(Gradient(colors: [Color(hex: 0x2A241D), Color(hex: 0x0D0B09)]),
                                                   center: CGPoint(x: 344 * 0.55, y: full.height * 0.4), startRadius: 0, endRadius: 344 * 0.8))
        let blur = (0.4 + softness * 4.2) * s * 0.66
        let opacity = min(1, 0.15 + intensity)
        ctx.drawLayer { layer in
            layer.drawLayer { light in
                light.addFilter(.blur(radius: blur))
                light.opacity = opacity
                if gobo == "window" {
                    var p = Path()
                    for (x, y) in [(120.0, 22.0), (188, 22), (120, 84), (188, 84), (120, 146), (188, 146)] {
                        p.addRect(CGRect(x: x, y: y, width: 58, height: 52))
                    }
                    let skew = Art.skewX(angle)
                    light.fill(p.applying(skew.concatenating(CGAffineTransform(translationX: -30, y: 0))), with: .color(color))
                } else {
                    let k = 344.0 / 64 * 0.75
                    light.translateBy(x: 172, y: 95)
                    light.rotate(by: .degrees(angle))
                    light.scaleBy(x: k, y: k)
                    light.translateBy(x: -32, y: -32)
                    Art.gobo(gobo, in: &light, light: color)
                }
            }
            if tree {
                layer.blendMode = .destinationOut
                layer.drawLayer { shadow in
                    shadow.addFilter(.blur(radius: 2.4 * s * Art.blurScale))
                    let phase = sway ? sin(t * 2 * .pi / 4) : -1
                    let deg = -1.6 + (phase + 1) / 2 * 3.4
                    shadow.translateBy(x: 200 + (phase + 1) * 1.5, y: 210)
                    shadow.rotate(by: .degrees(deg))
                    shadow.translateBy(x: -200, y: -210)
                    Art.tree(&shadow, color: .black)
                }
            }
        }
    }
}

/// The color tab's hero: blurred colour fields drifting (board `Color.dc.html`).
public struct GradientHeroArt: View {
    public var colors: [Color]
    public var drift: Double
    public var brightness: Double

    @State private var start = Date()

    public init(colors: [Color], drift: Double = 0.24, brightness: Double = 0.9) {
        self.colors = colors; self.drift = drift; self.brightness = brightness
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: drift <= 0)) { tl in
            let t = tl.date.timeIntervalSince(start)
            Canvas { ctx, size in
                let s = size.width / 344
                ctx.scaleBy(x: s, y: s)
                ctx.fill(Path(CGRect(x: 0, y: 0, width: 344, height: size.height / s)), with: .color(Color(hex: 0x1A0630)))
                let palette = colors.isEmpty ? [Color(hex: 0xFF4D00)] : colors
                let blobs: [(Double, Double, Double)] = [(70, 60, 80), (250, 40, 90), (190, 170, 90), (320, 170, 60)]
                // 9 s alternate: rotate up to 25° and scale up to 1.15 around (172, 95).
                let period = 9 / max(0.2, drift / 0.24)
                let x = (1 - cos(t * .pi / period)) / 2 * min(1, drift / 0.24)
                ctx.drawLayer { layer in
                    layer.addFilter(.blur(radius: 34 * s * 1.3))
                    layer.opacity = min(1, brightness / 0.9)
                    layer.translateBy(x: 172, y: 95)
                    layer.rotate(by: .degrees(25 * x))
                    layer.scaleBy(x: 1 + 0.15 * x, y: 1 + 0.15 * x)
                    layer.translateBy(x: -172, y: -95)
                    for (i, b) in blobs.enumerated() {
                        let c = i < palette.count ? palette[i] : (i == 3 ? Color(hex: 0x00B3FF) : palette[i % palette.count])
                        layer.fill(Path(ellipseIn: CGRect(x: b.0 - b.2, y: b.1 - b.2, width: 2 * b.2, height: 2 * b.2)), with: .color(c))
                    }
                }
            }
        }
    }
}

/// A CSS-like linear gradient at `angle` degrees (0 = up, 90 = right), for gradient cards.
public struct AngledGradient: View {
    public var stops: [Gradient.Stop]
    public var angle: Double
    public var radial: Bool

    public init(stops: [Gradient.Stop], angle: Double, radial: Bool = false) { self.stops = stops; self.angle = angle; self.radial = radial }

    public var body: some View {
        if radial {
            GeometryReader { g in
                RadialGradient(stops: stops, center: UnitPoint(x: 0.3, y: 0.3), startRadius: 0, endRadius: max(g.size.width, g.size.height) * 0.99)
            }
        } else {
            let r = angle * .pi / 180
            let dx = sin(r), dy = -cos(r)
            let k = abs(dx) + abs(dy)
            LinearGradient(stops: stops, startPoint: UnitPoint(x: 0.5 - dx * k / 2, y: 0.5 - dy * k / 2),
                           endPoint: UnitPoint(x: 0.5 + dx * k / 2, y: 0.5 + dy * k / 2))
        }
    }
}

/// The objects tab's hero (board `Objects.dc.html`, 344×280): an isometric grid building around the cube and its
/// outline being traced. `progress` 0…1 grows the traced outline.
public struct ObjectsHeroArt: View {
    public var progress: Double
    public init(progress: Double = 1) { self.progress = progress }

    public var body: some View {
        Canvas { ctx, size in
            let s = size.width / 344
            ctx.scaleBy(x: s, y: s)
            ctx.fill(Path(CGRect(x: 0, y: 0, width: 344, height: 280)), with: .color(Color(hex: 0x050505)))
            let grid = Color(hex: 0x9FE8FF)
            for k in 0..<21 {
                let off = -27.4 + 28 * Double(k)
                let o: Double = k < 6 ? 0.14 : k < 8 ? 0.4 : k < 13 ? 0.85 : k < 15 ? 0.4 : 0.14
                var p = Path()
                p.move(to: CGPoint(x: -20, y: off)); p.addLine(to: CGPoint(x: 364, y: off - 213.2))
                p.move(to: CGPoint(x: -20, y: off - 213.2)); p.addLine(to: CGPoint(x: 364, y: off))
                ctx.stroke(p, with: .color(grid.opacity(o)), lineWidth: 1)
            }
            for (i, x) in stride(from: 22.0, through: 322, by: 30).enumerated() {
                let o = i < 2 || i > 8 ? 0.15 : 0.6
                ctx.stroke(Path { $0.move(to: CGPoint(x: x, y: 0)); $0.addLine(to: CGPoint(x: x, y: 280)) }, with: .color(grid.opacity(o)), lineWidth: 1)
            }
            ctx.fill(Path { p in p.addLines([CGPoint(x: 172, y: 46), CGPoint(x: 262, y: 96), CGPoint(x: 172, y: 146), CGPoint(x: 82, y: 96)]); p.closeSubpath() },
                     with: .color(Color(hex: 0x0B2B33).opacity(0.6)))
            var dashed = Path()
            for (a, b) in [((82.0, 196.0), (172.0, 246.0)), ((172, 246), (262, 196)), ((262, 196), (262, 96)), ((172, 146), (172, 246))] {
                dashed.move(to: CGPoint(x: a.0, y: a.1)); dashed.addLine(to: CGPoint(x: b.0, y: b.1))
            }
            ctx.stroke(dashed, with: .color(Color(hex: 0x3D6B75)), style: StrokeStyle(lineWidth: 2, dash: [3, 5]))
            let trace: [CGPoint] = [CGPoint(x: 82, y: 196), CGPoint(x: 82, y: 96), CGPoint(x: 172, y: 46), CGPoint(x: 262, y: 96), CGPoint(x: 172, y: 146), CGPoint(x: 82, y: 96)]
            var lit = Path()
            lit.move(to: CGPoint(x: 172, y: 46)); lit.addLine(to: CGPoint(x: 262, y: 96)); lit.addLine(to: CGPoint(x: 172, y: 146))
            lit.addLine(to: CGPoint(x: 82, y: 96)); lit.closeSubpath()
            lit.move(to: CGPoint(x: 82, y: 96)); lit.addLine(to: CGPoint(x: 82, y: 196))
            let traced = lit.trimmedPath(from: 0, to: max(0, min(1, progress)))
            let glow = Color(hex: 0xE9FBFF)
            ctx.drawLayer { g in
                g.addFilter(.blur(radius: 2.4 * s * Art.blurScale))
                g.stroke(traced, with: .color(glow), lineWidth: 3)
                g.fill(Path(CGRect(x: 77, y: 214, width: 10, height: 10)), with: .color(glow))
            }
            ctx.stroke(traced, with: .color(glow), lineWidth: 3)
            ctx.fill(Path(CGRect(x: 77, y: 214, width: 10, height: 10)), with: .color(glow))
            _ = trace
        }
    }
}

/// The camera view stand-in (370×278): the desk with the cube, lamp and frame, used when the camera is not
/// available (simulator, demo) and under overlays.
public struct DeskSceneArt: View {
    public init() {}

    public var body: some View {
        Canvas { ctx, size in
            let s = size.width / 370
            ctx.scaleBy(x: s, y: s)
            ctx.fill(Path(CGRect(x: 0, y: 0, width: 370, height: 278)), with: .color(Color(hex: 0x17161A)))
            ctx.fill(Path(CGRect(x: 0, y: 0, width: 370, height: 172.36)), with: .color(Color(hex: 0x1D1C20)))
            ctx.fill(Path { $0.addLines([CGPoint(x: 0, y: 172.36), CGPoint(x: 370, y: 161.24), CGPoint(x: 370, y: 278), CGPoint(x: 0, y: 278)]) },
                     with: .color(Color(hex: 0x141312)))
            ctx.drawLayer { g in
                g.addFilter(.blur(radius: 1.6 * s * Art.blurScale))
                func poly(_ pts: [(Double, Double)], _ c: UInt32) {
                    g.fill(Path { $0.addLines(pts.map { CGPoint(x: $0.0, y: $0.1) }); $0.closeSubpath() }, with: .color(Color(hex: c)))
                }
                poly([(173.9, 100.08), (223.94, 127.88), (173.9, 155.68), (123.86, 127.88)], 0x3A3A3C)
                poly([(123.86, 127.88), (173.9, 155.68), (173.9, 211.28), (123.86, 183.48)], 0x2A2A2C)
                poly([(173.9, 155.68), (223.94, 127.88), (223.94, 183.48), (173.9, 211.28)], 0x202022)
                g.fill(Path(ellipseIn: CGRect(x: 173.9 - 55.04, y: 221.28 - 14, width: 110.09, height: 28)), with: .color(Color(hex: 0x0A0A0A).opacity(0.7)))
                g.fill(Path(CGRect(x: 288.6, y: 83.4, width: 12, height: 88.96)), with: .color(Color(hex: 0x2A2928)))
                poly([(281.2, 83.4), (307.1, 61.16), (318.2, 75.06), (296, 91.74)], 0x333230)
                g.fill(Path(CGRect(x: 22.2, y: 44.48, width: 59.2, height: 83.4)), with: .color(Color(hex: 0x222124)))
            }
        }
    }
}
