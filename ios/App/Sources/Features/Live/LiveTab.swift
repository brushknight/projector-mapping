import SwiftUI
import PMKit
import PMDesign

/// Procedural layers that the atmosphere toggles switch on and off (they stay out of the layer list).
enum Atmosphere {
    static let items: [(ref: String, title: String)] = [
        ("clouds", "clouds passing"), ("rain-glass", "rain on glass"), ("candle-flicker", "bulb flicker"), ("day-cycle", "day cycle"),
    ]
    static let refs = Set(items.map(\.ref))
    static func isAtmosphere(_ l: Layer) -> Bool { l.kind == "procedural" && refs.contains(l.ref) }
}

/// Board `phone-live`: the layer stack, the selected layer's params (from the catalog schema), atmosphere, presets.
struct LiveTab: View {
    @Environment(AppModel.self) private var model
    @State private var selectedId: String?
    @State private var attachmentId: String?
    @State private var dragging: String?
    @State private var dragOffset: CGFloat = 0

    var stack: [Layer] { model.layers("live").filter { !Atmosphere.isAtmosphere($0) }.reversed() }

    var body: some View {
        let stack = stack
        let selected = stack.first { $0.id == selectedId } ?? stack.first
        TabPage {
            TabHeader(title: "live")
            Hero { BackdropArt(focus: .live) } leading: { OnAirLabel(detail: "\(stack.count) layer\(stack.count == 1 ? "" : "s")") } trailing: { FormatLabel() }
                .modifier(HeroSlide(mode: "live"))
            VStack(spacing: 10) {
                CapRow("layers", "hold to reorder")
                if !stack.isEmpty { layerList(stack, selected: selected) }
                Button { model.showAddLayer = true } label: {
                    HStack(spacing: 8) {
                        Icon(.plus, size: 18)
                        Text("add layer").font(.pm(15)).tracking(0.2)
                    }
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .foregroundStyle(Palette.ink)
                    .background(Palette.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            if let selected { paramsCard(selected) }
            lightSection
            atmosphere
            PresetsSection(mode: "live")
        }
        .onChange(of: model.layers("live").map(\.id)) { _, ids in
            if let s = selectedId, !ids.contains(s) { selectedId = nil }
        }
    }

    // MARK: Light and attachments (§15)

    /// The live stack's light with its attachments, the same controls as the static tab. Shadow layers (tree sway,
    /// clouds) multiply into the same mask.
    @ViewBuilder
    var lightSection: some View {
        let list = model.attachments("live")
        let selected = list.first { $0.id == attachmentId } ?? list.last
        LightCard(mode: "live")
        if model.light("live") != nil {
            AttachmentBrowser(mode: "live", selected: $attachmentId)
            AttachmentList(mode: "live", selected: $attachmentId)
            if let selected { AttachmentControls(mode: "live", attachment: selected) }
            LightColorCard(mode: "live")
            SlideCard(mode: "live")
            MotionCard(mode: "live", attachment: selected)
        }
    }

    // MARK: Layer list

    func layerList(_ stack: [Layer], selected: Layer?) -> some View {
        ListCard {
            ForEach(Array(stack.enumerated()), id: \.element.id) { n, layer in
                let on = layer.id == selected?.id
                ListRow(layer.name, meta: meta(layer), on: on, separator: n > 0 && stack[n - 1].id != selected?.id) {
                    LayerThumb(layer: layer)
                } trailing: {
                    RowIconButton(layer.visible ? .eye : .eyeOff, label: layer.visible ? "hide \(layer.name)" : "show \(layer.name)") {
                        model.edit(.setLayerField(layerId: layer.id, field: ["visible"], value: .bool(!layer.visible)))
                    }
                    Icon(.grip, size: 20).frame(width: 44, height: 44).opacity(0.5)
                }
                .opacity(layer.visible || on ? 1 : 0.55)
                .contentShape(Rectangle())
                .onTapGesture { selectedId = layer.id }
                .offset(y: dragging == layer.id ? dragOffset : 0)
                .zIndex(dragging == layer.id ? 1 : 0)
                .shadow(color: .black.opacity(dragging == layer.id ? 0.5 : 0), radius: 12, y: 6)
                .gesture(reorder(layer, at: n, in: stack))
                .contextMenu {
                    Button("remove layer", role: .destructive) { model.edit(.removeLayer(layerId: layer.id)) }
                }
            }
        }
    }

    /// Hold, then drag: drop moves the layer to the row it lands on (64 pt rows).
    func reorder(_ layer: Layer, at n: Int, in stack: [Layer]) -> some Gesture {
        LongPressGesture(minimumDuration: 0.35)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .onChanged { v in
                if case .second(true, let drag) = v {
                    if dragging == nil { dragging = layer.id; selectedId = layer.id }
                    dragOffset = drag?.translation.height ?? 0
                }
            }
            .onEnded { v in
                defer { dragging = nil; dragOffset = 0 }
                guard case .second(true, let drag) = v, let drag else { return }
                let target = min(stack.count - 1, max(0, n + Int((drag.translation.height / 64).rounded())))
                guard target != n, let backdropIndex = model.layers("live").firstIndex(where: { $0.id == stack[target].id }) else { return }
                model.edit(.moveLayer(layerId: layer.id, to: backdropIndex))
            }
    }

    func meta(_ l: Layer) -> String {
        var parts: [String] = []
        if l.blend != "normal" { parts.append(l.blend) } else if l.kind == "gobo" { parts.append("base") }
        switch l.kind {
        case "gobo":
            if let c = l.light?.color { parts.append(c.mode == "hsi" ? "hue \(Int(c.hue))°" : Fmt.kelvin(c.kelvin)) }
        case "procedural":
            if let from = l.param("fromKelvin"), let to = l.param("toKelvin") {
                parts.append("\(Int(from)) → \(Int(to)) K")
                if let m = l.param("minutes") { parts.append("\(Int(m)) min") }
            } else if let first = model.catalog.params(for: l).items.first(where: { $0.spec.isNumeric }), let v = l.param(first.key) {
                parts.append("\(first.spec.label ?? first.key) \(Fmt.param(first.key, first.spec, v))")
            }
        case "gradient": parts.append("gradient")
        case "photo": parts.append("photo · \(Fmt.aperture(l.param("blur") ?? 0.74))")
        default: break
        }
        return parts.joined(separator: " · ")
    }

    // MARK: Selected layer

    func paramsCard(_ layer: Layer) -> some View {
        let index = model.layers("live").firstIndex { $0.id == layer.id } ?? 0
        let live = model.hub.isLive
        let params = model.catalog.params(for: layer).items.filter { $0.spec.isNumeric }
        let lightParams = layer.kind == "gobo" ? (model.catalog.light?.params.items ?? []) : []
        return Card {
            CapRow(layer.name, "selected", padding: 2)
            ForEach(params) { p in
                let v = layer.param(p.key) ?? p.spec.default?.double ?? p.spec.lower
                FillSlider(p.spec.label ?? p.key, icon: .param(p.key), value: p.spec.fraction(v), enabled: live,
                           format: { Fmt.param(p.key, p.spec, p.spec.value(at: $0)) }) { f in
                    model.param(ScenePath.param("live", index, p.key), .number(p.spec.value(at: f)))
                }
            }
            ForEach(lightParams) { p in
                let v = lightValue(layer.light, p.key) ?? p.spec.lower
                FillSlider(p.spec.label ?? p.key, icon: .param(p.key), value: p.spec.fraction(v), enabled: live,
                           format: { Fmt.param(p.key, p.spec, p.spec.value(at: $0)) }) { f in
                    model.param(ScenePath.light("live", index, p.key), .number(p.spec.value(at: f)))
                }
            }
            FillSlider("opacity", icon: .softness, value: layer.opacity, enabled: live) { model.param(ScenePath.layer("live", index, "opacity"), .number($0)) }
        }
    }

    func lightValue(_ light: Light?, _ key: String) -> Double? {
        guard let light else { return nil }
        switch key {
        case "intensity": return light.intensity
        case "softness": return light.softness
        case "angle": return light.angle
        case "scale": return light.scale
        default: return nil
        }
    }

    // MARK: Atmosphere

    var atmosphere: some View {
        Card(spacing: 4) {
            Text("atmosphere").capStyle().padding(EdgeInsets(top: 0, leading: 2, bottom: 6, trailing: 2))
            ForEach(Atmosphere.items, id: \.ref) { item in
                let layer = model.layers("live").first { $0.ref == item.ref }
                Toggle(item.title, isOn: Binding(get: { layer?.visible ?? false }, set: { on in set(item.ref, item.title, on: on, layer: layer) }))
                    .toggleStyle(PMSwitchStyle())
            }
        }
    }

    func set(_ ref: String, _ title: String, on: Bool, layer: Layer?) {
        if let layer {
            model.edit(.setLayerField(layerId: layer.id, field: ["visible"], value: .bool(on)))
        } else if on, let item = model.catalog.procedural(ref) {
            let light = (try? JSONValue(encoding: Light())) ?? [:]
            let new: JSONValue = ["id": .string(NewID.make("lay")), "kind": "procedural", "ref": .string(ref), "name": .string(title),
                                  "visible": true, "opacity": 1, "blend": "screen", "light": light, "params": .object(item.defaults)]
            model.edit(.addLayer(mode: "live", layer: new, index: nil))
        }
    }
}

/// A layer's 44 pt thumbnail.
struct LayerThumb: View {
    var layer: Layer
    var body: some View {
        switch layer.kind {
        case "gradient":
            let stops = ((try? layer.params["stops"]?.decode([GradientStop].self)) ?? []).map { Gradient.Stop(color: Color(css: $0.color) ?? .black, location: $0.pos) }
            AngledGradient(stops: stops, angle: layer.param("angle") ?? 135)
        case "photo":
            SceneryImage(ref: layer.ref)
        case "solid":
            Color(css: layer.params["color"]?.string) ?? .black
        case "procedural", "gobo":
            CatalogThumb(layer.ref) { GoboArt(layer.ref) }
        case "generator":
            AngledGradient(stops: [.init(color: .red, location: 0), .init(color: .green, location: 0.5), .init(color: .blue, location: 1)], angle: 90)
        default:
            GoboArt(layer.ref)
        }
    }
}
