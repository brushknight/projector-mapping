import SwiftUI
import PhotosUI
import PMKit
import PMDesign

/// Board `phone-scenery`: photo cards by category, blur / brightness / warmth / drift, and "use my photo".
struct SceneryTab: View {
    @Environment(AppModel.self) private var model
    @State private var category = "nature"
    @State private var pick: PhotosPickerItem?
    @State private var uploading = false

    static let categories = ["nature", "city", "interior", "studio", "mine"]

    var body: some View {
        let found = model.layers("scenery").enumerated().first { $0.element.kind == "photo" }
        let items = model.catalog.scenery
        let ordered = items.filter { $0.category == category } + items.filter { $0.category != category }
        TabPage {
            TabHeader(title: "scenery")
            Hero(aspect: 16 / 9) { BackdropArt(focus: .photo) } leading: {
                OnAirLabel(detail: found.map { model.catalog.scenery($0.element.ref)?.name ?? $0.element.name })
            } trailing: {
                GlassPill { Text("\(Fmt.aperture(found?.element.param("blur") ?? 0.74)) blur") }
            }
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(Self.categories, id: \.self) { c in
                        PillButton(c, on: c == category) { category = c }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            if category == "mine" {
                EmptyCard(title: "your photos", detail: "photos you send from this phone show up on the wall right away. use \"use my photo\" below.")
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(category == "mine" ? [] : ordered) { s in
                    ImageCard(s.name, on: found?.element.ref == s.id, action: { choose(s.id, name: s.name, layer: found?.element) }) {
                        SceneryImage(ref: s.id).blur(radius: 1.5).scaleEffect(1.018)
                    }
                }
            }
            if let found { controls(index: found.offset, layer: found.element) }
            PhotosPicker(selection: $pick, matching: .images) {
                HStack(spacing: 14) {
                    Group {
                        if uploading { ProgressView().tint(Palette.ink) } else { Icon(.camera, size: 22) }
                    }
                    .frame(width: 44, height: 44)
                    .background(Palette.track, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(uploading ? "sending your photo" : "use my photo").font(.pm(15)).tracking(0.2)
                        Text("blurred and color-matched on the projector").font(.pm(12)).foregroundStyle(Palette.dim)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Icon(.chevronRight, size: 18).foregroundStyle(Palette.dim)
                }
                .foregroundStyle(Palette.ink)
                .padding(16)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(uploading)
            Text("photos · unsplash").font(.pm(12)).foregroundStyle(Palette.dim).frame(maxWidth: .infinity)
        }
        .onChange(of: pick) { _, item in
            guard let item else { return }
            Task { await upload(item, layer: found?.element) }
        }
    }

    /// Picking a photo replaces the scenery stack with that one photo and keeps blur, brightness, warmth and drift.
    func choose(_ ref: String, name: String, layer: Layer?) {
        if let layer, layer.ref == ref, model.layers("scenery").count == 1 { return }
        var defaults = JSONObject()
        for p in model.catalog.photoParams.items { if let d = p.spec.default { defaults[p.key] = d } }
        model.edit(.replaceStack(mode: "scenery", layers: [StackPick.photo(ref: ref, name: name, defaults: defaults, keeping: layer, id: NewID.make("lay"))]))
    }

    func controls(index i: Int, layer: Layer) -> some View {
        let live = model.hub.isLive
        let specs = model.catalog.photoParams
        let rows: [(String, LineIcon)] = [("blur", .softness), ("brightness", .sun), ("warmth", .sun), ("drift", .wind)]
        return Card {
            ForEach(rows, id: \.0) { key, icon in
                let spec = specs[key] ?? ParamSpec(type: "number", min: 0, max: 1)
                let v = layer.param(key) ?? spec.default?.double ?? 0
                FillSlider(spec.label ?? key, icon: icon, value: spec.fraction(v), enabled: live,
                           format: { Fmt.param(key, spec, spec.value(at: $0)) }) { f in
                    model.param(ScenePath.param("scenery", i, key), .number((spec.value(at: f) * 100).rounded() / 100))
                }
            }
        }
    }

    /// Sends the picked photo as an asset and shows it as the scenery layer.
    func upload(_ item: PhotosPickerItem, layer: Layer?) async {
        defer { pick = nil; uploading = false }
        guard let api = model.api else { model.flash("Connect to the projector to send a photo."); return }
        uploading = true
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
              let jpeg = image.scaledToFit(2560).jpegData(compressionQuality: 0.85) else {
            model.flash("That photo could not be read.")
            return
        }
        do {
            let asset = try await api.uploadAsset(jpeg, filename: "scenery.jpg", kind: "photo")
            choose("asset:\(asset.sha)", name: "my photo", layer: layer)
        } catch {
            model.flash(error.localizedDescription)
        }
    }
}

extension UIImage {
    /// Downscaled so the long side is at most `side` pixels.
    func scaledToFit(_ side: CGFloat) -> UIImage {
        let long = max(size.width, size.height)
        guard long > side else { return self }
        let k = side / long
        let target = CGSize(width: size.width * k, height: size.height * k)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}
