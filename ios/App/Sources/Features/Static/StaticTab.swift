import SwiftUI
import PMKit
import PMDesign

/// Board `phone-static` / `phone-staticfx`: the base gobo layer's attachment, light and effects.
struct StaticTab: View {
    @Environment(AppModel.self) private var model
    @State private var segment: Int?

    var body: some View {
        let base = model.layers("static").enumerated().first { $0.element.kind == "gobo" }
        TabPage {
            TabHeader(title: "static")
            Hero { BackdropArt(focus: .light) } leading: { OnAirLabel() } trailing: { FormatLabel() }
            attachments(base?.element)
            if let base, let light = base.element.light {
                lightCard(index: base.offset, light: light)
                colorCard(index: base.offset, layer: base.element, light: light)
            } else {
                EmptyCard(title: "no attachment on the wall", detail: "pick one above to light the wall with it.")
            }
            PresetsSection(mode: "static")
        }
    }

    // MARK: Attachments

    func attachments(_ layer: Layer?) -> some View {
        let gobos = model.catalog.gobos
        return VStack(spacing: 10) {
            CapRow("attachment", "\(gobos.count)")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
                ForEach(gobos) { g in
                    Tile(g.name, on: layer?.ref == g.id) { choose(g, layer: layer) } art: { GoboArt(g.id) }
                }
            }
        }
    }

    /// Picking a gobo replaces the static stack with that one gobo and keeps the previous gobo's light.
    func choose(_ gobo: GoboItem, layer: Layer?) {
        if let layer, layer.ref == gobo.id, model.layers("static").count == 1 { return }
        model.edit(.replaceStack(mode: "static", layers: [StackPick.gobo(gobo, keeping: layer, id: NewID.make("lay"))]))
    }

    // MARK: Light

    func lightCard(index i: Int, light: Light) -> some View {
        let live = model.hub.isLive
        let angle = ParamSpec(type: "number", min: -90, max: 90)
        return Card {
            FillSlider("intensity", icon: .sun, value: light.intensity, enabled: live) { model.param(ScenePath.light("static", i, "intensity"), .number($0)) }
            FillSlider("softness", icon: .softness, value: light.softness, enabled: live) { model.param(ScenePath.light("static", i, "softness"), .number($0)) }
            FillSlider("angle", icon: .angle, value: angle.fraction(light.angle), enabled: live, format: { Fmt.signed(angle.value(at: $0), unit: "°") }) {
                model.param(ScenePath.light("static", i, "angle"), .number(angle.value(at: $0).rounded()))
            }
        }
    }

    // MARK: White / color / effects

    func colorCard(index i: Int, layer: Layer, light: Light) -> some View {
        let initial = model.debugScreen == .staticfx ? 2 : (light.color.mode == "hsi" ? 1 : 0)
        let seg = segment ?? initial
        let live = model.hub.isLive
        return Card {
            Segmented(["white", "color", "effects"], selected: seg) { n in
                segment = n
                if n == 0, light.color.mode != "cct" { model.edit(.setLayerField(layerId: layer.id, field: ["light", "color", "mode"], value: "cct")) }
                if n == 1, light.color.mode != "hsi" { model.edit(.setLayerField(layerId: layer.id, field: ["light", "color", "mode"], value: "hsi")) }
            }
            switch seg {
            case 0: white(i, layer: layer, light: light, live: live)
            case 1: hsi(i, light: light, live: live)
            default: effects(i, layer: layer, light: light, live: live)
            }
        }
    }

    static let cctGradient = Gradient(colors: [0xFF880D, 0xFFAA5F, 0xFFC392, 0xFFD7B7, 0xFFE7D4, 0xFFF6EC, 0xF9F6FF, 0xE3E9FF, 0xD7E2FF, 0xCFDDFF, 0xC9DAFF].map { Color(hex: $0) })
    static let tintGradient = Gradient(colors: [Color(hex: 0x7DD67A), Color(hex: 0xEEEEEE), Color(hex: 0xD67ACB)])
    static let hueGradient = Gradient(colors: [0xFF0000, 0xFF7F00, 0xFFFF00, 0x7FFF00, 0x00FF00, 0x00FF7F, 0x00FFFF, 0x007FFF, 0x0000FF, 0x7F00FF, 0xFF00FF, 0xFF007F].map { Color(hex: $0) })

    func stripRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title).capStyle()
            Spacer()
            Text(value).font(.pmMono(15)).foregroundStyle(Palette.ink).monospacedDigit()
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    func white(_ i: Int, layer: Layer, light: Light, live: Bool) -> some View {
        VStack(spacing: 9) {
            stripRow("temperature", value: Fmt.kelvin(light.color.kelvin))
            StripSlider(gradient: Self.cctGradient, value: (light.color.kelvin - 2000) / 8000, enabled: live) { f in
                model.param(ScenePath.light("static", i, "color", "kelvin"), .number(((2000 + f * 8000) / 50).rounded() * 50))
            }
        }
        VStack(spacing: 9) {
            stripRow("tint", value: Fmt.tint(light.color.tint))
            StripSlider(gradient: Self.tintGradient, value: (light.color.tint + 1) / 2, enabled: live) { f in
                model.param(ScenePath.light("static", i, "color", "tint"), .number(((f * 2 - 1) * 100).rounded() / 100))
            }
        }
        HStack(spacing: 8) {
            ForEach(model.catalog.light?.cctPresets ?? []) { p in
                PillButton(p.id, on: abs(light.color.kelvin - p.kelvin) < 1) {
                    model.edit(.setLayerField(layerId: layer.id, field: ["light", "color", "kelvin"], value: .number(p.kelvin)))
                }
            }
        }
    }

    @ViewBuilder
    func hsi(_ i: Int, light: Light, live: Bool) -> some View {
        VStack(spacing: 9) {
            stripRow("hue", value: "\(Int(light.color.hue.rounded()))°")
            StripSlider(gradient: Self.hueGradient, value: light.color.hue / 360, enabled: live) { f in
                model.param(ScenePath.light("static", i, "color", "hue"), .number((f * 360).rounded()))
            }
        }
        VStack(spacing: 9) {
            stripRow("saturation", value: Fmt.percent(light.color.sat))
            StripSlider(gradient: Gradient(colors: [.white, Color(hue: light.color.hue / 360, saturation: 0.8, brightness: 0.81)]),
                        value: light.color.sat, enabled: live) { f in
                model.param(ScenePath.light("static", i, "color", "sat"), .number((f * 100).rounded() / 100))
            }
        }
    }

    @ViewBuilder
    func effects(_ i: Int, layer: Layer, light: Light, live: Bool) -> some View {
        Text("effects animate the light itself, like the fx menu on an amaran.")
            .font(.pm(13)).foregroundStyle(Palette.dim).padding(.horizontal, 2).lineSpacing(2)
        let kinds = (model.catalog.light?.fx ?? []).filter { $0 != "none" }
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
            ForEach(kinds, id: \.self) { k in
                FXTile(k, icon: .fx(k), on: light.fx.kind == k) {
                    model.edit(.setLayerField(layerId: layer.id, field: ["light", "fx", "kind"], value: .string(light.fx.kind == k ? "none" : k)))
                }
            }
        }
        FillSlider("speed", icon: .wind, value: light.fx.speed, enabled: live) { model.param(ScenePath.light("static", i, "fx", "speed"), .number($0)) }
    }
}
