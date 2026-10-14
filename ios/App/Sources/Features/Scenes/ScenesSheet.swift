import SwiftUI
import PMKit
import PMDesign

/// The scene picker (protocol §14), reachable from every tab header: every scene, the one on the wall marked with the
/// on-air dot; a tap puts a scene on the wall (`show.activate`). New, duplicate, rename and delete.
struct ScenesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    enum Naming: Identifiable {
        case new, duplicate(SceneSummary), rename(SceneSummary)
        var id: String {
            switch self {
            case .new: "new"
            case .duplicate(let s): "dup-\(s.id)"
            case .rename(let s): "ren-\(s.id)"
            }
        }
    }

    @State private var naming: Naming?
    @State private var name = ""
    @State private var deleting: SceneSummary?

    var body: some View {
        let scenes = model.scenes
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("scenes").titleStyle(26)
                Spacer()
                IconPill(.close, size: 16, label: "close") { dismiss() }
            }
            .padding(.top, 4)
            Text("each scene keeps its own looks, objects, timeline and soundboard. tap one to put it on the wall.")
                .font(.pm(13)).foregroundStyle(Palette.dim).lineSpacing(3).padding(.horizontal, 4)
            ScrollView {
                VStack(spacing: 14) {
                    if scenes.isEmpty {
                        EmptyCard(title: "no scenes yet", detail: "make one below, or open the editor on the laptop.")
                    } else {
                        ListCard {
                            ForEach(Array(scenes.enumerated()), id: \.element.id) { n, s in
                                row(s, separator: n > 0 && scenes[n - 1].id != model.sceneId)
                            }
                        }
                    }
                    HStack(spacing: 10) {
                        WideButton("new scene", icon: .plus) { start(.new) }
                        WideButton("duplicate", icon: .scenes) {
                            if let current = scenes.first(where: { $0.id == model.sceneId }) { start(.duplicate(current)) }
                        }
                        .disabled(model.sceneId == nil)
                    }
                    Text("new scenes start empty on this projector. hold a scene to rename, duplicate or delete it.")
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
        .presentationDetents([.medium, .large])
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

    func row(_ s: SceneSummary, separator: Bool) -> some View {
        let active = s.id == model.sceneId
        return Button { pick(s) } label: {
            ListRow(s.name, meta: active ? "on the wall · \(model.mode)" : "tap to put it on the wall", on: active, separator: separator) {
                Icon(active ? icon(model.mode) : .scenes, size: 20)
                    .frame(width: 44, height: 44)
                    .foregroundStyle(Palette.ink)
                    .background(active ? Color.black : Palette.track)
            } trailing: {
                if active {
                    OnAirDot().padding(.trailing, 4)
                    Text("on air").font(.pm(12)).tracking(1.2).textCase(.uppercase).foregroundStyle(Palette.metaOnLight).padding(.trailing, 4)
                }
                Menu {
                    Button("rename", systemImage: "pencil") { start(.rename(s)) }
                    Button("duplicate", systemImage: "plus.square.on.square") { start(.duplicate(s)) }
                    if !active {
                        Button("delete", systemImage: "trash", role: .destructive) { deleting = s }
                    }
                } label: {
                    Icon(.more, size: 20).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("more for \(s.name)")
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("rename", systemImage: "pencil") { start(.rename(s)) }
            Button("duplicate", systemImage: "plus.square.on.square") { start(.duplicate(s)) }
            if !active { Button("delete", systemImage: "trash", role: .destructive) { deleting = s } }
        }
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    func icon(_ mode: String) -> LineIcon {
        switch mode {
        case "live": .tabLive
        case "color": .tabColor
        case "scenery": .tabScenery
        case "objects": .cube
        default: .tabStatic
        }
    }

    var title: String {
        switch naming {
        case .rename: "rename scene"
        case .duplicate: "duplicate scene"
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
        default: "an empty scene on this projector."
        }
    }

    func start(_ n: Naming) {
        switch n {
        case .new: name = "scene \(model.scenes.count + 1)"
        case .duplicate(let s): name = "\(s.name) copy"
        case .rename(let s): name = s.name
        }
        naming = n
    }

    func pick(_ s: SceneSummary) {
        guard s.id != model.sceneId else { return }
        guard model.hub.isLive else { model.flash("Not connected to the projector."); return }
        model.activate(s.id)
    }

    func commit() {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let what = naming, !n.isEmpty else { naming = nil; return }
        naming = nil
        Task {
            do {
                switch what {
                case .new: try await model.hub.createScene(name: n)
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
