import SwiftUI
import PMKit
import PMDesign

/// Light colour of a layer for the native previews (the board draws 3200 K as #FFD9A6, a blackbody softened with white).
func lightColor(_ light: Light?) -> Color {
    guard let c = light?.color else { return Color(hex: 0xFFD9A6) }
    return lightColor(c)
}

/// A stack light's colour for the native previews: its colour layer's middle colour, else its CCT / HSI colour.
@MainActor
func lightColor(_ light: StackLight?, catalog: Catalog) -> Color {
    guard let light else { return Color(hex: 0xFFD9A6) }
    if let layer = light.colorLayer {
        if layer.kind == "gradient", let g = catalog.gradient(layer.ref), !g.stops.isEmpty {
            return Color(css: g.stops[g.stops.count / 2].color) ?? .white
        }
        if layer.kind == "generator" {
            if let c = layer.params["colorA"]?.string { return Color(css: c) ?? .white }
            if let k = layer.params["fromKelvin"]?.double { return lightColor(LightColor(kelvin: k)) }
            return Color(hue: 0.08, saturation: 0.7, brightness: 1)
        }
    }
    return lightColor(light.color)
}

func lightColor(_ c: LightColor) -> Color {
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
            let tree = focus == .live && layers.contains { $0.kind == "procedural" && $0.ref.hasPrefix("tree") }
            StackLightArt(mode: stack, tree: tree)
        case .gradient:
            if let g = layers.first(where: { $0.kind == "gradient" }) {
                GradientHeroArt(colors: stops(g).map(\.color), drift: g.param("drift") ?? 0.24, brightness: g.param("brightness") ?? 0.9)
            } else if let g = layers.first(where: { $0.kind == "generator" }) {
                GeneratorSwatch(ref: g.ref, params: g.params)
            } else {
                Palette.hero
            }
        case .photo:
            if let p = layers.first(where: { $0.kind == "photo" || $0.kind == "video" }) {
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

/// The scenery hero: the photo (or a video's still) with its blur, brightness and warmth.
struct PhotoHero: View {
    var layer: Layer
    @Environment(AppModel.self) private var model

    @ViewBuilder var picture: some View {
        if layer.kind == "video" {
            VideoThumb(video: model.videos.first { $0.ref == layer.ref }, ref: layer.ref)
        } else {
            SceneryImage(ref: layer.ref)
        }
    }

    var body: some View {
        let blur = layer.param("blur") ?? 0.74
        let brightness = layer.param("brightness") ?? 0.66
        let warmth = layer.param("warmth") ?? 0
        GeometryReader { g in
            picture
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

/// The native stand-in of a light stack (§15): the first visible attachment under the stack light, slid and moved
/// like the wall (slide plus the light's motion at the server clock).
struct StackLightArt: View {
    var mode: String
    var tree: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        let light = model.light(mode)
        let att = model.attachments(mode).first { $0.visible }
        let moving = light?.motion?.on == true || att?.motion?.on == true
        TimelineView(.animation(minimumInterval: 1 / 20, paused: !moving)) { _ in
            GeometryReader { g in
                let now = model.serverNowMs
                let lm = light?.motion?.sample(serverNowMs: now)
                let am = att?.motion?.sample(serverNowMs: now)
                let dx = (light?.slide.x ?? 0) + (lm?.offset.x ?? 0) + (am?.offset.x ?? 0)
                let dy = (light?.slide.y ?? 0) + (lm?.offset.y ?? 0) + (am?.offset.y ?? 0)
                Group {
                    if let light, let att {
                        LightHeroArt(gobo: GoboFallback.art(att.gobo, category: model.catalog.gobo(att.gobo)?.browseCategory ?? ""),
                                     angle: att.rotation + (lm?.rotate ?? 0) + (am?.rotate ?? 0), softness: 1 - light.focus,
                                     intensity: light.intensity * att.opacity + (1 - att.opacity) * 0.3,
                                     color: lightColor(light, catalog: model.catalog), tree: tree)
                    } else if let light {
                        lightColor(light, catalog: model.catalog).opacity(0.25 + 0.6 * light.intensity)
                            .overlay { if tree { LightHeroArt(gobo: "spot", intensity: 0, tree: true) } }
                    } else {
                        LightHeroArt(gobo: "spot", angle: 0, softness: 0.6, intensity: 0.2, color: Color(hex: 0xFFD9A6), tree: tree)
                    }
                }
                .frame(width: g.size.width, height: g.size.height)
                .offset(x: dx * g.size.width, y: dy * g.size.height)
                .background(Color(hex: 0x0D0B09))
                .clipped()
            }
        }
    }
}
