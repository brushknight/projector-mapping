import Foundation
import Testing
@testable import PMLive
import PMStore
import PMKit
import PMTestSupport

/// Against a running backend: `PROJMAP_TEST_SERVER=http://127.0.0.1:7400 swift test --filter LiveServerTests`.
/// Skipped when the variable is not set.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["PROJMAP_TEST_SERVER"] != nil))
struct LiveServerTests {
    let server = URL(string: ProcessInfo.processInfo.environment["PROJMAP_TEST_SERVER"] ?? "http://127.0.0.1:7400")!

    @Test func paramPatchAndCommandRoundTrip() async throws {
        let db = try AppDatabase.inMemory()
        let hub = LiveHub(db: db, identity: .init(name: "pm-ios-test", build: "test"))
        hub.start(server: server, token: nil)
        defer { hub.stop() }
        try await eventually(5) { hub.status == .online }
        let sceneId = try await until(5) { try db.read(Queries.active).scene?.id }
        let version = try #require(try db.sceneVersion(sceneId))
        #expect(try db.read(Queries.catalog).gobos.count >= 8)
        #expect(hub.clock.offsetMs != nil)

        // A drag: the server commits a replace 200 ms after the last param.
        let target = Double(Int.random(in: 10...90)) / 100
        hub.param(Channel.scene(sceneId), ScenePath.light("static", 0, "intensity"), .number(target))
        try await eventually(5) { (try? db.sceneVersion(sceneId)).flatMap { $0 } ?? 0 > version }
        let api = APIClient(server: server, token: nil)
        let remote = try await api.scene(sceneId)
        #expect(remote.value(at: ScenePath.light("static", 0, "intensity"))?.double == target)

        // A structural edit through the outbox.
        let layerId = try #require(try db.read(Queries.active).scene?.layers("static").first?.id)
        let visible = try #require(try db.read(Queries.active).scene?.layers("static").first?.visible)
        hub.edit(sceneId: sceneId, .setLayerField(layerId: layerId, field: ["visible"], value: .bool(!visible)))
        try await eventually(5) { (try? db.pendingItems().isEmpty) == true }
        let after = try await api.scene(sceneId)
        #expect(after.value(at: "/backdrop/static/layers/0/visible")?.bool == !visible)
        hub.edit(sceneId: sceneId, .setLayerField(layerId: layerId, field: ["visible"], value: .bool(visible)))
        try await eventually(5) { (try? db.pendingItems().isEmpty) == true }

        // Show control.
        let onAir = try #require(try db.read(Queries.active).show?.onAir)
        try await hub.command("show.blackout", ["on": .bool(onAir)])
        try await eventually(5) { (try? db.read(Queries.active).show?.onAir) == !onAir }
        try await hub.command("show.blackout", ["on": .bool(!onAir)])
        try await eventually(5) { (try? db.read(Queries.active).show?.onAir) == onAir }
    }
}
