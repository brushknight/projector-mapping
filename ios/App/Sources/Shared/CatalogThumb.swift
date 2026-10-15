import SwiftUI
import UIKit
import PMKit
import PMDesign

/// Catalog thumbnails (`GET /catalog/thumbs/<id>.png`, protocol §15): 384 × 216 PNGs rendered by the web engine.
/// Kept in memory and on disk (Caches/thumbs, keyed by server and id; the server marks them immutable), loaded once
/// per id even when many tiles ask at the same time.
@MainActor
final class ThumbCache {
    static let shared = ThumbCache()

    private let memory = NSCache<NSString, UIImage>()
    private var inflight: [String: Task<UIImage?, Never>] = [:]
    /// Ids the server answered 404 for (an older server without thumbnails): drawn natively until relaunch.
    private var missing = Set<String>()

    private var directory: URL {
        let dir = URL.cachesDirectory.appendingPathComponent("thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func key(_ url: URL) -> String {
        let host = "\(url.host() ?? "")_\(url.port ?? 0)"
        return host + "_" + url.lastPathComponent
    }

    func cached(_ url: URL) -> UIImage? { memory.object(forKey: key(url) as NSString) }

    func image(_ url: URL) async -> UIImage? {
        let k = key(url)
        if let img = memory.object(forKey: k as NSString) { return img }
        if missing.contains(k) { return nil }
        if let running = inflight[k] { return await running.value }
        let file = directory.appendingPathComponent(k)
        let task = Task<UIImage?, Never> {
            if let data = try? Data(contentsOf: file), let img = UIImage(data: data) { return img }
            var req = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 10)
            req.setValue("image/png", forHTTPHeaderField: "Accept")
            guard let (data, resp) = try? await URLSession.shared.data(for: req), let http = resp as? HTTPURLResponse else { return nil }
            if http.statusCode == 404 { self.missing.insert(k); return nil }
            guard http.statusCode == 200, let img = UIImage(data: data) else { return nil }
            try? data.write(to: file, options: .atomic)
            return img
        }
        inflight[k] = task
        let img = await task.value
        inflight[k] = nil
        if let img { memory.setObject(img, forKey: k as NSString) }
        return img
    }
}

/// A catalog thumbnail filling its frame: the server's PNG, else (offline, demo, or before the PNG arrives) the
/// native drawing in `fallback`.
struct CatalogThumb<Fallback: View>: View {
    var id: String
    var fallback: Fallback
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?

    init(_ id: String, @ViewBuilder fallback: () -> Fallback) {
        self.id = id
        self.fallback = fallback()
    }

    var url: URL? {
        guard !model.demo, let api = model.api else { return nil }
        return api.catalogThumbURL(model.catalog.thumbId(id))
    }

    var body: some View {
        ZStack {
            if let img = image ?? url.flatMap({ ThumbCache.shared.cached($0) }) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                fallback
            }
        }
        .task(id: url) {
            guard let url else { image = nil; return }
            image = await ThumbCache.shared.image(url)
        }
    }
}

/// The native art of a gobo id: the eight drawn shapes, and the closest one for the newer catalog ids.
enum GoboFallback {
    static func art(_ id: String, category: String) -> String {
        let drawn: Set<String> = ["window", "blinds", "arch", "lattice", "dots", "spot", "palm", "tree"]
        if drawn.contains(id) { return id }
        switch id {
        case "gothic", "porthole": return "arch"
        case "moroccan", "honeycomb", "grid": return "lattice"
        case "stars", "water", "leaves-light": return "dots"
        case "bamboo", "branch", "ivy", "leaves-dense": return "tree"
        case "palm": return "palm"
        default: break
        }
        switch category {
        case "plates": return "spot"
        case "windows": return "window"
        case "blinds": return "blinds"
        case "nature": return "tree"
        case "spots": return "spot"
        default: return "lattice"
        }
    }
}

/// A gobo's thumbnail: the server's render, or the native art. `metal` shows a plate as the metal disc itself.
struct GoboThumb: View {
    var gobo: String
    var metal = false
    @Environment(AppModel.self) private var model

    var body: some View {
        CatalogThumb(metal ? model.catalog.metalThumbId(gobo) ?? gobo : gobo) {
            GoboArt(GoboFallback.art(gobo, category: model.catalog.gobo(gobo)?.browseCategory ?? ""))
        }
    }
}
