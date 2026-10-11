import SwiftUI

/// Parses SVG path data (`M L H V C S Q T A Z`, absolute and relative) into a SwiftUI `Path`, so the boards' inline
/// icons and art draw from their exact sources.
public enum SVGPath {
    public static func parse(_ d: String) -> Path {
        var path = Path()
        var s = Scanner(d)
        var cur = CGPoint.zero, start = CGPoint.zero
        var lastCtrl: CGPoint?, lastQuad: CGPoint?
        var cmd: Character = "M"
        while let next = s.peekCommandOrNumber() {
            if case .command(let c) = next { cmd = c; s.advance() }
            let rel = cmd.isLowercase
            let base = rel ? cur : .zero
            func pt() -> CGPoint? {
                guard let x = s.number(), let y = s.number() else { return nil }
                return CGPoint(x: base.x + x, y: base.y + y)
            }
            switch cmd {
            case "M", "m":
                guard let p = pt() else { return path }
                path.move(to: p); cur = p; start = p
                cmd = rel ? "l" : "L"
                lastCtrl = nil; lastQuad = nil
            case "L", "l":
                guard let p = pt() else { return path }
                path.addLine(to: p); cur = p; lastCtrl = nil; lastQuad = nil
            case "H", "h":
                guard let x = s.number() else { return path }
                cur = CGPoint(x: rel ? cur.x + x : x, y: cur.y); path.addLine(to: cur); lastCtrl = nil; lastQuad = nil
            case "V", "v":
                guard let y = s.number() else { return path }
                cur = CGPoint(x: cur.x, y: rel ? cur.y + y : y); path.addLine(to: cur); lastCtrl = nil; lastQuad = nil
            case "C", "c":
                guard let c1 = pt(), let c2 = pt(), let p = pt() else { return path }
                path.addCurve(to: p, control1: c1, control2: c2); cur = p; lastCtrl = c2; lastQuad = nil
            case "S", "s":
                guard let c2 = pt(), let p = pt() else { return path }
                let c1 = lastCtrl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                path.addCurve(to: p, control1: c1, control2: c2); cur = p; lastCtrl = c2; lastQuad = nil
            case "Q", "q":
                guard let c = pt(), let p = pt() else { return path }
                path.addQuadCurve(to: p, control: c); cur = p; lastQuad = c; lastCtrl = nil
            case "T", "t":
                guard let p = pt() else { return path }
                let c = lastQuad.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                path.addQuadCurve(to: p, control: c); cur = p; lastQuad = c; lastCtrl = nil
            case "A", "a":
                guard let rx = s.number(), let ry = s.number(), let rot = s.number(), let large = s.flag(), let sweep = s.flag(),
                      let x = s.number(), let y = s.number() else { return path }
                let p = CGPoint(x: base.x + x, y: base.y + y)
                arc(&path, from: cur, to: p, rx: rx, ry: ry, rotation: rot, large: large, sweep: sweep)
                cur = p; lastCtrl = nil; lastQuad = nil
            case "Z", "z":
                path.closeSubpath(); cur = start; lastCtrl = nil; lastQuad = nil
                if case .command = s.peekCommandOrNumber() {} else if s.peekCommandOrNumber() != nil { cmd = "L" }
            default:
                s.advance()
            }
        }
        return path
    }

    /// SVG elliptical arc → cubic Béziers (SVG spec F.6.5).
    static func arc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx: Double, ry: Double, rotation: Double, large: Bool, sweep: Bool) {
        var rx = abs(rx), ry = abs(ry)
        if rx == 0 || ry == 0 || p0 == p1 { path.addLine(to: p1); return }
        let phi = rotation * .pi / 180, cosP = cos(phi), sinP = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy
        let lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lam > 1 { rx *= lam.squareRoot(); ry *= lam.squareRoot() }
        let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coef = den == 0 ? 0 : (max(0, num / den)).squareRoot()
        if large == sweep { coef = -coef }
        let cx1 = coef * rx * y1 / ry, cy1 = -coef * ry * x1 / rx
        let cx = cosP * cx1 - sinP * cy1 + (p0.x + p1.x) / 2
        let cy = sinP * cx1 + cosP * cy1 + (p0.y + p1.y) / 2
        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
        var dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
        if !sweep && dt > 0 { dt -= 2 * .pi } else if sweep && dt < 0 { dt += 2 * .pi }
        let segs = Int(ceil(abs(dt) / (.pi / 2)))
        let step = dt / Double(segs)
        let k = 4.0 / 3.0 * tan(step / 4)
        var t = t1
        for _ in 0..<segs {
            let c1 = (cos(t), sin(t)), c2 = (cos(t + step), sin(t + step))
            func map(_ x: Double, _ y: Double) -> CGPoint {
                CGPoint(x: cx + rx * x * cosP - ry * y * sinP, y: cy + rx * x * sinP + ry * y * cosP)
            }
            let q1 = map(c1.0 - k * c1.1, c1.1 + k * c1.0)
            let q2 = map(c2.0 + k * c2.1, c2.1 - k * c2.0)
            let e = map(c2.0, c2.1)
            path.addCurve(to: e, control1: q1, control2: q2)
            t += step
        }
    }

    struct Scanner {
        enum Token: Equatable { case command(Character), number }
        let chars: [Character]
        var i = 0
        init(_ s: String) { chars = Array(s) }

        mutating func skip() { while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i] == "\n" || chars[i] == "\t" { i += 1 } }

        mutating func peekCommandOrNumber() -> Token? {
            skip()
            guard i < chars.count else { return nil }
            let c = chars[i]
            if c.isLetter && c != "e" && c != "E" { return .command(c) }
            return .number
        }

        mutating func advance() { i += 1 }

        mutating func number() -> Double? {
            skip()
            let st = i
            if i < chars.count, chars[i] == "-" || chars[i] == "+" { i += 1 }
            var dot = false
            while i < chars.count {
                let c = chars[i]
                if c.isNumber { i += 1 }
                else if c == ".", !dot { dot = true; i += 1 }
                else if c == "e" || c == "E" {
                    i += 1
                    if i < chars.count, chars[i] == "-" || chars[i] == "+" { i += 1 }
                } else { break }
            }
            guard i > st else { return nil }
            return Double(String(chars[st..<i]))
        }

        /// Arc flags may be packed without separators ("a2 2 0 011 1").
        mutating func flag() -> Bool? {
            skip()
            guard i < chars.count, chars[i] == "0" || chars[i] == "1" else { return nil }
            defer { i += 1 }
            return chars[i] == "1"
        }
    }
}
