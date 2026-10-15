import SwiftUI
import PMKit
import PMDesign
import PMPreview

/// The scene picker (protocol §14, §15), reachable from every tab header: scenes grouped by kind (static, live,
/// color, scenery, mapping) with filter chips and thumbnails. A tap puts a scene on the wall and opens its tab; holding
/// one previews it animated without putting it on air. New static, live and mapping scenes; rename, duplicate, delete.
struct ScenesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    enum Naming: Identifiable {
        case new(String), duplicate(SceneSummary), rename(SceneSummary)
        var id: String {
            switch self {
            case .new(let k): "new-\(k)"
            case .duplicate(let s): "dup-\(s.id)"
            case .rename(let s): "ren-\(s.id)"
            }
        }
    }

    @State private var naming: Naming?
    @State private var name = ""
    @State private var deleting: SceneSummary?
    @State private var filter = "all"
    /// Documents of scenes the store has no copy of (only the active scene is followed), for thumbnails only.
    @State private var docs: [String: PMKit.Scene] = [:]

    var kinds: [SceneKindItem] { model.catalog.sceneKinds }

    var body: some View {
        let scenes = model.scenes
        let present = Set(scenes.map(\.kind))
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("scenes").titleStyle(26)
                Spacer()
                IconPill(.close, size: 16, label: "close") { dismiss() }
            }
            .padding(.top, 4)
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    PillButton("all \(scenes.count)", on: filter == "all") { filter = "all" }
                    ForEach(kinds.filter { present.contains($0.id) }) { k in
                        PillButton("\(k.name) \(scenes.filter { $0.kind == k.id }.count)", on: filter == k.id) { filter = k.id }
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -16)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if scenes.isEmpty {
                        EmptyCard(title: "no scenes yet", detail: "make one below, or open the editor on the laptop.")
                    }
                    ForEach(kinds.filter { k in (filter == "all" || filter == k.id) && present.contains(k.id) }) { k in
                        section(k, scenes.filter { $0.kind == k.id })
                    }
                    newButtons
                    Text("tap a scene to put it on the wall. hold one to preview it without going on air.")
                        .font(.pm(12)).foregroundStyle(Palette.dim).lineSpacing(3).frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center).padding(.horizontal, 12)
                }
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .presentationBackground(Palette.sheet)
        .presentationCornerRadius(38)
        .presentationDragIndicator(.visible)
        .presentationDetents([.large])
        .task(id: scenes.map(\.id)) { await loadDocs(scenes) }
        .sheet(item: Binding(get: { model.previewScene }, set: { model.previewScene = $0 })) { s in
            ScenePreviewSheet(summary: s, scene: doc(s)) { dismiss() }
        }
        .alert(title, isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })) {
            TextField("name", text: $name)
            Button(actionTitle) { commit() }
            Button("cancel", role: .cancel) { naming = nil }
        } message: {
            Text(message)
        }
        .confirmationDialog("delete \(deleting?.name ?? "")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("delete scene", role: .destructive) {
                if let s = deleting { remove(s) }
                deleting = nil
            }
        } message: {
            Text("its looks, objects, timeline and pads go with it.")
        }
    }

    func section(_ k: SceneKindItem, _ list: [SceneSummary]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            CapRow(k.name, "\(list.count)")
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 14) {
                ForEach(list) { s in card(s) }
            }
        }
    }

    func card(_ s: SceneSummary) -> some View {
        let active = s.id == model.sceneId
        return VStack(alignment: .leading, spacing: 7) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay { SceneThumb(summary: s, scene: doc(s)) }
                .overlay(alignment: .topLeading) {
                    if active {
                        GlassPill { OnAirDot(); Text("on air") }.padding(7)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .selectionRing(active, radius: 16)
            HStack(spacing: 4) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.name).font(.pm(14)).tracking(0.2).lineLimit(1).foregroundStyle(Palette.ink)
                    Text(meta(s, active: active)).font(.pm(11)).lineLimit(1).foregroundStyle(Palette.dim)
                }
                Spacer(minLength: 0)
                Menu {
                    Button("preview", systemImage: "eye") { model.previewScene = s }
                    Button("rename", systemImage: "pencil") { start(.rename(s)) }
                    Button("duplicate", systemImage: "plus.square.on.square") { start(.duplicate(s)) }
                    if !active { Button("delete", systemImage: "trash", role: .destructive) { deleting = s } }
                } label: {
                    Icon(.more, size: 18).frame(width: 32, height: 32).contentShape(Rectangle()).foregroundStyle(Palette.dim)
                }
                .accessibilityLabel("more for \(s.name)")
            }
            .padding(.horizontal, 2)
        }
        .contentShape(Rectangle())
        .onTapGesture { pick(s) }
        .onLongPressGesture(minimumDuration: 0.4) {
            model.previewScene = s
        }
        .sensoryFeedback(.impact(weight: .light), trigger: model.previewScene?.id == s.id) { _, on in on && model.haptics }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction(named: "preview") { model.previewScene = s }
    }

    func meta(_ s: SceneSummary, active: Bool) -> String {
        if active { return "on the wall · \(model.mode)" }
        if let d = doc(s) {
            switch s.kind {
            case "static", "live":
                let n = d.attachments(s.kind).count
                guard let first = d.attachments(s.kind).first else { return "light only" }
                return (model.catalog.gobo(first.gobo)?.name ?? first.name) + (n > 1 ? " +\(n - 1)" : "")
            case "mapping": return "\(d.objects.count) object\(d.objects.count == 1 ? "" : "s")"
            default: return d.layers(s.kind).first?.name ?? s.kind
            }
        }
        return s.kind
    }

    var newButtons: some View {
        VStack(alignment: .leading, spacing: 10) {
            CapRow("new scene", "")
            HStack(spacing: 10) {
                WideButton("static", icon: .plus, height: 48, font: .pm(14)) { start(.new("static")) }
                WideButton("live", icon: .plus, height: 48, font: .pm(14)) { start(.new("live")) }
                WideButton("mapping", icon: .plus, height: 48, font: .pm(14)) { start(.new("mapping")) }
            }
        }
    }

    // MARK: Documents for thumbnails

    func doc(_ s: SceneSummary) -> PMKit.Scene? {
        if s.id == model.sceneId { return model.scene }
        return docs[s.id]
    }

    func loadDocs(_ scenes: [SceneSummary]) async {
        for s in scenes where docs[s.id] == nil && s.id != model.sceneId {
            if let local = (try? model.db.sceneDoc(s.id)) ?? nil, let scene = try? local.decode(PMKit.Scene.self) {
                docs[s.id] = scene
            } else if !model.demo, let api = model.api, let remote = try? await api.scene(s.id), let scene = try? remote.decode(PMKit.Scene.self) {
                docs[s.id] = scene
            }
        }
    }

    // MARK: Naming

    var title: String {
        switch naming {
        case .rename: "rename scene"
        case .duplicate: "duplicate scene"
        case .new(let k): "new \(k) scene"
        default: "new scene"
        }
    }

    var actionTitle: String {
        switch naming {
        case .rename: "rename"
        case .duplicate: "duplicate"
        default: "make scene"
        }
    }

    var message: String {
        switch naming {
        case .rename: "the new name shows everywhere at once."
        case .duplicate(let s): "copies \(s.name) with its looks, objects, timeline and pads."
        case .new(let k): model.catalog.sceneTemplates.first { $0.kind == k }?.description ?? "a new \(k) scene on this projector."
        default: ""
        }
    }

    func start(_ n: Naming) {
        switch n {
        case .new(let k): name = "\(k) \(model.scenes.filter { $0.kind == k }.count + 1)"
        case .duplicate(let s): name = "\(s.name) copy"
        case .rename(let s): name = s.name
        }
        naming = n
    }

    func pick(_ s: SceneSummary) {
        guard model.hub.isLive else { model.flash("Not connected to the projector."); return }
        model.activate(s.id)
        dismiss()
    }

    func commit() {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let what = naming, !n.isEmpty else { naming = nil; return }
        naming = nil
        Task {
            do {
                switch what {
                case .new(let k):
                    if await model.createScene(name: n, kind: k) != nil { filter = "all"; model.flash("\(n) is ready. tap it to put it on the wall.") }
                case .duplicate(let s): try await model.hub.createScene(name: n, duplicate: s.id)
                case .rename(let s): try await model.hub.renameScene(s.id, name: n)
                }
            } catch { model.flash(error.localizedDescription) }
        }
    }

    func remove(_ s: SceneSummary) {
        Task {
            do { try await model.hub.deleteScene(s.id) } catch { model.flash(error.localizedDescription) }
        }
    }
}

/// A scene's picture by kind: the first attachment's render for static and live, the gradient for color, the photo
/// for scenery, an objects glyph for mapping.
struct SceneThumb: View {
    var summary: SceneSummary
    var scene: PMKit.Scene?
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Palette.hero
            switch summary.kind {
            case "static", "live":
                if let a = scene?.attachments(summary.kind).first(where: \.visible) {
                    GoboThumb(gobo: a.gobo)
                } else if let tree = scene?.layers("live").first(where: { $0.kind == "procedural" }), summary.kind == "live" {
                    CatalogThumb(tree.ref) { GoboArt(tree.ref) }
                } else {
                    glyph(summary.kind == "live" ? .tabLive : .tabStatic)
                }
            case "color":
                if let g = scene?.layers("color").first(where: { $0.kind == "gradient" && $0.visible }) {
                    let stops = ((try? g.params["stops"]?.decode([GradientStop].self)) ?? model.catalog.gradient(g.ref)?.stops ?? [])
                        .map { Gradient.Stop(color: Color(css: $0.color) ?? .black, location: $0.pos) }
                    AngledGradient(stops: stops, angle: g.param("angle") ?? 135)
                } else if scene?.layers("color").contains(where: { $0.kind == "generator" }) == true {
                    AngledGradient(stops: [.init(color: Color(hex: 0xFF4D00), location: 0), .init(color: Color(hex: 0xFF2E63), location: 0.5),
                                           .init(color: Color(hex: 0x6A00F4), location: 1)], angle: 135)
                } else {
                    glyph(.tabColor)
                }
            case "scenery":
                if let p = scene?.layers("scenery").first(where: { $0.visible && ($0.kind == "photo" || $0.kind == "video") }) {
                    if p.kind == "video" {
                        VideoThumb(video: model.videos.first { $0.ref == p.ref }, ref: p.ref)
                    } else {
                        SceneryImage(ref: p.ref)
                    }
                } else {
                    glyph(.tabScenery)
                }
            default:
                ZStack {
                    glyph(.cube)
                    if let n = scene?.objects.count, n > 0 {
                        Text("\(n)").font(.pmMono(13)).foregroundStyle(Palette.dim)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing).padding(10)
                    }
                }
            }
        }
        .clipped()
    }

    func glyph(_ icon: LineIcon) -> some View {
        Icon(icon, size: 30).foregroundStyle(Palette.dim).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The long-press preview: the scene animated in a second web view on `/preview?scene=<id>` (it follows that scene in
/// its own mode at the wall's clock without putting it on air), with "put it on the wall".
struct ScenePreviewSheet: View {
    var summary: SceneSummary
    var scene: PMKit.Scene?
    var onActivate: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var host = PreviewHost()

    var body: some View {
        let active = summary.id == model.sceneId
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.name).titleStyle(24).lineLimit(1)
                    Text(active ? "on the wall now" : "preview · not on air").font(.pm(12)).foregroundStyle(Palette.dim)
                }
                Spacer()
                IconPill(.close, size: 16, label: "close") { dismiss() }
            }
            Palette.hero
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay {
                    if model.demo || model.api == nil {
                        SceneThumb(summary: summary, scene: scene)
                    } else {
                        PreviewWebView(url: model.api?.previewURL(width: 1110, scene: summary.id), host: host) {
                            SceneThumb(summary: summary, scene: scene)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(alignment: .topLeading) {
                    GlassPill { Text("\(summary.kind) · \(host.state == .loaded || model.demo ? "live preview" : "loading")") }.padding(10)
                }
            WideButton(active ? "already on the wall" : "put it on the wall", icon: .play, on: !active) {
                guard !active else { dismiss(); return }
                guard model.hub.isLive else { model.flash("Not connected to the projector."); return }
                model.activate(summary.id)
                dismiss()
                onActivate()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 22)
        .presentationBackground(Palette.sheet)
        .presentationCornerRadius(38)
        .presentationDragIndicator(.visible)
        .presentationDetents([.height(380)])
        .onDisappear { host.stop() }
    }
}
