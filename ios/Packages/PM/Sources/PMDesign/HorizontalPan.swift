import SwiftUI
import PMKit
#if canImport(UIKit)
import UIKit
#endif

/// A sideways drag for controls that live inside a vertical ScrollView (sliders, colour strips, the frame slide).
///
/// SwiftUI's `DragGesture(minimumDistance: 0)` claims a touch on touch-down, before the scroll view can decide, so a
/// vertical swipe that starts on a slider adjusted it. This is a UIKit pan whose `gestureRecognizerShouldBegin` asks
/// `DragIntent.shouldBegin`: it begins only on a clearly horizontal start and fails otherwise, and the page's scroll
/// pan waits for it to fail, so vertical swipes scroll and sideways ones adjust.
public struct HorizontalPanValue: Sendable, Equatable {
    public enum Phase: Sendable, Equatable { case began, changed, ended, cancelled }
    public var phase: Phase
    /// Translation since the touch went down, in the view's points.
    public var translation: CGSize
    /// Where the finger is, in the view's local space.
    public var location: CGPoint
    /// Where the touch went down, in the view's local space.
    public var startLocation: CGPoint
}

#if canImport(UIKit)
public struct HorizontalPan: UIGestureRecognizerRepresentable {
    var enabled: Bool
    var action: (HorizontalPanValue) -> Void

    public init(enabled: Bool = true, action: @escaping (HorizontalPanValue) -> Void) {
        self.enabled = enabled
        self.action = action
    }

    public func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    public func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        pan.isEnabled = enabled
        return pan
    }

    public func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        recognizer.isEnabled = enabled
    }

    public func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let t = recognizer.translation(in: recognizer.view)
        let loc = context.converter.localLocation
        let start = CGPoint(x: loc.x - t.x, y: loc.y - t.y)
        let phase: HorizontalPanValue.Phase
        switch recognizer.state {
        case .began: phase = .began
        case .changed: phase = .changed
        case .ended: phase = .ended
        case .cancelled, .failed: phase = .cancelled
        default: return
        }
        action(HorizontalPanValue(phase: phase, translation: CGSize(width: t.x, height: t.y), location: loc, startLocation: start))
    }

    public final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        public func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard let pan = g as? UIPanGestureRecognizer else { return true }
            let t = pan.translation(in: pan.view), v = pan.velocity(in: pan.view)
            return DragIntent.shouldBegin(dx: t.x, dy: t.y, vx: v.x, vy: v.y)
        }

        /// The page's scroll pan waits for this one to fail (a vertical start), so it never steals a sideways drag.
        public func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            if let scroll = other.view as? UIScrollView, other === scroll.panGestureRecognizer { return true }
            return false
        }

        public func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { false }
    }
}
#endif

extension View {
    /// A sideways drag that leaves vertical swipes to the enclosing ScrollView (see `HorizontalPan`).
    public func horizontalPan(enabled: Bool = true, _ action: @escaping (HorizontalPanValue) -> Void) -> some View {
        #if canImport(UIKit)
        gesture(HorizontalPan(enabled: enabled, action: action))
        #else
        self
        #endif
    }
}
