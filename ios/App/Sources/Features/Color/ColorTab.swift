import SwiftUI
import PMKit
import PMDesign

/// Board `phone-color`: gradient cards and animated colours (`colorGenerators`), the colour stops (tap to edit), drift,
/// film grain and brightness, or the animated colour's own controls. A scrub rail on the right runs through them all.
struct ColorTab: View {
    @Environment(AppModel.self) private var model
    private let picked = OptimisticPick()

    var body: some View {
        let found = model.layers("color").enumerated().first { $0.element.kind == "gradient" || $0.element.kind == "generator" }
        TabPage {
            TabHeader(title: "color")
            Hero { BackdropArt(focus: .gradient) } leading: { OnAirLabel(detail: found?.element.name) } trailing: { FormatLabel() }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(model.catalog.gradients) { g in
                    ImageCard(g.name, on: picked.show(found?.element.ref) == g.id, aspect: 1, action: { choose(g, layer: found?.element) }) {
                        GradientSwatch(item: g)
                    }
                }
            }
            if !model.catalog.colorGenerators.isEmpty {
                CapRow("animated", "\(model.catalog.colorGenerators.count)")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                    ForEach(model.catalog.colorGenerators) { g in
                        ImageCard(g.name, on: picked.show(found?.element.ref) == g.id, aspect: 1, action: { choose(g, layer: found?.element) }) {
                            GeneratorSwatch(ref: g.id, params: Catalog.defaults(g.params))
                        }
                    }
                }
            }
            if let found, found.element.kind == "generator" {
                generatorCard(index: found.offset, layer: found.element)
            } else if let found {
                editCard(index: found.offset, layer: found.element)
            } else {
                EmptyCard(title: "no gradient on the wall", detail: "pick one above to fill the wall with color.")
            }
            PresetsSection(mode: "color")
        }
        // the one-finger scrub rail through every gradient and animated colour
        .scrubRail(ScrubRail(entries: railEntries, current: found?.element.ref, hideKey: "color") { e in
            if let g = model.catalog.gradients.first(where: { $0.id == e.id }) { choose(g, layer: model.layers("color").first { $0.kind == "gradient" || $0.kind == "generator" }) }
            else if let g = model.catalog.colorGenerator(e.id) { choose(g, layer: model.layers("color").first { $0.kind == "gradient" || $0.kind == "generator" }) }
        })
        .onChange(of: found?.element.ref) { picked.settle() }
    }

    var railEntries: [ScrubEntry] {
        model.catalog.gradients.map { g in ScrubEntry(id: g.id, name: g.name, group: "gradients") { GradientSwatch(item: g) } }
            + model.catalog.colorGenerators.map { g in ScrubEntry(id: g.id, name: g.name, group: "animated") { GeneratorSwatch(ref: g.id, params: Catalog.defaults(g.params)) } }
    }

    /// Picking an animated colour replaces the color stack with that one generator layer.
    func choose(_ g: ColorGeneratorItem, layer: Layer?) {
        if let layer, layer.ref == g.id, model.layers("color").count == 1 { return }
        picked.tap(g.id)
        let pickedLayer = StackPick.generator(ref: g.id, name: g.name, defaults: Catalog.defaults(g.params), keeping: layer, id: NewID.make("lay"))
        model.pickFast(path: ScenePath.layers("color"), value: [pickedLayer], fallback: .replaceStack(mode: "color", layers: [pickedLayer]))
    }

    /// An animated colour's controls: its colours (tap to edit) and its number params.
    func generatorCard(index i: Int, layer: Layer) -> some View {
        let live = model.hub.isLive
        let spec = model.catalog.colorGenerator(layer.ref)?.params ?? ParamList()
        let colors = spec.items.filter { $0.spec.type == "color" }
        return Card {
            CapRow(model.catalog.colorGenerator(layer.ref)?.name ?? layer.name, model.catalog.colorGenerator(layer.ref)?.description ?? "", padding: 2)
            if !colors.isEmpty {
                HStack(spacing: 10) {
                    ForEach(colors) { p in
                        StopButton(color: Color(css: layer.params[p.key]?.string ?? p.spec.default?.string) ?? .black) { c in
                            model.param(ScenePath.param("color", i, p.key), .string(c))
                        }
                    }
                }
            }
            ForEach(spec.items.filter { $0.spec.isNumeric }) { p in
                let v = layer.params[p.key]?.double ?? p.spec.default?.double ?? p.spec.lower
                FillSlider(p.spec.label ?? p.key, icon: .param(p.key), value: p.spec.fraction(v), enabled: live, format: { Fmt.param(p.key, p.spec, p.spec.value(at: $0)) }) {
                    model.param(ScenePath.param("color", i, p.key), .number(p.spec.value(at: $0)))
                }
            }
        }
    }

    /// Picking a gradient replaces the color stack with that one gradient.
    func choose(_ g: GradientItem, layer: Layer?) {
        if let layer, layer.ref == g.id, model.layers("color").count == 1 { return }
        picked.tap(g.id)
        let pickedLayer = StackPick.gradient(ref: g.id, name: g.name, defaults: g.defaults, keeping: layer, id: NewID.make("lay"))
        model.pickFast(path: ScenePath.layers("color"), value: (try? JSONValue(encoding: pickedLayer)).map { [$0] } ?? [], fallback: .replaceStack(mode: "color", layers: [pickedLayer]))
    }

    func stops(_ layer: Layer) -> [GradientStop] { (try? layer.params["stops"]?.decode([GradientStop].self)) ?? [] }

    func editCard(index i: Int, layer: Layer) -> some View {
        let live = model.hub.isLive
        let stops = stops(layer)
        return Card {
            CapRow("colors", "tap to edit", padding: 2)
            HStack(spacing: 10) {
                ForEach(Array(stops.enumerated()), id: \.offset) { k, stop in
                    StopButton(color: Color(css: stop.color) ?? .black) { c in
                        model.param(ScenePath.layer("color", i, "params", "stops", "\(k)", "color"), .string(c))
                    }
                    .contextMenu {
                        if stops.count > 2 {
                            Button("remove color", role: .destructive) { setStops(layer, stops.enumerated().filter { $0.offset != k }.map(\.element)) }
                        }
                    }
                }
                if stops.count < 6 {
                    Button { addStop(layer, stops) } label: {
                        Icon(.plus, size: 18).frame(width: 48, height: 48).foregroundStyle(Palette.ink).background(Palette.track, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("add color")
                }
            }
            let specs = model.catalog.gradientParams
            slider("drift", icon: .wind, i, layer, specs, live)
            slider("grain", icon: .grain, i, layer, specs, live)
            slider("brightness", icon: .sun, i, layer, specs, live)
        }
    }

    @ViewBuilder
    func slider(_ key: String, icon: LineIcon, _ i: Int, _ layer: Layer, _ specs: ParamList, _ live: Bool) -> some View {
        let spec = specs[key] ?? ParamSpec(type: "number", min: 0, max: 1)
        let v = layer.param(key) ?? spec.default?.double ?? 0
        FillSlider(spec.label ?? key, icon: icon, value: spec.fraction(v), enabled: live, format: { Fmt.param(key, spec, spec.value(at: $0)) }) {
            model.param(ScenePath.param("color", i, key), .number(spec.value(at: $0)))
        }
    }

    func setStops(_ layer: Layer, _ stops: [GradientStop]) {
        let n = max(1, stops.count - 1)
        let spaced = stops.enumerated().map { GradientStop(color: $0.element.color, pos: (Double($0.offset) / Double(n) * 100).rounded() / 100) }
        guard let v = try? JSONValue(encoding: spaced) else { return }
        model.edit(.setLayerField(layerId: layer.id, field: ["params", "stops"], value: v))
    }

    func addStop(_ layer: Layer, _ stops: [GradientStop]) {
        var next = stops
        let last = UIColor(Color(css: stops.last?.color) ?? .white)
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        last.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
        next.append(GradientStop(color: hex(UIColor(hue: (h + 0.12).truncatingRemainder(dividingBy: 1), saturation: max(s, 0.6), brightness: max(b, 0.8), alpha: 1)), pos: 1))
        setStops(layer, next)
    }
}

func hex(_ c: UIColor) -> String {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    c.getRed(&r, green: &g, blue: &b, alpha: &a)
    return String(format: "#%02x%02x%02x", Int(max(0, min(1, r)) * 255), Int(max(0, min(1, g)) * 255), Int(max(0, min(1, b)) * 255))
}

/// A 48 pt colour stop; tapping opens the system colour picker.
struct StopButton: View {
    var color: Color
    var onChange: (String) -> Void
    @State private var picked: Color = .black

    var body: some View {
        ZStack {
            Circle().fill(color).overlay(Circle().strokeBorder(Color.white.opacity(0.15), lineWidth: 2))
            ColorPicker("", selection: $picked, supportsOpacity: false)
                .labelsHidden()
                .scaleEffect(2.2)
                .opacity(0.02)
        }
        .frame(width: 48, height: 48)
        .onAppear { picked = color }
        .onChange(of: color) { _, c in picked = c }
        .onChange(of: picked) { _, c in
            let h = hex(UIColor(c))
            if h != hex(UIColor(color)) { onChange(h) }
        }
        .accessibilityLabel("color stop \(hex(UIColor(color)))")
    }
}

/// A gradient card from the catalog (`ultraviolet` is radial, as on the board).
struct GradientSwatch: View {
    var item: GradientItem
    var body: some View {
        let stops = item.stops.map { Gradient.Stop(color: Color(css: $0.color) ?? .black, location: $0.pos) }
        AngledGradient(stops: stops, angle: item.angle, radial: item.id == "ultraviolet")
    }
}

/// A still stand-in for an animated colour (`colorGenerators`), from its colour params.
struct GeneratorSwatch: View {
    var ref: String
    var params: JSONObject

    var body: some View {
        let a = Color(css: params["colorA"]?.string) ?? Color(hex: 0xFF4D00)
        let b = Color(css: params["colorB"]?.string) ?? Color(hex: 0x2F6BFF)
        switch ref {
        case "hue-cycle":
            AngularGradient(colors: [.red, .orange, .yellow, .green, .cyan, .blue, .purple, .pink, .red], center: .center)
        case "color-flow":
            ZStack {
                Color(css: params["colorC"]?.string) ?? .purple
                RadialGradient(colors: [a, .clear], center: UnitPoint(x: 0.3, y: 0.3), startRadius: 0, endRadius: 90)
                RadialGradient(colors: [b, .clear], center: UnitPoint(x: 0.7, y: 0.75), startRadius: 0, endRadius: 90)
            }
        case "pulse":
            RadialGradient(colors: [a, b], center: .center, startRadius: 0, endRadius: 90)
        case "aurora":
            LinearGradient(stops: [.init(color: .black, location: 0.05), .init(color: a, location: 0.45), .init(color: b, location: 0.78), .init(color: .black, location: 1)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        case "kelvin-cycle":
            LinearGradient(colors: [lightColor(LightColor(kelvin: params["fromKelvin"]?.double ?? 2700)), .white, lightColor(LightColor(kelvin: params["toKelvin"]?.double ?? 6500))],
                           startPoint: .leading, endPoint: .trailing)
        default:
            LinearGradient(colors: [a, b], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}
