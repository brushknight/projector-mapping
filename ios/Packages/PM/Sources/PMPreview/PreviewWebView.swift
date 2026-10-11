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
/// reloads the page or flashes a placeholder. `placeholder` shows only until the page reports its first real frame
/// (the `projmap` script message "ready"), and again if the page fails.
public enum PreviewLoadState: Sendable { case loading, loaded, failed }

public struct PreviewWebView<Placeholder: View>: View {
    let url: URL?
    let placeholder: Placeholder
    #if canImport(UIKit)
    @State private var host = PreviewHost.shared
    #endif

    public init(url: URL?, @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        self.placeholder = placeholder()
    }

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
        #else
        placeholder
        #endif
    }
}

#if canImport(UIKit)
/// Owns the single preview web view and its load state for the app's lifetime.
@MainActor
@Observable
public final class PreviewHost: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    public static let shared = PreviewHost()

    public private(set) var state: PreviewLoadState = .loading
    @ObservationIgnored private(set) var url: URL?
    @ObservationIgnored private var readyFallback: Task<Void, Never>?
    @ObservationIgnored lazy var webView: WKWebView = makeWebView()

    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(WeakMessageHandler(self), name: "projmap")
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.navigationDelegate = self
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return view
    }

    /// Loads `url` unless the shared view already shows it (a tab switch keeps the running page).
    func ensure(_ url: URL) {
        guard self.url != url else { return }
        self.url = url
        state = .loading
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8))
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
            state = .failed
            return .cancel
        }
        return .allow
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Pages from before the "ready" message: show them a moment after load instead of waiting forever.
        readyFallback?.cancel()
        readyFallback = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard let self, !Task.isCancelled, self.state == .loading else { return }
            self.state = .loaded
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed() }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed() }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let url else { return }
        self.url = nil
        ensure(url)
    }

    public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "ready" else { return }
        readyFallback?.cancel()
        state = .loaded
    }

    private func failed() {
        readyFallback?.cancel()
        state = .failed
        url = nil  // the next hero retries
    }
}

/// WKUserContentController retains its handlers; this breaks the cycle with the shared host.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

/// A plain container that adopts the shared web view; the last container on screen owns it.
struct SharedWebViewRepresentable: UIViewRepresentable {
    let url: URL
    let host: PreviewHost

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear
        container.clipsToBounds = true
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        host.ensure(url)
        let web = host.webView
        if web.superview !== container {
            web.removeFromSuperview()
            web.frame = container.bounds
            container.addSubview(web)
        }
    }

    static func dismantleUIView(_ container: UIView, coordinator: ()) {
        // Leave the web view running; only let go of it if this container still holds it.
        for sub in container.subviews where sub is WKWebView { sub.removeFromSuperview() }
    }
}
#endif
