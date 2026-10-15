import SwiftUI
import PMDesign
#if canImport(UIKit)
import UIKit
import WebKit
#endif

/// The server's `/preview` page (the same WebGL engine as the wall) in a transparent, non-scrolling web view, clipped
/// by the caller.
///
/// One web view is shared by every hero (`PreviewHost.shared`) and moves between screens, so switching tabs never
/// reloads the page or flashes a placeholder. `placeholder` shows until the page reports its first real frame (the
/// `projmap` script message "ready"), and again whenever the page fails.
///
/// A failed load is retried (1 s, 2 s, 4 s … 15 s) and again when the app comes to the foreground or the hub
/// reconnects (`retryNow()`): on a phone the first load often fails (the Local Network prompt is still up, Wi-Fi is
/// not joined yet, the Mac sleeps or the server restarts), and before this the preview never loaded again.
public enum PreviewLoadState: Sendable { case loading, loaded, failed }

public struct PreviewWebView<Placeholder: View>: View {
    let url: URL?
    let placeholder: Placeholder
    #if canImport(UIKit)
    let host: PreviewHost
    #endif

    #if canImport(UIKit)
    public init(url: URL?, host: PreviewHost = .shared, @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        self.host = host
        self.placeholder = placeholder()
    }
    #else
    public init(url: URL?, @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        self.placeholder = placeholder()
    }
    #endif

    public var body: some View {
        #if canImport(UIKit)
        ZStack {
            placeholder.opacity(host.state == .loaded ? 0 : 1)
            if let url {
                SharedWebViewRepresentable(url: url, host: host)
                    .opacity(host.state == .loaded ? 1 : 0)
                    .allowsHitTesting(false)
            }
        }
        .animation(.easeOut(duration: 0.25), value: host.state)
        // Hand the URL over outside of view updates too, so a host that failed keeps trying while it is on screen.
        .task(id: url) { if let url { host.ensure(url) } }
        #else
        placeholder
        #endif
    }
}

#if canImport(UIKit)
/// Owns one preview web view and its load state. `shared` serves every hero for the app's lifetime; a sheet (the
/// scene picker's long-press preview) makes its own.
@MainActor
@Observable
public final class PreviewHost: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    public static let shared = PreviewHost()

    public private(set) var state: PreviewLoadState = .loading
    /// Failed loads in a row (reset by a ready page).
    public private(set) var failures = 0
    @ObservationIgnored private(set) var url: URL?
    @ObservationIgnored private var readyCheck: Task<Void, Never>?
    @ObservationIgnored private var retryTask: Task<Void, Never>?
    @ObservationIgnored private var foreground: NSObjectProtocol?
    @ObservationIgnored lazy var webView: WKWebView = makeWebView()

    /// Seconds between retries after a failure (the last one repeats).
    public static let retryDelays: [Double] = [1, 2, 4, 8, 15]
    /// How long a page may take from `didFinish` to its first frame before the host looks at it.
    public static let readyTimeout: Double = 6

    public override init() {
        super.init()
        foreground = NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.retryNow() }
        }
    }

    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // The page is the app's own view of the server: no cached copy of an older build or a failed answer.
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(WeakMessageHandler(self), name: "projmap")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 180), configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.navigationDelegate = self
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        #if DEBUG
        view.isInspectable = true  // Safari › Develop › the phone, to read the page's console
        #endif
        return view
    }

    /// Loads `url` unless this view already shows it or is loading it; a failed page loads again. (§16 masks) A page that
    /// is up and differs only in `try` (the live gallery's trial layer) switches in place: no reload, no new renderer.
    public func ensure(_ url: URL) {
        if self.url == url, state != .failed { return }
        if self.url == url, state == .failed, retryTask != nil { return }  // a retry is already scheduled
        if state == .loaded, let current = self.url, let trial = Self.trialChange(from: current, to: url) {
            self.url = url
            let arg = trial.map { "'\($0.replacingOccurrences(of: "\\", with: "").replacingOccurrences(of: "'", with: ""))'" } ?? "null"
            webView.evaluateJavaScript("window.projmapPreview && window.projmapPreview.set({ try: \(arg) })") { [weak self] result, error in
                // an older page without the hook: load the new URL after all
                if error != nil || (result as? Bool) == false { MainActor.assumeIsolated { self?.load(url) } }
            }
            return
        }
        load(url)
    }

    /// When `a` and `b` are the same preview but for the `try` query item, the new trial (nil = none); else nil.
    nonisolated static func trialChange(from a: URL, to b: URL) -> String?? {
        guard var ca = URLComponents(url: a, resolvingAgainstBaseURL: false), var cb = URLComponents(url: b, resolvingAgainstBaseURL: false) else { return nil }
        let trial = cb.queryItems?.first { $0.name == "try" }?.value
        ca.queryItems = ca.queryItems?.filter { $0.name != "try" }
        cb.queryItems = cb.queryItems?.filter { $0.name != "try" }
        if ca.queryItems?.isEmpty == true { ca.queryItems = nil }
        if cb.queryItems?.isEmpty == true { cb.queryItems = nil }
        return ca == cb ? .some(trial) : nil
    }

    /// Loads again now when the page is not up (the app came back, the hub reconnected).
    public func retryNow() {
        guard let url, state != .loaded else { return }
        load(url)
    }

    /// Stops the page (a sheet closing); the next `ensure` starts it again.
    public func stop() {
        retryTask?.cancel(); retryTask = nil
        readyCheck?.cancel(); readyCheck = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        url = nil
        state = .loading
    }

    private func load(_ url: URL) {
        retryTask?.cancel(); retryTask = nil
        readyCheck?.cancel(); readyCheck = nil
        self.url = url
        state = .loading
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 10))
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
            failed()
            return .cancel
        }
        return .allow
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard state == .loading else { return }
        // The page posts "ready" with its first real frame. If it has not after a while, look: a page that drew a
        // canvas (an older build without the message) shows; anything else (a plain page, no WebGL, no data because
        // the token was refused) counts as failed and is retried, so the hero keeps its stand-in instead of black.
        readyCheck?.cancel()
        readyCheck = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.readyTimeout))
            guard let self, !Task.isCancelled, self.state == .loading else { return }
            let drew = (try? await self.webView.evaluateJavaScript(Self.drewScript)) as? Bool ?? false
            guard !Task.isCancelled, self.state == .loading else { return }
            if drew { self.ready() } else { self.failed() }
        }
    }

    /// True when the page has a canvas with a drawing buffer (the renderer is up).
    static let drewScript = "(() => { const c = document.querySelector('canvas'); return !!c && c.width > 1 && c.height > 1 })()"

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failedUnlessCancelled(error) }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failedUnlessCancelled(error) }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let url else { return }
        load(url)
    }

    public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "ready" else { return }
        ready()
    }

    private func ready() {
        readyCheck?.cancel(); readyCheck = nil
        retryTask?.cancel(); retryTask = nil
        failures = 0
        state = .loaded
    }

    private func failedUnlessCancelled(_ error: Error) {
        // A newer load replaced this one (NSURLErrorCancelled): not a failure.
        if (error as NSError).code == NSURLErrorCancelled { return }
        failed()
    }

    private func failed() {
        readyCheck?.cancel(); readyCheck = nil
        state = .failed
        failures += 1
        guard let url else { return }
        let delay = Self.retryDelays[min(failures - 1, Self.retryDelays.count - 1)]
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, !Task.isCancelled, self.url == url, self.state == .failed else { return }
            self.retryTask = nil
            self.load(url)
        }
    }
}

/// WKUserContentController retains its handlers; this breaks the cycle with the host.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

/// A plain container that adopts the host's web view; the last container on screen owns it.
struct SharedWebViewRepresentable: UIViewRepresentable {
    let url: URL
    let host: PreviewHost

    func makeUIView(context: Context) -> UIView {
        let container = WebContainer()
        container.backgroundColor = .clear
        container.clipsToBounds = true
        container.host = host
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        host.ensure(url)
        (container as? WebContainer)?.host = host
        (container as? WebContainer)?.adopt()
    }

    static func dismantleUIView(_ container: UIView, coordinator: ()) {
        // Leave the web view running; only let go of it if this container still holds it.
        for sub in container.subviews where sub is WKWebView { sub.removeFromSuperview() }
    }
}

/// Takes the web view when it lands in a window and sizes it to its bounds on every layout (a re-parented view keeps
/// its old frame otherwise).
final class WebContainer: UIView {
    weak var host: PreviewHost?

    func adopt() {
        guard let web = host?.webView, window != nil else { return }
        if web.superview !== self {
            web.removeFromSuperview()
            addSubview(web)
        }
        web.frame = bounds
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        adopt()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if let web = host?.webView, web.superview === self { web.frame = bounds }
    }
}
#endif
