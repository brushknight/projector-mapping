import CoreGraphics
import Foundation
import Testing
@testable import PMCamera

@Suite struct SceneLightTests {
    /// A dim room with a bright projected rectangle from (16, 12) to (48, 36) in a 64×48 thumbnail.
    func frame(lit: (Int, Int, Int, Int)?, room: Double = 0.08, light: Double = 0.9) -> [Double] {
        var l = [Double](repeating: room, count: 64 * 48)
        if let (x0, y0, x1, y1) = lit {
            for y in y0..<y1 { for x in x0..<x1 { l[y * 64 + x] = light } }
        }
        return l
    }

    @Test func findsTheProjectedQuad() {
        let s = SceneLight.analyze(luma: frame(lit: (16, 12, 48, 36)), w: 64, h: 48)
        #expect(s.projectorInFrame)
        #expect(!s.touchesEdge)
        #expect(abs(s.bright - 0.25) < 0.01)
        #expect(s.quad.count == 4)
        #expect(abs(s.quad[0].x - 16.5 / 64) < 0.01 && abs(s.quad[0].y - 12.5 / 48) < 0.01)
        #expect(abs(s.quad[2].x - 47.5 / 64) < 0.01 && abs(s.quad[2].y - 35.5 / 48) < 0.01)
    }

    @Test func darkOrFlatFramesHaveNoProjector() {
        #expect(!SceneLight.analyze(luma: frame(lit: nil), w: 64, h: 48).projectorInFrame)
        #expect(!SceneLight.analyze(luma: frame(lit: nil, room: 0.7), w: 64, h: 48).projectorInFrame)
        // a speck is not a projection
        #expect(!SceneLight.analyze(luma: frame(lit: (30, 20, 33, 23)), w: 64, h: 48).projectorInFrame)
    }

    @Test func flagsAProjectionThatRunsOffTheEdge() {
        let s = SceneLight.analyze(luma: frame(lit: (0, 10, 40, 40)), w: 64, h: 48)
        #expect(s.projectorInFrame)
        #expect(s.touchesEdge)
    }
}
