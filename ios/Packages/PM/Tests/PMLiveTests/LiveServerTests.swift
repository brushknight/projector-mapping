import Foundation
import Testing
@testable import PMLive
import PMStore
import PMKit
import PMTestSupport

/// Against a running backend: `PROJMAP_TEST_SERVER=http://127.0.0.1:7400 swift test --filter LiveServerTests`.
/// Skipped when the variable is not set.
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["PROJMAP_TEST_SERVER"] != nil))
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
        hub.param(Channel.scene(sceneId), ScenePath.stackLight("static", "intensity"), .number(target))
        try await eventually(5) { (try? db.sceneVersion(sceneId)).flatMap { $0 } ?? 0 > version }
        let api = APIClient(server: server, token: nil)
        let remote = try await api.scene(sceneId)
        #expect(remote.value(at: ScenePath.stackLight("static", "intensity"))?.double == target)

        // A structural edit through the outbox.
        let layerId = try #require(try db.read(Queries.active).scene?.attachments("static").first?.id)
        let visible = try #require(try db.read(Queries.active).scene?.attachments("static").first?.visible)
        hub.edit(sceneId: sceneId, .setAttachmentField(attachmentId: layerId, field: ["visible"], value: .bool(!visible)))
        try await eventually(5) { (try? db.pendingItems().isEmpty) == true }
        let after = try await api.scene(sceneId)
        #expect(after.value(at: "/backdrop/static/attachments/0/visible")?.bool == !visible)
        hub.edit(sceneId: sceneId, .setAttachmentField(attachmentId: layerId, field: ["visible"], value: .bool(visible)))
        try await eventually(5) { (try? db.pendingItems().isEmpty) == true }

        // Show control.
        let onAir = try #require(try db.read(Queries.active).show?.onAir)
        try await hub.command("show.blackout", ["on": .bool(onAir)])
        try await eventually(5) { (try? db.read(Queries.active).show?.onAir) == !onAir }
        try await hub.command("show.blackout", ["on": .bool(!onAir)])
        try await eventually(5) { (try? db.read(Queries.active).show?.onAir) == onAir }
    }

    /// Protocol §15 against the server: one attachment from the catalog, the frame slide as a param, a motion preset,
    /// a scene made from a kind.
    @Test func lightAttachmentsMotionAndKinds() async throws {
        let db = try AppDatabase.inMemory()
        let hub = LiveHub(db: db, identity: .init(name: "pm-ios-test", build: "test"))
        hub.start(server: server, token: nil)
        defer { hub.stop() }
        try await eventually(5) { hub.status == .online }
        let sceneId = try await until(5) { try db.read(Queries.active).scene?.id }
        try await eventually(5) { (try? db.read(Queries.catalog).version) ?? 0 >= 4 }
        let cat = try db.read(Queries.catalog)
        let api = APIClient(server: server, token: nil)
        let before = try await api.scene(sceneId)

        // One attachment replaces the list.
        let item = try #require(cat.gobo("blinds"))
        let a = cat.newAttachment(item)
        hub.edit(sceneId: sceneId, .replaceAttachments(mode: "static", attachments: [try JSONValue(encoding: a)]))
        try await eventually(5) { (try? db.pendingItems().isEmpty) == true }
        var remote = try await api.scene(sceneId)
        #expect(remote.value(at: "/backdrop/static/attachments/0/gobo") == "blinds")
        #expect(remote.value(at: "/backdrop/static/attachments/0/id")?.string == a.id)

        // The slide is a param the server commits.
        let version = try #require(try db.sceneVersion(sceneId))
        hub.param(Channel.scene(sceneId), ScenePath.stackLight("static", "slide", "x"), 0.25)
        try await eventually(5) { (try? db.sceneVersion(sceneId)).flatMap { $0 } ?? 0 > version }
        remote = try await api.scene(sceneId)
        #expect(remote.value(at: "/backdrop/static/light/slide/x") == 0.25)

        // A motion preset on the attachment, started on the server clock.
        let preset = try #require(cat.motionPreset("sun-lr"))
        let m = Motion.start(preset.motion, serverNowMs: hub.serverNowMs)
        hub.edit(sceneId: sceneId, .setAttachmentField(attachmentId: a.id, field: ["motion"], value: try JSONValue(encoding: m)))
        try await eventually(5) { (try? db.pendingItems().isEmpty) == true }
        remote = try await api.scene(sceneId)
        #expect(remote.value(at: "/backdrop/static/attachments/0/motion/preset") == "sun-lr")
        #expect(abs((remote.value(at: "/backdrop/static/attachments/0/motion/startedAt")?.double ?? 0) - Date().timeIntervalSince1970 * 1000) < 60_000)

        // A live scene from its kind's template.
        let id = try await hub.createScene(name: "pm-ios-test live", kind: "live")
        let made = try await api.scene(id).decode(Scene.self)
        #expect(made.kind == "live" && made.mode == "live" && !made.attachments("live").isEmpty)
        try await hub.deleteScene(id)

        // Put the stack back.
        if let stack = before.value(at: "/backdrop/static") {
            hub.edit(sceneId: sceneId, .raw([.replace("/backdrop/static", stack)]))
            try await eventually(5) { (try? db.pendingItems().isEmpty) == true }
        }
    }
}
