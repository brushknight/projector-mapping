import SwiftUI
import PMKit
import PMDesign

/// Light colour of a layer for the native previews (the board draws 3200 K as #FFD9A6, a blackbody softened with white).
func lightColor(_ light: Light?) -> Color {
    guard let c = light?.color else { return Color(hex: 0xFFD9A6) }
    if c.mode == "hsi" { return Color(hue: c.hue / 360, saturation: c.sat * 0.85, brightness: 1) }
    var (r, g, b) = LightMath.kelvin(c.kelvin)
    let w = 0.45
    r += (1 - r) * w; g += (1 - g) * w; b += (1 - b) * 0.35
    if c.tint > 0 { g = max(0, g - c.tint * 0.3) }
    if c.tint < 0 { r = max(0, r + c.tint * 0.3); b = max(0, b + c.tint * 0.3) }
    return Color(.sRGB, red: r, green: g, blue: b)
}

/// Native stand-ins for the web preview, per tab.
struct BackdropArt: View {
    enum Focus { case light, live, gradient, photo }
    var focus: Focus
    @Environment(AppModel.self) private var model

    var body: some View {
        let layers = model.layers(stack).filter(\.visible)
        switch focus {
        case .light, .live:
            let gobo = layers.first { $0.kind == "gobo" }
            let tree = focus == .live && layers.contains { $0.kind == "procedural" && $0.ref.hasPrefix("tree") }
            if let gobo, let light = gobo.light {
                LightHeroArt(gobo: gobo.ref, angle: light.angle, softness: light.softness, intensity: light.intensity,
                             color: lightColor(light), tree: tree)
            } else {
                LightHeroArt(gobo: "spot", angle: 0, softness: 0.6, intensity: 0.2, color: Color(hex: 0xFFD9A6), tree: tree)
            }
        case .gradient:
            if let g = layers.first(where: { $0.kind == "gradient" }) {
                GradientHeroArt(colors: stops(g).map(\.color), drift: g.param("drift") ?? 0.24, brightness: g.param("brightness") ?? 0.9)
            } else {
                Palette.hero
            }
        case .photo:
            if let p = layers.first(where: { $0.kind == "photo" }) {
                PhotoHero(layer: p)
            } else {
                Palette.hero
            }
        }
    }

    /// The stack each tab's stand-in draws (the tab's own mode).
    var stack: String {
        switch focus {
        case .light: "static"
        case .live: "live"
        case .gradient: "color"
        case .photo: "scenery"
        }
    }

    func stops(_ layer: Layer) -> [Gradient.Stop] {
        let s = (try? layer.params["stops"]?.decode([GradientStop].self)) ?? []
        return s.map { Gradient.Stop(color: Color(css: $0.color) ?? .black, location: $0.pos) }
    }
}

/// The scenery hero: the photo with its blur, brightness and warmth.
struct PhotoHero: View {
    var layer: Layer
    var body: some View {
        let blur = layer.param("blur") ?? 0.74
        let brightness = layer.param("brightness") ?? 0.66
        let warmth = layer.param("warmth") ?? 0
        GeometryReader { g in
            SceneryImage(ref: layer.ref)
                .frame(width: g.size.width, height: g.size.height)
                .blur(radius: blur * 9.5)
                .scaleEffect(1 + blur * 0.114)
                .overlay(Color.black.opacity(max(0, 0.66 - brightness) * 0.9))
                .overlay { Rectangle().fill(Color(hex: warmth >= 0 ? 0xFF8A2A : 0x2A7BFF)).opacity(abs(warmth) * 0.12).blendMode(.overlay) }
                .clipped()
        }
    }
}

/// A scenery photo: bundled copy first (offline), else the server's `/catalog/assets/scenery/<id>.jpg` or `/a/<sha>`.
struct SceneryImage: View {
    var ref: String
    @Environment(AppModel.self) private var model

    var body: some View {
        if let img = Self.bundled(ref) {
            Image(uiImage: img).resizable().scaledToFill()
        } else if let url = remoteURL {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { Palette.track }
            }
        } else {
            Palette.track
        }
    }

    var remoteURL: URL? {
        guard let api = model.api else { return nil }
        if ref.hasPrefix("asset:") { return api.assetURL(sha: String(ref.dropFirst(6))) }
        let path = model.catalog.scenery(ref)?.asset ?? "scenery/\(ref).jpg"
        return api.catalogAssetURL(path)
    }

    @MainActor static var cache: [String: UIImage] = [:]

    @MainActor static func bundled(_ id: String) -> UIImage? {
        if let c = cache[id] { return c }
        guard let url = Bundle.main.url(forResource: id, withExtension: "jpg", subdirectory: "photos"),
              let img = UIImage(contentsOfFile: url.path) else { return nil }
        cache[id] = img
        return img
    }
}
