import SwiftUI
import PMDesign
import PMKit

@main
struct ProjmapApp: App {
    @State private var model: AppModel

    init() {
        PMFont.register()
        _model = State(initialValue: AppModel())
    }

    var body: some SwiftUI.Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(\.hapticsEnabled, model.haptics)
                .preferredColorScheme(.dark)
                .tint(Palette.ink)
                .onAppear { model.start() }
                .onOpenURL { url in
                    // projmap://youtube?url=<link>: open "add from YouTube" with the link filled in.
                    if url.scheme == "projmap", url.host == "youtube" {
                        let link = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "url" }?.value ?? ""
                        model.youtubeLink = link
                        model.tab = .scenery
                        model.showYouTube = true
                        return
                    }
                    if let link = ConnectLink(url.absoluteString) {
                        if model.isPaired { model.unpair() }
                        model.pendingLink = link
                    }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Palette.ground.ignoresSafeArea()
            if model.isPaired && model.debugScreen != .connect {
                MainView()
            } else {
                ConnectView()
            }
        }
        .overlay(alignment: .top) {
            if let toast = model.toast {
                Text(toast)
                    .font(.pm(13))
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Capsule().fill(.ultraThinMaterial).overlay(Capsule().fill(Palette.pill.opacity(0.8))))
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: model.toast)
    }
}
