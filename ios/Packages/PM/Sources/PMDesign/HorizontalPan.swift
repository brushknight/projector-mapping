import SwiftUI
import PMKit
#if canImport(UIKit)
import UIKit
#endif

/// A sideways drag for controls that live inside a vertical ScrollView (sliders, colour strips, the frame slide).
///
/// Root cause of controls reacting to scrolling (2026-10-15): the earlier version was a plain `UIPanGestureRecognizer`
/// whose `gestureRecognizerShouldBegin` fell back to the finger's *velocity* while the travel was still inside the
/// dead zone. UIKit asks that question after a few points of movement, so a vertical flick that started with a little
/// sideways jitter (or a finger that caught a still-decelerating page) began the slider, and the page then waited for
/// it. The decision also lived in a delegate, which SwiftUI's representable wiring does not guarantee to keep.
///
/// Now a `DirectionLockPan` recognizer decides by itself, once per gesture, from the travel only (`DirectionLock`):
/// nothing inside the dead zone, the control only on a clearly sideways start, the page on anything else (ties go to
/// the page) and on any touch that lands while the page is still moving. The enclosing scroll view's pan waits for it
/// to fail, so a sideways drag is never stolen and a vertical one never adjusts a control. A touch that never leaves
/// the dead zone ends as `.tap`.
public struct HorizontalPanValue: Sendable, Equatable {
    public enum Phase: Sendable, Equatable { case began, changed, ended, cancelled, tap }
    public var phase: Phase
    /// Translation since the lock went to the control (sideways intent), in the view's points.
    public var translation: CGSize
    /// Where the finger is, in the view's local space.
    public var location: CGPoint
    /// Where the touch went down, in the view's local space.
    public var startLocation: CGPoint
}

#if canImport(UIKit)
/// A one-finger pan that locks its direction once per touch (`DirectionLock`).
public final class DirectionLockPan: UIGestureRecognizer {
    public private(set) var lock = DirectionLock()
    private var start: CGPoint = .zero
    private(set) var current: CGPoint = .zero
    /// The touch ended inside the dead zone (state `.ended` without a drag).
    public private(set) var tapped = false

    /// Translation since the lock went to the control.
    public var translation: CGPoint {
        CGPoint(x: current.x - start.x - lock.origin.0, y: current.y - start.y - lock.origin.1)
    }
    public var startLocation: CGPoint { start }

    public override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard touches.count == 1, (event.allTouches?.count ?? 1) == 1, let t = touches.first else {
            state = .failed
            return
        }
        start = t.location(in: view)
        current = start
        tapped = false
        lock.begin(pageMoving: Self.pageMoving(view))
        if lock.decision == .page { state = .failed }
    }

    public override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let t = touches.first else { return }
        current = t.location(in: view)
        switch state {
        case .possible:
            switch lock.move(dx: current.x - start.x, dy: current.y - start.y) {
            case .control: state = .began
            case .page: state = .failed
            case .undecided: break
            }
        case .began, .changed:
            state = .changed
        default:
            break
        }
    }

    public override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        if let t = touches.first { current = t.location(in: view) }
        switch state {
        case .began, .changed: state = .ended
        case .possible:
            if lock.isTap {
                tapped = true
                state = .ended
            } else {
                state = .failed
            }
        default: state = .failed
        }
    }

    public override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        state = state == .began || state == .changed ? .cancelled : .failed
    }

    public override func reset() {
        super.reset()
        lock = DirectionLock()
        tapped = false
    }

    /// The page (any enclosing scroll view's pan) waits for this one to fail, so a sideways drag is never stolen.
    public override func shouldBeRequiredToFail(by other: UIGestureRecognizer) -> Bool {
        if let scroll = other.view as? UIScrollView, other === scroll.panGestureRecognizer { return true }
        return false
    }

    /// Never waits for another recognizer, and nothing runs together with it.
    public override func canBePrevented(by other: UIGestureRecognizer) -> Bool {
        if let scroll = other.view as? UIScrollView, other === scroll.panGestureRecognizer { return false }
        return super.canBePrevented(by: other)
    }

    /// Whether a scroll view above `view` is still moving (decelerating or being dragged by another touch).
    static func pageMoving(_ view: UIView?) -> Bool {
        var v = view?.superview
        while let s = v {
            if let scroll = s as? UIScrollView, scroll.isDecelerating || scroll.isDragging { return true }
            v = s.superview
        }
        return false
    }
}

public struct HorizontalPan: UIGestureRecognizerRepresentable {
    var enabled: Bool
    var action: (HorizontalPanValue) -> Void

    public init(enabled: Bool = true, action: @escaping (HorizontalPanValue) -> Void) {
        self.enabled = enabled
        self.action = action
    }

    public func makeUIGestureRecognizer(context: Context) -> DirectionLockPan {
        let pan = DirectionLockPan()
        pan.isEnabled = enabled
        pan.cancelsTouchesInView = true
        return pan
    }

    public func updateUIGestureRecognizer(_ recognizer: DirectionLockPan, context: Context) {
        recognizer.isEnabled = enabled
    }

    public func handleUIGestureRecognizerAction(_ recognizer: DirectionLockPan, context: Context) {
        let t = recognizer.translation
        let loc = context.converter.localLocation
        let phase: HorizontalPanValue.Phase
        switch recognizer.state {
        case .began: phase = .began
        case .changed: phase = .changed
        case .ended: phase = recognizer.tapped ? .tap : .ended
        case .cancelled, .failed: phase = .cancelled
        default: return
        }
        let start = CGPoint(x: loc.x - (recognizer.current.x - recognizer.startLocation.x), y: loc.y - (recognizer.current.y - recognizer.startLocation.y))
        action(HorizontalPanValue(phase: phase, translation: CGSize(width: t.x, height: t.y), location: loc, startLocation: start))
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
