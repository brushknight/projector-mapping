import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import PMKit
import PMDesign

/// Board `phone-scenery`: photo cards by category, blur / brightness / warmth / drift, and "use my photo". Protocol
/// §14 adds the "videos" category (uploaded files and YouTube loops), "add from youtube" and "add video file".
struct SceneryTab: View {
    @Environment(AppModel.self) private var model
    @State private var pick: PhotosPickerItem?
    @State private var moviePick: PhotosPickerItem?
    @State private var uploading = false
    @State private var videoProgress: Double?
    private let picked = OptimisticPick()

    static let categories = ["nature", "city", "interior", "studio", "mine", "videos"]

    var body: some View {
        let stack = model.layers("scenery")
        let found = stack.enumerated().first { ($0.element.kind == "photo" || $0.element.kind == "video") && $0.element.visible }
            ?? stack.enumerated().first { $0.element.kind == "photo" || $0.element.kind == "video" }
        let category = model.sceneryCategory
        let items = model.catalog.scenery
        let ordered = items.filter { $0.category == category } + items.filter { $0.category != category }
        TabPage {
            TabHeader(title: "scenery")
            Hero(aspect: 16 / 9) { BackdropArt(focus: .photo) } leading: {
                OnAirLabel(detail: found.map { label($0.element) })
            } trailing: {
                if let l = found?.element, l.kind == "video", VideoRef(l.ref)?.youtubeId != nil {
                    GlassPill { Icon(.film, size: 13); Text("youtube") }
                } else {
                    GlassPill { Text("\(Fmt.aperture(found?.element.param("blur") ?? 0.74)) blur") }
                }
            }
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(Self.categories, id: \.self) { c in
                            PillButton(c, icon: c == "videos" ? .film : nil, on: c == category) { model.sceneryCategory = c }
                                .id(c)
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
                .onAppear { if category == "videos" { proxy.scrollTo("videos", anchor: .trailing) } }
            }
            if category == "videos" {
                videosSection(layer: found?.element)
            } else {
                if category == "mine" {
                    EmptyCard(title: "your photos", detail: "photos you send from this phone show up on the wall right away. use \"use my photo\" below.")
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                    ForEach(category == "mine" ? [] : ordered) { s in
                        ImageCard(s.name, on: picked.show(found?.element.ref) == s.id, action: { choose(s.id, name: s.name, layer: found?.element) }) {
                            SceneryImage(ref: s.id).blur(radius: 1.5).scaleEffect(1.018)
                        }
                    }
                }
            }
            if let found { controls(index: found.offset, layer: found.element) }
            if category != "videos" {
                PhotosPicker(selection: $pick, matching: .images) {
                    ActionRow(icon: .camera, title: uploading ? "sending your photo" : "use my photo", detail: "blurred and color-matched on the projector", busy: uploading)
                }
                .buttonStyle(.plain)
                .disabled(uploading)
                Text("photos · unsplash").font(.pm(12)).foregroundStyle(Palette.dim).frame(maxWidth: .infinity)
            }
        }
        .onChange(of: found?.element.ref) { picked.settle() }
        .onChange(of: pick) { _, item in
            guard let item else { return }
            Task { await upload(item, layer: found?.element) }
        }
        .onChange(of: moviePick) { _, item in
            guard let item else { return }
            Task { await uploadMovie(item) }
        }
    }

    func label(_ l: Layer) -> String {
        if l.kind == "video" { return model.videos.first { $0.ref == l.ref }?.name ?? l.name }
        return model.catalog.scenery(l.ref)?.name ?? l.name
    }

    // MARK: Photos

    /// Picking a photo replaces the scenery stack with that one photo and keeps blur, brightness, warmth and drift.
    func choose(_ ref: String, name: String, layer: Layer?) {
        if let layer, layer.ref == ref, model.layers("scenery").count == 1 { return }
        picked.tap(ref)
        let pickedLayer = StackPick.photo(ref: ref, name: name, defaults: Catalog.defaults(model.catalog.photoParams), keeping: layer, id: NewID.make("lay"))
        model.pickFast(path: ScenePath.layers("scenery"), value: (try? JSONValue(encoding: pickedLayer)).map { [$0] } ?? [], fallback: .replaceStack(mode: "scenery", layers: [pickedLayer]))
    }

    // MARK: Videos

    func videosSection(layer: Layer?) -> some View {
        let videos = model.videos
        return VStack(spacing: 16) {
            if videos.isEmpty {
                EmptyCard(title: "no videos yet", detail: "add a youtube loop or a video from this phone. videos play on the wall like a photo, blurred and color-matched.")
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
                    ForEach(videos) { v in
                        ImageCard(v.name, meta: meta(v), on: layer?.ref == v.ref, aspect: 16 / 10, badge: v.isEmbed ? "youtube" : nil,
                                  action: { Self.pickVideo(model, ref: v.ref, name: v.name, trim: nil, embed: v.isEmbed) }) {
                            VideoThumb(video: v)
                                .overlay(alignment: .bottomLeading) {
                                    Icon(.play, size: 11).foregroundStyle(.white).frame(width: 26, height: 26)
                                        .background(Circle().fill(.ultraThinMaterial).overlay(Circle().fill(Color.black.opacity(0.45))))
                                        .padding(8)
                                }
                        }
                        .contextMenu {
                            Button("delete video", systemImage: "trash", role: .destructive) { delete(v) }
                        }
                    }
                }
            }
            Button { model.youtubeLink = ""; model.showYouTube = true } label: {
                ActionRow(icon: .link, title: "add from youtube", detail: "paste a link · trim it · pick a quality")
            }
            .buttonStyle(.plain)
            PhotosPicker(selection: $moviePick, matching: .videos) {
                ActionRow(icon: .film, title: videoProgress.map { "sending your video \(Int(($0 * 100).rounded()))%" } ?? "add video file",
                          detail: "a video from this phone loops on the wall", busy: videoProgress != nil, progress: videoProgress)
            }
            .buttonStyle(.plain)
            .disabled(videoProgress != nil)
        }
    }

    func meta(_ v: Video) -> String {
        var parts: [String] = []
        if v.duration > 0 { parts.append(Fmt.clock(v.duration)) }
        if v.isEmbed { parts.append("embed") } else if v.height > 0 { parts.append(v.height >= 2160 ? "4k" : "\(v.height)p") }
        if !v.isEmbed { parts.append(v.source == "youtube" ? "youtube" : "file") }
        return parts.joined(separator: " · ")
    }

    /// Picking a video replaces the scenery stack with one video layer and keeps blur, brightness, warmth and drift.
    /// An embedded YouTube import's trim becomes the layer's loop (`start` / `end`).
    static func pickVideo(_ model: AppModel, ref: String, name: String, trim: (Double, Double)?, embed: Bool) {
        let stack = model.layers("scenery")
        let old = stack.first { $0.kind == "video" || $0.kind == "photo" }
        if let old, old.ref == ref, stack.count == 1 { return }
        var defaults = model.catalog.videoDefaults
        if embed, let trim {
            defaults["start"] = .number(trim.0)
            defaults["end"] = .number(trim.1)
        }
        model.edit(.replaceStack(mode: "scenery", layers: [StackPick.video(ref: ref, name: name, defaults: defaults, keeping: old, id: NewID.make("lay"))]))
    }

    func delete(_ v: Video) {
        guard let api = model.api else { return }
        Task {
            do {
                try await api.deleteVideo(v.id)
                try? model.db.saveVideos(model.videos.filter { $0.id != v.id })
            } catch { model.flash(error.localizedDescription) }
        }
    }

    // MARK: Controls

    func controls(index i: Int, layer: Layer) -> some View {
        let live = model.hub.isLive
        let isVideo = layer.kind == "video"
        let specs = isVideo ? model.catalog.videoParams : model.catalog.photoParams
        let fallback = isVideo ? model.catalog.photoParams : ParamList()
        let rows: [(String, LineIcon)] = [("blur", .softness), ("brightness", .sun), ("warmth", .sun), ("drift", .wind)]
        let embed = VideoRef(layer.ref)?.youtubeId != nil
        return Card {
            ForEach(rows, id: \.0) { key, icon in
                let spec = specs[key] ?? fallback[key] ?? ParamSpec(type: "number", min: 0, max: 1)
                let v = layer.param(key) ?? spec.default?.double ?? 0
                FillSlider(spec.label ?? key, icon: icon, value: spec.fraction(v), enabled: live && !(embed && key == "drift"),
                           format: { Fmt.param(key, spec, spec.value(at: $0)) }) { f in
                    model.param(ScenePath.param("scenery", i, key), .number((spec.value(at: f) * 100).rounded() / 100))
                }
            }
            if isVideo { videoControls(index: i, layer: layer, embed: embed, live: live) }
        }
    }

    @ViewBuilder
    func videoControls(index i: Int, layer: Layer, embed: Bool, live: Bool) -> some View {
        let duration = model.videos.first { $0.ref == layer.ref }?.duration ?? 0
        let span = max(duration > 0 ? duration : 60, 1)
        let start = layer.param("start") ?? 0
        FillSlider("loop from", icon: .loop, value: min(1, start / span), enabled: live,
                   format: { Fmt.clock($0 * span) }) { f in
            model.param(ScenePath.param("scenery", i, "start"), .number((f * span).rounded()))
        }
        if embed {
            Text("an embedded youtube player: blur and brightness apply over it, drift does not. it needs the internet.")
                .font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(4).padding(.horizontal, 2)
        }
        // (§16) the video's own sound plays on the audio output (the projector by default), at volume × master
        let sound = layer.params["audio"]?.bool ?? false
        Toggle(model.catalog.videoParams["audio"]?.label ?? "sound", isOn: Binding(get: { sound },
                                                  set: { model.edit(.setLayerField(layerId: layer.id, field: ["params", "audio"], value: .bool($0))) }))
            .toggleStyle(PMSwitchStyle())
            .disabled(!live)
            .accessibilityHint("plays the video's sound on the audio output")
        if sound {
            let spec = model.catalog.videoParams["volume"] ?? ParamSpec(type: "number", min: 0, max: 1, label: "volume")
            let v = layer.param("volume") ?? spec.default?.double ?? 1
            FillSlider(spec.label ?? "volume", icon: .speaker, value: spec.fraction(v), enabled: live, format: { Fmt.percent(spec.value(at: $0)) }) { f in
                model.param(ScenePath.param("scenery", i, "volume"), .number((spec.value(at: f) * 100).rounded() / 100))
            }
        }
    }

    // MARK: Uploads

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

    /// Sends a video from Photos to `POST /videos` with progress; it lands in the videos category.
    func uploadMovie(_ item: PhotosPickerItem) async {
        defer { moviePick = nil; videoProgress = nil }
        guard model.hub.isLive else { model.flash("Connect to the projector to send a video."); return }
        videoProgress = 0
        let data: Data
        let ext: String
        if model.demo {
            data = Data(); ext = "mov"
        } else {
            guard let movie = try? await item.loadTransferable(type: PickedMovie.self), let d = try? Data(contentsOf: movie.url) else {
                model.flash("That video could not be read.")
                return
            }
            data = d; ext = movie.url.pathExtension.lowercased()
            try? FileManager.default.removeItem(at: movie.url)
        }
        guard data.count <= 512 * 1024 * 1024 else { model.flash("That video is larger than 512 MB."); return }
        let mime = ext == "mov" ? "video/quicktime" : ext == "webm" ? "video/webm" : "video/mp4"
        do {
            _ = try await model.hub.uploadVideo(data, filename: "video.\(ext.isEmpty ? "mp4" : ext)", mime: mime, name: "my video") { p in
                Task { @MainActor in videoProgress = p }
            }
        } catch {
            model.flash(error.localizedDescription)
        }
    }
}

/// A movie from Photos, copied to a temporary file.
struct PickedMovie: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: dest)
            return PickedMovie(url: dest)
        }
    }
}

/// A tappable row card (the "use my photo" look): icon tile, title, detail, chevron; a progress line while busy.
struct ActionRow: View {
    var icon: LineIcon
    var title: String
    var detail: String
    var busy = false
    var progress: Double?

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 14) {
                Group {
                    if busy { ProgressView().tint(Palette.ink) } else { Icon(icon, size: 22) }
                }
                .frame(width: 44, height: 44)
                .background(Palette.track, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.pm(15)).tracking(0.2)
                    Text(detail).font(.pm(12)).foregroundStyle(Palette.dim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Icon(.chevronRight, size: 18).foregroundStyle(Palette.dim)
            }
            if let progress { ProgressLine(progress) }
        }
        .foregroundStyle(Palette.ink)
        .padding(16)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// A video tile's picture: its thumb asset, YouTube's hqdefault image for embeds, or a film glyph.
struct VideoThumb: View {
    var video: Video?
    var ref: String?
    @Environment(AppModel.self) private var model

    var body: some View {
        if let thumb = video?.thumb, let img = SceneryImage.bundled(thumb) {
            Image(uiImage: img).resizable().scaledToFill()
        } else if let url {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { placeholder }
            }
        } else {
            placeholder
        }
    }

    var placeholder: some View {
        Palette.track.overlay(Icon(.film, size: 26).foregroundStyle(Palette.dim))
    }

    var url: URL? {
        if let thumb = video?.thumb, !thumb.isEmpty, let api = model.api { return api.assetURL(sha: thumb) }
        if let id = video?.youtubeId ?? VideoRef(video?.ref ?? ref ?? "")?.youtubeId { return YouTube.thumbnailURL(id) }
        return nil
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
