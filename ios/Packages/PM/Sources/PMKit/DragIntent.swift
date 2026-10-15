import Foundation

/// Whether a drag that started on a horizontal control (slider, colour strip, frame slide) adjusts it or scrolls the
/// page. A control takes the drag only on clear horizontal intent; anything else belongs to the scroll view.
public enum DragIntent: Equatable, Sendable {
    /// Too short to tell yet.
    case undecided
    /// Adjust the control.
    case horizontal
    /// Let the page scroll.
    case vertical

    /// Points the finger must travel sideways before a control starts adjusting.
    public static let threshold = 8.0
    /// How much more horizontal than vertical the drag must be (1.5 ≈ within 34° of horizontal).
    public static let ratio = 1.5

    /// Decides from the translation so far: horizontal once |dx| > threshold and |dx| > ratio × |dy|; vertical as soon
    /// as the drag is mostly vertical beyond the threshold, or has gone the threshold without being clearly sideways.
    public static func decide(dx: Double, dy: Double, threshold: Double = DragIntent.threshold, ratio: Double = DragIntent.ratio) -> DragIntent {
        let ax = abs(dx), ay = abs(dy)
        if ax > threshold, ax > ratio * ay { return .horizontal }
        if max(ax, ay) > threshold { return .vertical }
        return .undecided
    }

    /// For a recognizer that is asked once (UIKit's `gestureRecognizerShouldBegin`): the translation when it is long
    /// enough, else the velocity's direction. Only a clearly horizontal start begins.
    public static func shouldBegin(dx: Double, dy: Double, vx: Double, vy: Double) -> Bool {
        switch decide(dx: dx, dy: dy) {
        case .horizontal: return true
        case .vertical: return false
        case .undecided:
            let ax = abs(vx), ay = abs(vy)
            if ax == 0 && ay == 0 { return abs(dx) > ratio * abs(dy) && abs(dx) > 0 }
            return ax > ratio * ay
        }
    }
}
