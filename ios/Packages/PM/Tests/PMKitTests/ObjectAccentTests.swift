import Foundation
import Testing
@testable import PMKit
import PMTestSupport

/// (protocol §19) The object accent decodes from the fixture, defaults when absent, and encodes "all" or ids.
@Suite struct ObjectAccentTests {
    @Test func decodesTheFixture() throws {
        let scene = try JSONDecoder().decode(Scene.self, from: Fixtures.data("scene"))
        let a = try #require(scene.objectAccent)
        #expect(a.on == false && a.objectIds == nil && a.outline.width == 3 && a.fill.mode == "cut")
    }

    @Test func absentIsOffAndEncodesAllOrIds() throws {
        let a = try JSONDecoder().decode(ObjectAccent.self, from: Data(#"{"objects":["obj_cube"]}"#.utf8))
        #expect(a.on == false && a.objectIds == ["obj_cube"] && a.outline.on && a.fill.opacity == 0.5)
        let all = try JSONValue(encoding: ObjectAccent(on: true))
        #expect(all["objects"]?.string == "all" && all["fill"]?["mode"]?.string == "cut")
    }
}
