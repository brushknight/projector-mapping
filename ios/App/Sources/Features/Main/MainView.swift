import SwiftUI
import PMDesign
import PMPreview

/// The five tabs with the island tab bar, plus the projector settings, add layer and auto map presentations.
struct MainView: View {
    @Environment(AppModel.self) private var model

    static let items: [IslandTabBar<AppTab>.Item] = [
        .init(.static, "static", .tabStatic),
        .init(.live, "live", .tabLive),
        .init(.color, "color", .tabColor),
        .init(.scenery, "scenery", .tabScenery),
        .init(.objects, "objects", .cube),
    ]

    var body: some View {
        @Bindable var model = model
        ZStack(alignment: .bottom) {
            Group {
                switch model.tab {
                case .static: StaticTab()
                case .live: LiveTab()
                case .color: ColorTab()
                case .scenery: SceneryTab()
                case .objects: ObjectsTab()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            IslandTabBar(Self.items, selection: model.tab, onAir: model.scene.flatMap { AppTab(rawValue: $0.mode) }) { model.select($0) }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
                .ignoresSafeArea(edges: .bottom)
        }
        .background(Palette.ground)
        .fullScreenCover(isPresented: $model.showSetup) { ProjectorSetupView() }
        .fullScreenCover(isPresented: $model.showAutoMap) { AutoMapFlow() }
        .sheet(isPresented: $model.showAddLayer) { AddLayerSheet() }
        .sheet(isPresented: $model.showScenes) { ScenesSheet() }
        .sheet(isPresented: $model.showSounds) { SoundsSheet() }
        .sheet(isPresented: $model.showYouTube) { YouTubeSheet() }
        // The hub is back (Wi-Fi joined, server restarted, Local Network allowed): a hero that failed loads again now.
        .onChange(of: model.hub.status) { _, status in
            if status == .online { PreviewHost.shared.retryNow() }
        }
    }
}
