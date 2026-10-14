import Foundation
import Testing
@testable import PMLive
import PMStore
import PMKit
import PMTestSupport

@Suite struct ClockSyncTests {
    @Test func sampleMath() {
        // Sent at 1000 ms, answered at 1040 ms: rtt 40, the server read its clock at our 1020 ms.
        let s = ClockSync.sample(t0: 1000, t1: 1040, serverNs: 1_500_000_000)
        #expect(s.rttMs == 40)
        #expect(s.offsetMs == 1500 - 1020)
    }

    @Test func medianOfTheLastEight() {
        var c = ClockSync()
        #expect(c.offsetMs == nil)
        let offsets: [Double] = [100, 102, 98, 500, 101, 99, 100, 103, 97]  // one outlier, nine samples
        for (i, o) in offsets.enumerated() {
            let t0 = Double(i * 1000)
            c.add(t0: t0, t1: t0 + 10, serverNs: Int64((t0 + 5 + o) * 1e6))
        }
        #expect(c.samples.count == 8)
        #expect(abs((c.offsetMs ?? 0) - 100.5) < 0.0001)
        #expect(c.serverNowMs(localMs: 0) == c.offsetMs)
    }

    @Test func fixturePingPong() throws {
        let msgs = try Fixtures.wsMessages()
        let pong = try #require(msgs.first { $0["t"] == "pong" })
        let t0 = try #require(pong["d"]?["t0"]?.double)
        let ts = try #require(pong["d"]?["ts"]?.double)
        let s = ClockSync.sample(t0: t0, t1: t0 + 1, serverNs: Int64(ts))
        #expect(abs(s.offsetMs - (ts / 1e6 - (t0 + 0.5))) < 0.001)
    }
}

@Suite struct ParamThrottleTests {
    @Test func sixtyHertzWithTrailingValue() {
        var t = ParamThrottle(hz: 60)
        let p = "/backdrop/static/layers/0/light/intensity"
        #expect(t.submit(channel: "scene:a", path: p, value: 0.1, now: 0).count == 1)
        #expect(t.submit(channel: "scene:a", path: p, value: 0.2, now: 0.005).isEmpty)
        #expect(t.submit(channel: "scene:a", path: p, value: 0.3, now: 0.010).isEmpty)
        #expect(t.due(now: 0.012).isEmpty)
        #expect(abs((t.nextDeadline() ?? 0) - 1.0 / 60) < 1e-9)
        let out = t.due(now: 0.017)
        #expect(out == [.init(channel: "scene:a", path: p, value: 0.3)])
        #expect(!t.hasPending)
        // A new value right after the trailing send waits again.
        #expect(t.submit(channel: "scene:a", path: p, value: 0.4, now: 0.020).isEmpty)
        #expect(t.due(now: 0.034) == [.init(channel: "scene:a", path: p, value: 0.4)])
    }

    @Test func pathsAreIndependent() {
        var t = ParamThrottle(hz: 60)
        #expect(t.submit(channel: "scene:a", path: "/x", value: 1, now: 0).count == 1)
        #expect(t.submit(channel: "scene:a", path: "/y", value: 1, now: 0.001).count == 1)
        #expect(t.submit(channel: "setup:s", path: "/x", value: 1, now: 0.002).count == 1)
    }

    @Test func burstSendsAtMostSixtyPerSecond() {
        var t = ParamThrottle(hz: 60)
        var sent = 0
        var now = 0.0
        while now < 1.0 {   // a 120 Hz drag for one second
            sent += t.submit(channel: "scene:a", path: "/x", value: .number(now), now: now).count
            sent += t.due(now: now).count
            now += 1.0 / 120
        }
        sent += t.due(now: 2).count
        #expect(sent <= 61)
        #expect(sent >= 59)
    }

    @Test func dropForgetsHeldValues() {
        var t = ParamThrottle()
        _ = t.submit(channel: "scene:a", path: "/x", value: 1, now: 0)
        _ = t.submit(channel: "scene:a", path: "/x", value: 2, now: 0.001)
        t.drop()
        #expect(t.due(now: 1).isEmpty)
    }
}

@MainActor
@Suite struct LiveHubTests {
    let server = URL(string: "http://studio-mac.local:7400")!

    func makeHub() throws -> (LiveHub, FakeHub, AppDatabase) {
        let db = try AppDatabase.inMemory()
        let fake = FakeHub()
        let hub = LiveHub(db: db, transport: fake, identity: .init(name: "Test iPhone", build: "test"))
        hub.backoff = [0.01]
        return (hub, fake, db)
    }

    func show() throws -> Show { try JSONDecoder().decode(Show.self, from: Fixtures.data("show")) }

    /// Connects, answers hello with welcome and the active scene's snapshot.
    func online() async throws -> (LiveHub, FakeConnection, AppDatabase) {
        let (hub, fake, db) = try makeHub()
        hub.start(server: server, token: "tok_abc")
        let c = try await fake.connection()
        let hello = try await c.message("hello")
        #expect(hello.d?["token"] == "tok_abc")
        #expect(hello.d?["role"] == "remote")
        try c.welcome(show: show())
        try await eventually { hub.status == .online }
        _ = try await c.message("sub", ch: "scene:scn_desk")
        c.push(Envelope(t: "snapshot", ch: "scene:scn_desk", v: 418, d: try Fixtures.json("scene")))
        try await eventually { (try? db.sceneVersion("scn_desk")) == 418 }
        return (hub, c, db)
    }

    @Test func helloWelcomeSubscribesAndSyncsClock() async throws {
        let (hub, c, db) = try await online()
        for ch in ["show", "presets", "devices", "scene:scn_desk", "setup:set_desk"] {
            _ = try await c.message("sub", ch: ch)
        }
        #expect(try db.read(Queries.active).show?.activeSceneId == "scn_desk")
        let ping = try await c.message("ping")
        let t0 = try #require(ping.d?["t0"]?.double)
        let serverNs = (t0 + 250) * 1e6
        c.push(Envelope(t: "pong", d: ["t0": .number(t0), "ts": .number(serverNs)]))
        try await eventually { hub.clock.samples.count >= 2 }
        hub.stop()
    }

    @Test func structuralEditGoesOutAsPatchAndIsAcked() async throws {
        let (hub, c, db) = try await online()
        hub.edit(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["visible"], value: false))
        #expect(try db.read(Queries.active).scene?.layers("live")[1].visible == false)
        let patch = try await c.message("patch")
        #expect(patch.ch == "scene:scn_desk")
        #expect(patch.base == 418)
        #expect(PatchedMessage(patch.d)?.ops == [.replace("/backdrop/live/layers/1/visible", false)])
        c.push(Envelope(t: "patched", ch: "scene:scn_desk", re: patch.id, v: 419, d: ["ops": try JSONValue(encoding: [PatchOp.replace("/backdrop/live/layers/1/visible", false)]), "by": "dev_7k2"]))
        try await eventually { (try? db.pendingItems().isEmpty) == true }
        #expect(try db.sceneVersion("scn_desk") == 419)
        #expect(try db.read(Queries.active).scene?.layers("live")[1].visible == false)
        hub.stop()
    }

    @Test func staleRejectRebasesOnTheNewSnapshot() async throws {
        let (hub, c, db) = try await online()
        hub.edit(sceneId: "scn_desk", .setLayerField(layerId: "lay_tree", field: ["opacity"], value: 0.5))
        let first = try await c.message("patch")
        #expect(PatchedMessage(first.d)?.ops == [.replace("/backdrop/live/layers/1/opacity", 0.5)])
        // Meanwhile the editor inserted a layer at the bottom (version 419) and the server rejects our base.
        c.push(Envelope(t: "reject", re: first.id, v: 419, d: ["code": "stale", "message": "Scene changed; rebase on version 419."]))
        _ = try await c.message("sub", ch: "scene:scn_desk", skipping: 1)
        var newer = try Fixtures.json("scene")
        newer = try newer.applying(.add("/backdrop/live/layers/0", ["id": "lay_new", "kind": "solid", "ref": "black", "name": "black", "params": [:]]))
        c.push(Envelope(t: "snapshot", ch: "scene:scn_desk", v: 419, d: newer))
        let second = try await c.message("patch", skipping: 1)
        #expect(second.id == first.id)
        #expect(second.base == 419)
        #expect(PatchedMessage(second.d)?.ops == [.replace("/backdrop/live/layers/2/opacity", 0.5)])
        #expect(try db.read(Queries.active).scene?.layers("live")[2].opacity == 0.5)
        hub.stop()
    }

    @Test func editsWaitOfflineAndGoOutAfterReconnect() async throws {
        let (hub, fake, db) = try makeHub()
        try db.saveSceneSnapshot(Fixtures.json("scene"), version: 418)
        hub.edit(sceneId: "scn_desk", .removeLayer(layerId: "lay_tree"))
        #expect(try db.read(Queries.active).scene?.layers("live").count == 1)
        hub.start(server: server, token: nil)
        let c = try await fake.connection()
        try c.welcome(show: show())
        c.push(Envelope(t: "snapshot", ch: "scene:scn_desk", v: 418, d: try Fixtures.json("scene")))
        let patch = try await c.message("patch")
        #expect(PatchedMessage(patch.d)?.ops == [.remove("/backdrop/live/layers/1")])
        hub.stop()
    }

    @Test func paramsAreThrottledAndNeverQueuedOffline() async throws {
        let (hub, fake, db) = try makeHub()
        try db.saveSceneSnapshot(Fixtures.json("scene"), version: 418)
        #expect(hub.param("scene:scn_desk", "/backdrop/static/layers/0/light/intensity", 0.1) == false)
        hub.start(server: server, token: nil)
        let c = try await fake.connection()
        try c.welcome(show: show())
        try await eventually { hub.isLive }
        var clock = 100.0
        hub.now = { clock }
        for v in [0.2, 0.3, 0.4, 0.5, 0.6] {
            hub.param("scene:scn_desk", "/backdrop/static/layers/0/light/intensity", .number(v))
            clock += 0.002
        }
        clock += 0.02
        try await eventually { c.count("param") == 2 }
        let params = c.sent.filter { $0.t == "param" }
        #expect(params[0].d?["value"] == 0.2)
        #expect(abs((params[1].d?["value"]?.double ?? 0) - 0.6) < 1e-9)
        #expect(params[1].ch == "scene:scn_desk")
        #expect(abs((try db.read(Queries.active).scene?.layers("static")[0].light?.intensity ?? 0) - 0.6) < 1e-9)
        hub.stop()
    }

    @Test func incomingParamsAndPatchesReachTheStore() async throws {
        let (hub, c, db) = try await online()
        c.push(Envelope(t: "param", ch: "scene:scn_desk", d: ["path": "/backdrop/static/layers/0/light/intensity", "value": 0.62, "by": "dev_x"]))
        try await eventually { (try? db.read(Queries.active).scene?.layers("static")[0].light?.intensity) == 0.62 }
        c.push(Envelope(t: "patched", ch: "scene:scn_desk", v: 419, d: ["ops": [["op": "replace", "path": "/name", "value": "Desk 2"]], "by": "dev_x"]))
        try await eventually { (try? db.read(Queries.active).scene?.name) == "Desk 2" }
        // A gap: the hub asks for a new snapshot.
        c.push(Envelope(t: "patched", ch: "scene:scn_desk", v: 425, d: ["ops": [["op": "replace", "path": "/name", "value": "x"]]]))
        _ = try await c.message("sub", ch: "scene:scn_desk", skipping: 1)
        hub.stop()
    }

    @Test func commandsWaitForAckOrError() async throws {
        let (hub, c, _) = try await online()
        async let go: JSONValue? = hub.command("show.go")
        let cmd = try await c.message("cmd")
        #expect(cmd.d?["name"] == "show.go")
        c.push(Envelope(t: "ack", re: cmd.id))
        _ = try await go

        let bad = Task { try await hub.command("show.blackout", ["on": true]) }
        let cmd2 = try await c.message("cmd", skipping: 1)
        #expect(cmd2.d?["args"]?["on"] == true)
        c.push(Envelope(t: "error", re: cmd2.id, d: ["code": "no_scene", "message": "No active scene."]))
        await #expect(throws: WireError.self) { _ = try await bad.value }
        hub.stop()
    }

    @Test func commandsFailFastOffline() async throws {
        let (hub, _, _) = try makeHub()
        await #expect(throws: LiveError.notConnected) { try await hub.command("show.go") }
    }

    @Test func rpcCameraCaptureIsAnswered() async throws {
        let (hub, c, _) = try await online()
        hub.handleRPC("camera.capture") { args in
            ["sha": .string("sha_for_\(args["requestId"]?.string ?? "")")]
        }
        c.push(Envelope(t: "rpc", id: "r-2", d: ["method": "camera.capture", "args": ["requestId": "cap_9", "lock": true]]))
        let result = try await c.message("rpc.result")
        #expect(result.re == "r-2")
        #expect(result.d?["sha"] == "sha_for_cap_9")
        c.push(Envelope(t: "rpc", id: "r-3", d: ["method": "output.pattern", "args": [:]]))
        let err = try await c.message("rpc.error")
        #expect(err.re == "r-3")
        hub.stop()
    }

    @Test func reconnectsAfterADrop() async throws {
        let (hub, fake, _) = try makeHub()
        hub.start(server: server, token: nil)
        let c1 = try await fake.connection(1)
        try c1.welcome(show: show())
        try await eventually { hub.status == .online }
        c1.drop()
        let c2 = try await fake.connection(2)
        _ = try await c2.message("hello")
        try c2.welcome(show: show())
        try await eventually { hub.status == .online }
        hub.stop()
        #expect(hub.status == .offline)
    }

    @Test func showChangeFollowsTheActiveScene() async throws {
        let (hub, c, _) = try await online()
        var s = try show()
        s.activeSceneId = "scn_tour"
        c.push(Envelope(t: "snapshot", ch: "show", v: 78, d: try JSONValue(encoding: s)))
        _ = try await c.message("unsub", ch: "scene:scn_desk")
        _ = try await c.message("sub", ch: "scene:scn_tour")
        hub.stop()
    }

    @Test func agentAndCalibrationChannels() async throws {
        let (hub, c, _) = try await online()
        c.push(Envelope(t: "event", ch: "agent:agt_3", d: try Fixtures.json("agent-event")))
        try await eventually { hub.agentEvents["agt_3"]?.first?.tool == "surface_create" }
        c.push(Envelope(t: "progress", ch: "calib:cal_1", d: ["step": "patterns", "done": 14, "total": 22, "message": "gray code"]))
        try await eventually { hub.calibration["cal_1"]?.done == 14 }
        hub.stop()
    }

    @Test func demoAppliesLocally() async throws {
        let (hub, _, db) = try makeHub()
        try db.saveShow(show())
        try db.saveSceneSnapshot(Fixtures.json("scene"), version: 1)
        try db.saveSetup(Fixtures.json("setup"), version: 1)
        hub.startDemo()
        hub.edit(sceneId: "scn_desk", .setLayerField(layerId: "lay_window", field: ["ref"], value: "blinds"))
        #expect(try db.pendingItems().isEmpty)
        #expect(try db.read(Queries.active).scene?.layers("static")[0].ref == "blinds")
        try await hub.command("show.blackout", ["on": true])
        #expect(try db.read(Queries.active).show?.onAir == false)
        try await hub.command("show.go")
        #expect(try db.read(Queries.active).show?.transport.cue == 2)
        hub.edit(sceneId: "scn_desk", .setMode("scenery"))
        #expect(try db.read(Queries.active).scene?.mode == "scenery")
        try await hub.command("setup.testPattern", ["pattern": "grid", "seconds": 60])
        let setup = try #require(try db.read(Queries.active).setup)
        #expect(setup.testPattern == "grid")
        #expect(setup.testPatternRemaining(serverNowMs: hub.serverNowMs) == 59)
    }

    @Test func openingATabSendsAModePatch() async throws {
        let (hub, c, db) = try await online()
        hub.edit(sceneId: "scn_desk", .setMode("objects"))
        #expect(try db.read(Queries.active).scene?.mode == "objects")
        let patch = try await c.message("patch")
        #expect(PatchedMessage(patch.d)?.ops == [.replace("/mode", "objects")])
        // The same mode again sends nothing.
        c.push(Envelope(t: "patched", ch: "scene:scn_desk", re: patch.id, v: 419, d: ["ops": try JSONValue(encoding: [PatchOp.replace("/mode", "objects")]), "by": "dev_7k2"]))
        try await eventually { (try? db.pendingItems().isEmpty) == true }
        hub.edit(sceneId: "scn_desk", .setMode("objects"))
        try await eventually { (try? db.pendingItems().isEmpty) == true }
        #expect(try db.sceneVersion("scn_desk") == 419)
        hub.stop()
    }

    @Test func audioCapListsAndSoundMessages() async throws {
        let (hub, c, db) = try await online()
        let hello = try await c.message("hello")
        #expect(hello.d?["caps"]?.array?.contains("audio") == true)
        for ch in ["scenes", "sounds", "videos"] { _ = try await c.message("sub", ch: ch) }
        var events: [SoundEvent] = []
        hub.onSound = { events.append($0) }
        for raw in try Fixtures.wsMessages() where ["sound.play", "sound.stop"].contains(raw["t"]?.string ?? "") || raw["t"] == "snapshot" && raw["ch"] != nil && raw["ch"]?.string?.hasPrefix("setup") == false {
            c.push(raw)
        }
        try await eventually { events.count == 2 }
        #expect(events[0] == .play(SoundPlay(playId: "ply_k2m9x0aa", sound: "a77c31", padId: "pad_thunder", name: "thunder", volume: 0.9)))
        #expect(events[1] == .stop(SoundStop(padId: "pad_rain")))
        try await eventually { (try? db.read(Queries.sounds).count) == 1 }
        #expect(try db.read(Queries.sounds).first?.name == "rain on glass")
        try await eventually { hub.imports["imp_3k9x0aa1"]?.progress == 0.42 }
        // The scenes channel is the whole list: scn_party arrives, nothing else is dropped while active.
        try await eventually { (try? db.read(Queries.scenes).map(\.id)) == ["scn_desk", "scn_party"] }
        hub.stop()
    }

    @Test func soundCommandsGoOutAsCmd() async throws {
        let (hub, c, _) = try await online()
        Task { try? await hub.playPad("pad_thunder") }
        let cmd = try await c.message("cmd")
        #expect(cmd.d?["name"] == "sound.play" && cmd.d?["args"]?["padId"] == "pad_thunder")
        c.push(Envelope(t: "ack", re: cmd.id, d: ["playId": "ply_1", "outputs": 1]))
        Task { try? await hub.setAudio(output: "phone", volume: 0.5) }
        let audio = try await c.message("cmd", skipping: 1)
        #expect(audio.d?["name"] == "show.audio" && audio.d?["args"] == ["output": "phone", "volume": 0.5])
        hub.stop()
    }

    @Test func demoSoundboardTogglesLoopsAndPlaysOnThePhone() async throws {
        let (hub, _, db) = try makeHub()
        var show = try show()
        show.audio = ShowAudio(output: "phone")
        try db.saveShow(show)
        try db.saveSceneSnapshot(Fixtures.json("scene"), version: 1)
        hub.startDemo()
        var events: [SoundEvent] = []
        hub.onSound = { events.append($0) }
        try await hub.playPad("pad_rain")
        #expect(try db.read(Queries.active).show?.audio.loops == ["pad_rain"])
        let again = try await hub.playPad("pad_rain")
        #expect(again?["stopped"] == true)
        #expect(try db.read(Queries.active).show?.audio.loops == [])
        #expect(events.count == 2)
        if case .play(let p) = events[0] { #expect(p.loop && p.sound == "5d1e0a" && abs(p.volume - 0.6) < 1e-9) } else { Issue.record("expected play") }
        #expect(events[1] == .stop(SoundStop(padId: "pad_rain")))
        // GO on cue 1 fires its cue sound.
        try await hub.command("show.stop")
        try await hub.command("show.go")
        if case .play(let p) = events.last { #expect(p.cueId == "cue_1" && p.sound == "a77c31") } else { Issue.record("expected the cue sound") }
        // Projector output: the phone stays silent.
        try await hub.setAudio(output: "projector", muted: true)
        let n = events.count
        try await hub.playPad("pad_thunder")
        #expect(events.count == n)
        #expect(try db.read(Queries.active).show?.audio.muted == true)
        // Scenes: create, duplicate, rename, delete; the active one stays.
        let id = try await hub.createScene(name: "party")
        let dup = try await hub.createScene(name: "desk copy", duplicate: "scn_desk")
        try await hub.renameScene(id, name: "after party")
        #expect(try db.read(Queries.scenes).first { $0.id == id }?.name == "after party")
        #expect(try db.sceneDoc(dup)?["sounds"]?["pads"]?.array?.count == 2)
        try await hub.deleteScene(id)
        #expect(try db.read(Queries.scenes).contains { $0.id == id } == false)
        await #expect(throws: WireError.self) { try await hub.deleteScene("scn_desk") }
    }
}
