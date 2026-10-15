import SwiftUI
import UIKit
import PMKit
import PMDesign

/// A live layer's animated preview (protocol §16, live gallery): the server's strip (`animThumb`, `animFrames` frames
/// of 192 × 108 top to bottom, looping at `animFps`) played frame by frame. Before the strip arrives, offline, or for
/// a catalog without strips, it shows the static thumbnail. It only ticks while on screen and while the app is active.
struct AnimatedThumb: View {
    var id: String
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase
    @State private var frames: [UIImage] = []
    @State private var visible = false

    var strip: (url: URL, frames: Int, fps: Double)? {
        guard !model.demo, let api = model.api, let s = model.catalog.animStrip(id) else { return nil }
        return (api.catalogAssetURL(s.path), s.frames, s.fps)
    }

    var body: some View {
        let strip = strip
        ZStack {
            if frames.count > 1, let strip {
                TimelineView(.animation(minimumInterval: 1 / max(1, strip.fps), paused: !visible || phase != .active)) { ctx in
                    let n = Int(ctx.date.timeIntervalSinceReferenceDate * strip.fps) % frames.count
                    Image(uiImage: frames[n]).resizable().scaledToFill()
                }
            } else {
                CatalogThumb(id) { GoboArt(GoboFallback.art(id, category: model.catalog.procedural(id)?.category ?? "")) }
            }
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: strip?.url) {
            guard let strip else { frames = []; return }
            frames = await StripFrames.shared.frames(strip.url, count: strip.frames)
        }
    }
}

/// Cuts strips into frames once per URL (the strip itself comes through `ThumbCache`, memory and disk).
@MainActor
final class StripFrames {
    static let shared = StripFrames()
    private var cache: [URL: [UIImage]] = [:]

    func frames(_ url: URL, count: Int) async -> [UIImage] {
        if let have = cache[url] { return have }
        guard let strip = await ThumbCache.shared.image(url), let cg = strip.cgImage, count > 0 else { return [] }
        let h = cg.height / count
        guard h > 0 else { return [] }
        let out: [UIImage] = (0..<count).compactMap { i in
            cg.cropping(to: CGRect(x: 0, y: i * h, width: cg.width, height: h)).map { UIImage(cgImage: $0) }
        }
        cache[url] = out
        return out
    }
}
