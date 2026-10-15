import SwiftUI
import PMKit
import PMDesign

/// Board `phone-addlayer`: search, category pills and catalog cards; a tap puts the layer on top of the stack.
struct AddLayerSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var category = "all"

    struct Item: Identifiable {
        var id: String
        var name: String
        var category: String
        var kind: String
        var animated: Bool
        var description: String
    }

    /// Live shadows first, then the gobos not on the wall yet, then the rest (the board's order).
    var items: [Item] {
        let cat = model.catalog
        let inStack = Set(model.layers("live").map(\.ref) + model.attachments("live").map(\.gobo))
        func p(_ x: ProceduralItem) -> Item { Item(id: x.id, name: x.name, category: x.category, kind: "procedural", animated: x.animated, description: "") }
        // Gobos join the live stack as attachments in front of its light (§15), listed under "shadows".
        func g(_ x: GoboItem) -> Item { Item(id: x.id, name: x.name, category: "shadows", kind: "gobo", animated: false, description: x.description) }
        let nature = cat.procedural.filter { $0.category == "nature" }.map(p)
        let lateGobos: Set<String> = ["dots", "spot"]
        let gobos = cat.gobos.filter { !inStack.contains($0.id) && $0.id != "tree" && $0.id != "palm" }
        let first = gobos.filter { !lateGobos.contains($0.id) }.map(g)
        let dapple = cat.procedural.filter { $0.id == "dapple" }.map(p)
        let others = cat.procedural.filter { $0.category != "nature" && $0.id != "dapple" }.map(p)
        return nature + first + dapple + others + gobos.filter { lateGobos.contains($0.id) }.map(g)
    }

    var categories: [String] {
        let order = ["all", "shadows", "nature", "weather", "light", "texture"]
        let present = Set(items.map(\.category))
        return order.filter { $0 == "all" || present.contains($0) } + present.subtracting(order).sorted()
    }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = items.filter { (category == "all" || $0.category == category) && (q.isEmpty || $0.name.contains(q) || $0.category.contains(q) || $0.description.contains(q)) }
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                Text("add layer").titleStyle(26)
                Spacer()
                IconPill(.close, size: 16, label: "close") { dismiss() }
            }
            .padding(.top, 4)
            SearchField("search shadows, weather, light", text: $query)
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(categories, id: \.self) { c in
                        PillButton(c, on: c == category) { category = c }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(shown) { item in
                        ImageCard(item.name, badge: item.animated ? "live" : nil, action: { add(item) }) { CatalogThumb(item.id) { GoboArt(GoboFallback.art(item.id, category: model.catalog.gobo(item.id)?.browseCategory ?? "")) } }
                    }
                }
                .padding(.bottom, 20)
                if shown.isEmpty {
                    Text("nothing matches \"\(query)\".").font(.pm(14)).foregroundStyle(Palette.dim).padding(.top, 40)
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .presentationBackground(Palette.sheet)
        .presentationCornerRadius(38)
        .presentationDragIndicator(.visible)
        .presentationDetents([.large])
    }

    func add(_ item: Item) {
        if item.kind == "gobo", let g = model.catalog.gobo(item.id), let a = try? JSONValue(encoding: model.catalog.newAttachment(g)) {
            if model.light("live") == nil { model.edit(.setLight(mode: "live", field: ["intensity"], value: 0.85)) }
            model.edit(.addAttachment(mode: "live", attachment: a))
            dismiss()
            return
        }
        let light = (try? JSONValue(encoding: Light(intensity: 0.8, softness: 0.62))) ?? [:]
        var params: JSONValue = [:]
        var blend = "normal"
        if item.kind == "procedural", let p = model.catalog.procedural(item.id) {
            params = .object(p.defaults)
            if p.category == "nature" { blend = "multiply" }
        }
        let layer: JSONValue = ["id": .string(NewID.make("lay")), "kind": .string(item.kind), "ref": .string(item.id), "name": .string(item.name),
                                "visible": true, "opacity": 1, "blend": .string(blend), "light": light, "params": params]
        model.edit(.addLayer(mode: "live", layer: layer, index: nil))
        dismiss()
    }
}
