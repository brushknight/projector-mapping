import Foundation
import Testing
import GRDB
@testable import PMStore
import PMKit
import PMTestSupport

@Suite struct StoreTests {
    func seeded() throws -> AppDatabase {
        let db = try AppDatabase.inMemory()
        try db.saveShow(JSONDecoder().decode(Show.self, from: Fixtures.data("show")))
        try db.saveSceneSnapshot(Fixtures.json("scene"), version: 418)
        try db.saveSetup(Fixtures.json("setup"), version: 3)
        try db.saveCatalog(Data(contentsOf: Fixtures.catalogURL), version: 1)
        return db
    }

    @Test func activeStateReadsShowSceneSetup() throws {
        let db = try seeded()
        let s = try db.read(Queries.active)
        #expect(s.show?.activeSceneId == "scn_desk")
        #expect(s.scene?.version == 418)
        #expect(s.setup?.name == "Desk projector")
        #expect(s.pending == 0)
        #expect(try db.read(Queries.catalog).gobos.count == 8)
    }

    @Test func optimisticEditShowsAtOnceAndStaysAfterAck() throws {
        let db = try seeded()
        let id = try db.enqueue(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["visible"], value: false))
        var s = try db.read(Queries.active)
        #expect(s.scene?.layers("live")[1].visible == false)
        #expect(s.pending == 1)
        // The confirmed copy is untouched until the server answers.
        #expect(try db.confirmedScene("scn_desk")?.value(at: "/backdrop/live/layers/1/visible") == true)

        try db.markSent(id)
        #expect(try db.applyScenePatch("scn_desk", ops: [.replace("/backdrop/live/layers/1/visible", false)], version: 419, ack: id))
        s = try db.read(Queries.active)
        #expect(s.scene?.layers("live")[1].visible == false)
        #expect(s.scene?.version == 419)
        #expect(s.pending == 0)
    }

    @Test func pendingEditsReplayOnOtherPeoplesPatches() throws {
        let db = try seeded()
        try db.enqueue(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["opacity"], value: 0.5))
        // Another client inserts a layer at the bottom: the tree moves to index 2.
        let layer: JSONValue = ["id": "lay_new", "kind": "solid", "ref": "black", "name": "black", "params": ["color": "#000000"]]
        #expect(try db.applyScenePatch("scn_desk", ops: [.add("/backdrop/live/layers/0", layer)], version: 419))
        let s = try db.read(Queries.active)
        #expect(s.scene?.layers("live").map(\.id) == ["lay_new", "lay_live_window", "lay_tree"])
        #expect(s.scene?.layers("live")[2].opacity == 0.5)
        #expect(try db.confirmedScene("scn_desk")?.value(at: "/backdrop/live/layers/2/opacity") == 0.88)
    }

    @Test func intentsThatNoLongerApplyAreDropped() throws {
        let db = try seeded()
        try db.enqueue(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["opacity"], value: 0.5))
        #expect(try db.applyScenePatch("scn_desk", ops: [.remove("/backdrop/live/layers/1")], version: 419))
        #expect(try db.pendingItems().isEmpty)
        #expect(try db.read(Queries.active).scene?.layers("live").count == 1)
    }

    @Test func presetApplyShowsAtOnce() throws {
        let db = try seeded()
        let p = try JSONDecoder().decode(Preset.self, from: Fixtures.data("preset"))
        try db.enqueue(sceneId: "scn_desk", .applyPreset(mode: "live", backdrop: try JSONValue(encoding: p.backdrop)))
        let s = try db.read(Queries.active)
        #expect(s.scene?.mode == "live")
        #expect(s.scene?.layers("live").map(\.id) == ["lay_window"])
        #expect(s.scene?.onAirLayers.map(\.id) == ["lay_window"])
        #expect(try db.confirmedScene("scn_desk")?.value(at: "/mode") == "static")
    }

    @Test func versionGapAsksForASnapshot() throws {
        let db = try seeded()
        #expect(try db.applyScenePatch("scn_desk", ops: [.replace("/name", "x")], version: 421) == false)
        #expect(try db.sceneVersion("scn_desk") == 418)
        // An echo of a version this copy already has is fine.
        #expect(try db.applyScenePatch("scn_desk", ops: [.replace("/name", "x")], version: 418))
    }

    @Test func paramsWriteBothCopies() throws {
        let db = try seeded()
        try db.enqueue(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["visible"], value: false))
        try db.applyParam(channel: "scene:scn_desk", path: "/backdrop/static/layers/0/light/intensity", value: 0.62)
        #expect(try db.confirmedScene("scn_desk")?.value(at: "/backdrop/static/layers/0/light/intensity") == 0.62)
        let s = try db.read(Queries.active)
        #expect(s.scene?.layers("static")[0].light?.intensity == 0.62)
        #expect(s.scene?.layers("live")[1].visible == false)
        try db.applyParam(channel: "setup:set_desk", path: "/master", value: 0.5)
        #expect(try db.read(Queries.active).setup?.master == 0.5)
    }

    @Test func outboxSendsOnePerTargetInOrder() throws {
        let db = try seeded()
        let a = try db.enqueue(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["visible"], value: false))
        let b = try db.enqueue(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["visible"], value: true))
        let r = try db.enqueue(.createPreset(name: "x", mode: "static", sceneId: "scn_desk", tempId: "tmp"))
        #expect(try db.sendable().map(\.clientId) == [a, r])
        try db.markSent(a)
        #expect(try db.sendable().map(\.clientId) == [r])
        try db.removeOutbox(a)
        #expect(try db.sendable().map(\.clientId) == [b, r])
        try db.markSent(b)
        try db.requeueAll()
        #expect(try db.sendable().map(\.clientId) == [b, r])
    }

    @Test func snapshotReplaysPending() throws {
        let db = try seeded()
        try db.enqueue(sceneId: "scn_desk", .setLayerField(layerId: "lay_window", field: ["ref"], value: "blinds"))
        var scene = try Fixtures.json("scene")
        scene = try scene.applying(.replace("/name", "Desk 2"))
        try db.saveSceneSnapshot(scene, version: 430)
        let s = try db.read(Queries.active)
        #expect(s.scene?.name == "Desk 2")
        #expect(s.scene?.version == 430)
        #expect(s.scene?.layers("static")[0].ref == "blinds")
    }

    @Test func presetsAndLists() throws {
        let db = try seeded()
        let p = try JSONDecoder().decode(Preset.self, from: Fixtures.data("preset"))
        try db.savePresets([p])
        try db.addPendingPreset(Preset(id: "tmp_1", name: "mine", mode: "static"))
        #expect(try db.read { try Queries.presets($0, mode: "static") }.map(\.name) == ["golden hour", "mine"])
        try db.savePresets([p])
        #expect(try db.read { try Queries.presets($0, mode: "static") }.count == 2)
        try db.saveSceneList([SceneSummary(id: "scn_desk", name: "Desk", setupId: "set_desk", version: 1),
                              SceneSummary(id: "scn_tour", name: "desk tour", setupId: "set_desk", version: 1)])
        #expect(try db.read(Queries.scenes).map(\.id) == ["scn_desk", "scn_tour"])
    }

    @Test func observationFiresOnChange() async throws {
        let db = try seeded()
        var it = db.values(db.observeActive()).makeAsyncIterator()
        let first = try await it.next()
        #expect(first?.scene?.layers("static")[0].light?.intensity == 0.8)
        try db.applyParam(channel: "scene:scn_desk", path: "/backdrop/static/layers/0/light/intensity", value: 0.3)
        let second = try await it.next()
        #expect(second?.scene?.layers("static")[0].light?.intensity == 0.3)
    }
}
