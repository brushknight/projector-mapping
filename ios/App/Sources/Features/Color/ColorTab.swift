import SwiftUI
import PMKit
import PMDesign

/// Board `phone-color`: gradient cards, the colour stops (tap to edit), drift, film grain and brightness.
struct ColorTab: View {
    @Environment(AppModel.self) private var model
    private let picked = OptimisticPick()

    var body: some View {
        let found = model.layers("color").enumerated().first { $0.element.kind == "gradient" }
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
            if let found {
                editCard(index: found.offset, layer: found.element)
            } else {
                EmptyCard(title: "no gradient on the wall", detail: "pick one above to fill the wall with color.")
            }
            PresetsSection(mode: "color")
        }
        .onChange(of: found?.element.ref) { picked.settle() }
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
