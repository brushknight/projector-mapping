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

/// The direction lock of one touch on a horizontal control (protocol-free, UI-free, so it is unit tested): the
/// decision is made once per gesture from the finger's own travel, never from velocity, and never changes after.
///
/// - A touch that lands while the page is still scrolling (decelerating) belongs to the page: it stops the scroll and
///   never adjusts the control.
/// - Inside the dead zone nothing happens (a tap stays a tap).
/// - Past it, the control takes the drag only when it is clearly sideways (`|dx| > ratio × |dy|`); a tie or anything
///   steeper goes to the page, for the rest of the gesture.
public struct DirectionLock: Equatable, Sendable {
    public enum Decision: Equatable, Sendable { case undecided, control, page }

    public var deadZone: Double
    public var ratio: Double
    public private(set) var decision: Decision = .undecided
    /// Where the control's drag starts counting from: the travel at the moment the lock went to the control, so the
    /// value does not jump by the dead zone.
    public private(set) var origin: (Double, Double) = (0, 0)

    public init(deadZone: Double = DragIntent.threshold, ratio: Double = DragIntent.ratio) {
        self.deadZone = deadZone; self.ratio = ratio
    }

    public static func == (a: DirectionLock, b: DirectionLock) -> Bool {
        a.deadZone == b.deadZone && a.ratio == b.ratio && a.decision == b.decision && a.origin == b.origin
    }

    /// A finger went down. `pageMoving`: the enclosing scroll view is still decelerating.
    public mutating func begin(pageMoving: Bool) {
        decision = pageMoving ? .page : .undecided
        origin = (0, 0)
    }

    /// The finger moved to (dx, dy) from where it went down; returns the (sticky) decision.
    @discardableResult
    public mutating func move(dx: Double, dy: Double) -> Decision {
        guard decision == .undecided else { return decision }
        switch DragIntent.decide(dx: dx, dy: dy, threshold: deadZone, ratio: ratio) {
        case .horizontal:
            decision = .control
            origin = (dx, dy)
        case .vertical:
            decision = .page
        case .undecided:
            break
        }
        return decision
    }

    /// The finger lifted without leaving the dead zone and the page was not moving: a tap on the control.
    public var isTap: Bool { decision == .undecided }
}
