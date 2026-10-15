import XCTest

/// Controls never react to scrolling (§16, the direction lock): a vertical swipe that starts on a slider scrolls the
/// page and leaves the value alone; a sideways drag adjusts it. Runs offline in the demo (`-pm-demo`).
final class DirectionLockUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        // scrolled so the light card (intensity) is on screen
        app.launchArguments = ["-pm-demo", "-pm-screen", "static", "-pm-scroll", "1500"]
        app.launch()
    }

    func slider(_ label: String) -> XCUIElement {
        let e = app.otherElements[label].firstMatch
        XCTAssertTrue(e.waitForExistence(timeout: 10), "no \(label) slider")
        XCTAssertTrue(e.isHittable, "\(label) is off screen")
        return e
    }

    func value(_ e: XCUIElement) -> String { (e.value as? String) ?? "" }

    func testVerticalSwipesOnSlidersScrollAndNeverAdjust() {
        let s = slider("intensity")
        let before = value(s)
        let y0 = s.frame.midY
        // one screen point, captured once: every drag starts on the slider (the page scrolls back between them)
        let a = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: s.frame.midX, dy: y0))
        for (dx, dy) in [(0.0, -160.0), (30, 160), (-40, -170), (40, 160), (12, -120), (-12, 120)] {
            a.press(forDuration: 0.02, thenDragTo: a.withOffset(CGVector(dx: dx, dy: dy)))
        }
        XCTAssertEqual(value(app.otherElements["intensity"].firstMatch), before, "a vertical swipe moved the slider")
    }

    func testSidewaysDragAdjusts() {
        let s = slider("intensity")
        let before = value(s)
        let a = s.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        a.press(forDuration: 0.05, thenDragTo: a.withOffset(CGVector(dx: -120, dy: 4)))
        XCTAssertNotEqual(value(slider("intensity")), before, "a sideways drag did not adjust the slider")
    }
}
