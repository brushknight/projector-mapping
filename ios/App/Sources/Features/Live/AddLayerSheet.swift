import SwiftUI
import PMKit
import PMDesign
import PMPreview

/// Board `phone-addlayer`, the live gallery (protocol §16): every live layer as an animated tile. A tap tries it in
/// the preview at the top (`/preview?scene=<id>&try=<ref>`: the live stack with that layer, never on air); "add to
/// live" puts it on top of the stack. Shadow layers (nature, weather, texture) block light like an attachment, so
/// they join as `multiply` and bring the default stack light when the live stack has none.
struct AddLayerSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var category = "all"
    /// The tile being tried; `-pm-try <id>` starts with one (screenshots).
    @State private var trying: String? = UserDefaults.standard.string(forKey: "pm-try")
    @State private var host = PreviewHost()

    var items: [ProceduralItem] {
        let order = ["nature", "weather", "texture", "light"]
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        return model.catalog.procedural.enumerated()
            .sorted { (rank[$0.element.category] ?? .max, $0.offset) < (rank[$1.element.category] ?? .max, $1.offset) }
            .map(\.element)
    }

    var categories: [String] {
        let present = items.map(\.category)
        var seen = Set<String>()
        return ["all"] + present.filter { seen.insert($0).inserted }
    }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = items.filter { (category == "all" || $0.category == category) && (q.isEmpty || $0.name.lowercased().contains(q) || $0.category.contains(q)) }
        let tried = trying.flatMap { model.catalog.procedural($0) }
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                Text("add layer").titleStyle(26)
                Spacer()
                IconPill(.close, size: 16, label: "close") { dismiss() }
            }
            .padding(.top, 4)
            preview(tried)
            if let tried {
                HStack(spacing: 10) {
                    WideButton("add \(tried.name) to live", icon: .plus) { add(tried) }
                    IconPill(.close, size: 16, label: "stop trying \(tried.name)") { trying = nil }
                }
            }
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
                        ImageCard(item.name, meta: item.isShadow ? "blocks light" : item.category, on: item.id == trying, aspect: 16 / 9,
                                  badge: item.animated ? "live" : nil, action: { trying = item.id == trying ? nil : item.id }) {
                            AnimatedThumb(id: item.id)
                        }
                        .accessibilityHint("tries \(item.name) in the preview without putting it on air")
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
        .onDisappear { host.stop() }
    }

    /// The live stack as it is, or with the tried layer, at full size.
    func preview(_ tried: ProceduralItem?) -> some View {
        Palette.hero
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay {
                if model.demo || model.api == nil {
                    if let tried { AnimatedThumb(id: tried.id) } else { BackdropArt(focus: .live) }
                } else {
                    PreviewWebView(url: model.api?.previewURL(width: 1110, scene: model.sceneId, try: tried?.id), host: host) {
                        if let tried { AnimatedThumb(id: tried.id) } else { BackdropArt(focus: .live) }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(alignment: .topLeading) {
                GlassPill { Text(tried.map { "trying \($0.name) · not on air" } ?? "the wall now · tap a tile to try it") }.padding(10)
            }
    }

    func add(_ item: ProceduralItem) {
        if item.isShadow, model.light("live") == nil { model.edit(.setLight(mode: "live", field: ["intensity"], value: 0.85)) }
        let light = (try? JSONValue(encoding: Light(intensity: 0.8, softness: 0.62))) ?? [:]
        let layer: JSONValue = ["id": .string(NewID.make("lay")), "kind": "procedural", "ref": .string(item.id), "name": .string(item.name),
                                "visible": true, "opacity": 1, "blend": .string(item.isShadow ? "multiply" : "normal"), "light": light,
                                "params": .object(item.defaults)]
        model.edit(.addLayer(mode: "live", layer: layer, index: nil))
        trying = nil
        dismiss()
    }
}
