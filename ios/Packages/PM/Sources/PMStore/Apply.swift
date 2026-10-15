import Foundation
import GRDB
import PMKit

/// Writes that come from the server (snapshots, patches, params) and the local optimistic layer on top of them.
extension AppDatabase {
    // MARK: Show, catalog, lists

    public func saveShow(_ show: Show) throws {
        try writer.write { db in try KV.set(db, KV.show, try JSONValue(encoding: show).jsonText) }
    }

    /// Stores the catalog bytes as received (the order of params matters, see `Catalog.decode`).
    public func saveCatalog(_ data: Data, version: Int) throws {
        try writer.write { db in
            try KV.set(db, KV.catalog, String(decoding: data, as: UTF8.self))
            try KV.set(db, KV.catalogVersion, String(version))
        }
    }

    public func catalogVersion() throws -> Int? {
        try reader.read { db in try KV.get(db, KV.catalogVersion).flatMap(Int.init) }
    }

    /// The sound library (`sounds` channel or `GET /sounds`), newest first.
    public func saveSounds(_ list: [Asset]) throws {
        try writer.write { db in try KV.set(db, KV.sounds, try JSONValue(encoding: list).jsonText) }
    }

    /// The video library (`videos` channel or `GET /videos`), newest first.
    public func saveVideos(_ list: [Video]) throws {
        try writer.write { db in try KV.set(db, KV.videos, try JSONValue(encoding: list).jsonText) }
    }

    /// Renames a cached scene at once (its summary and both documents), before the server confirms.
    public func renameScene(_ id: String, name: String) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE scene SET name = ? WHERE id = ?", arguments: [name, id])
            for col in ["confirmed", "doc"] {
                guard let doc = JSONValue.parse(try String.fetchOne(db, sql: "SELECT \(col) FROM scene WHERE id = ?", arguments: [id])),
                      let next = try? doc.applying(.replace("/name", .string(name))) else { continue }
                try db.execute(sql: "UPDATE scene SET \(col) = ? WHERE id = ?", arguments: [next.jsonText, id])
            }
        }
    }

    /// Forgets a scene (deleted on the server).
    public func removeScene(_ id: String) throws {
        try writer.write { db in try db.execute(sql: "DELETE FROM scene WHERE id = ?", arguments: [id]) }
    }

    /// The scene list from `GET /scenes` or the `scenes` channel; keeps documents already cached. With `prune`, scenes
    /// missing from the list go even when a document is cached (the channel is the whole truth), except `keep`.
    public func saveSceneList(_ list: [SceneSummary], prune: Bool = false, keep: String? = nil) throws {
        try saveSceneListRows(list)
        guard prune, !list.isEmpty else { return }
        try writer.write { db in
            let ids = list.map(\.id) + [keep].compactMap { $0 }
            let marks = ids.map { _ in "?" }.joined(separator: ",")
            try db.execute(sql: "DELETE FROM scene WHERE id NOT IN (\(marks))", arguments: StatementArguments(ids))
        }
    }

    private func saveSceneListRows(_ list: [SceneSummary]) throws {
        try writer.write { db in
            let ids = list.map(\.id)
            for (n, s) in list.enumerated() {
                try db.execute(sql: """
                    INSERT INTO scene (id, setupId, name, version, sort, kind, mode) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET setupId = excluded.setupId, name = excluded.name, sort = excluded.sort,
                        kind = excluded.kind, mode = excluded.mode
                    """, arguments: [s.id, s.setupId, s.name, s.version, n, s.kind, s.mode])
            }
            if !ids.isEmpty {
                let marks = ids.map { _ in "?" }.joined(separator: ",")
                try db.execute(sql: "DELETE FROM scene WHERE id NOT IN (\(marks)) AND doc IS NULL", arguments: StatementArguments(ids))
            }
        }
    }

    public func savePresets(_ presets: [Preset]) throws {
        try writer.write { db in
            try db.execute(sql: "DELETE FROM preset WHERE pending = 0")
            for (n, p) in presets.enumerated() {
                try db.execute(sql: "INSERT OR REPLACE INTO preset (id, name, mode, doc, pending, sort) VALUES (?, ?, ?, ?, 0, ?)",
                               arguments: [p.id, p.name, p.mode, try JSONValue(encoding: p).jsonText, n])
            }
        }
    }

    /// A preset saved on this phone that the server has not confirmed yet.
    public func addPendingPreset(_ p: Preset) throws {
        try writer.write { db in
            let sort = (try Int.fetchOne(db, sql: "SELECT MAX(sort) FROM preset") ?? 0) + 1
            try db.execute(sql: "INSERT OR REPLACE INTO preset (id, name, mode, doc, pending, sort) VALUES (?, ?, ?, ?, 1, ?)",
                           arguments: [p.id, p.name, p.mode, try JSONValue(encoding: p).jsonText, sort])
        }
    }

    public func removePreset(_ id: String) throws {
        try writer.write { db in try db.execute(sql: "DELETE FROM preset WHERE id = ?", arguments: [id]) }
    }

    public func saveDevices(_ devices: [Device]) throws {
        try writer.write { db in
            try db.execute(sql: "DELETE FROM device")
            for (n, d) in devices.enumerated() {
                try db.execute(sql: "INSERT INTO device (id, doc, sort) VALUES (?, ?, ?)", arguments: [d.id, try JSONValue(encoding: d).jsonText, n])
            }
        }
    }

    // MARK: Setups

    public func saveSetup(_ doc: JSONValue, version: Int) throws {
        guard let id = doc["id"]?.string else { return }
        try writer.write { db in
            try db.execute(sql: "INSERT OR REPLACE INTO setup (id, version, doc) VALUES (?, ?, ?)", arguments: [id, version, doc.jsonText])
        }
    }

    public func applySetupPatch(_ id: String, ops: [PatchOp], version: Int?) throws {
        try writer.write { db in
            guard let doc = JSONValue.parse(try String.fetchOne(db, sql: "SELECT doc FROM setup WHERE id = ?", arguments: [id])),
                  let next = try? doc.applying(ops) else { return }
            try db.execute(sql: "UPDATE setup SET doc = ?, version = COALESCE(?, version) WHERE id = ?", arguments: [next.jsonText, version, id])
        }
    }

    // MARK: Scenes

    /// A full scene from the server (`snapshot`). Pending edits are replayed on top.
    public func saveSceneSnapshot(_ doc: JSONValue, version: Int) throws {
        guard let id = doc["id"]?.string else { return }
        try writer.write { db in
            var confirmed = doc
            if case .object(var o) = confirmed { o["version"] = .number(Double(version)); confirmed = .object(o) }
            try db.execute(sql: """
                INSERT INTO scene (id, setupId, name, version, confirmed, doc) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET setupId = excluded.setupId, name = excluded.name, version = excluded.version,
                    confirmed = excluded.confirmed
                """, arguments: [id, doc["setupId"]?.string ?? "", doc["name"]?.string ?? "", version, confirmed.jsonText, confirmed.jsonText])
            try Self.rebuild(db, sceneId: id)
        }
    }

    /// Keeps the list's kind and mode in step with a scene document (snapshots and patches change them).
    static func syncKind(_ db: Database, sceneId: String, doc: JSONValue) throws {
        guard let scene = try? doc.decode(Scene.self) else { return }
        try db.execute(sql: "UPDATE scene SET kind = ?, mode = ? WHERE id = ?", arguments: [scene.kind, scene.mode, sceneId])
    }

    /// A committed patch (`patched`). Returns false when this copy is behind and needs a new snapshot.
    @discardableResult
    public func applyScenePatch(_ id: String, ops: [PatchOp], version: Int, ack clientId: String? = nil) throws -> Bool {
        try writer.write { db in
            if let clientId { try db.execute(sql: "DELETE FROM outbox WHERE clientId = ?", arguments: [clientId]) }
            guard let row = try Row.fetchOne(db, sql: "SELECT version, confirmed FROM scene WHERE id = ?", arguments: [id]),
                  let confirmed = JSONValue.parse(row["confirmed"]) else { return false }
            let have: Int = row["version"]
            if version <= have {  // already have it (our own echo after a snapshot)
                try Self.rebuild(db, sceneId: id)
                return true
            }
            guard version == have + 1, var next = try? confirmed.applying(ops) else {
                try Self.rebuild(db, sceneId: id)
                return false
            }
            if case .object(var o) = next { o["version"] = .number(Double(version)); next = .object(o) }
            try db.execute(sql: "UPDATE scene SET confirmed = ?, version = ?, name = ? WHERE id = ?",
                           arguments: [next.jsonText, version, next["name"]?.string ?? "", id])
            try Self.rebuild(db, sceneId: id)
            return true
        }
    }

    /// A live value (`param`): last writer wins, applied to the confirmed and the shown document at once.
    public func applyParam(channel: String, path: String, value: JSONValue) throws {
        let (kind, id) = Channel.split(channel)
        guard let id else { return }
        let op = PatchOp.replace(path, value)
        try writer.write { db in
            switch kind {
            case "scene":
                guard let row = try Row.fetchOne(db, sql: "SELECT confirmed, doc FROM scene WHERE id = ?", arguments: [id]) else { return }
                let confirmed = JSONValue.parse(row["confirmed"]).flatMap { try? $0.applying(op) }
                let doc = JSONValue.parse(row["doc"]).flatMap { try? $0.applying(op) }
                try db.execute(sql: "UPDATE scene SET confirmed = COALESCE(?, confirmed), doc = COALESCE(?, doc) WHERE id = ?",
                               arguments: [confirmed?.jsonText, doc?.jsonText, id])
            case "setup":
                guard let doc = JSONValue.parse(try String.fetchOne(db, sql: "SELECT doc FROM setup WHERE id = ?", arguments: [id])),
                      let next = try? doc.applying(op) else { return }
                try db.execute(sql: "UPDATE setup SET doc = ? WHERE id = ?", arguments: [next.jsonText, id])
            default:
                return
            }
        }
    }

    public func sceneVersion(_ id: String) throws -> Int? {
        try reader.read { db in try Int.fetchOne(db, sql: "SELECT version FROM scene WHERE id = ? AND confirmed IS NOT NULL", arguments: [id]) }
    }

    public func confirmedScene(_ id: String) throws -> JSONValue? {
        try reader.read { db in JSONValue.parse(try String.fetchOne(db, sql: "SELECT confirmed FROM scene WHERE id = ?", arguments: [id])) }
    }

    public func sceneDoc(_ id: String) throws -> JSONValue? {
        try reader.read { db in JSONValue.parse(try String.fetchOne(db, sql: "SELECT doc FROM scene WHERE id = ?", arguments: [id])) }
    }

    /// The shown document = the confirmed one with every queued intent replayed on it, in order. Intents that no
    /// longer apply (their layer is gone) are dropped from the outbox.
    static func rebuild(_ db: Database, sceneId: String) throws {
        guard var doc = JSONValue.parse(try String.fetchOne(db, sql: "SELECT confirmed FROM scene WHERE id = ?", arguments: [sceneId])) else { return }
        let rows = try Row.fetchAll(db, sql: "SELECT clientId, intent FROM outbox WHERE target = ? ORDER BY seq", arguments: [Channel.scene(sceneId)])
        for row in rows {
            let clientId: String = row["clientId"]
            guard let intent = try? JSONDecoder().decode(SceneIntent.self, from: Data((row["intent"] as String).utf8)),
                  let ops = intent.ops(on: doc), let next = try? doc.applying(ops) else {
                try db.execute(sql: "DELETE FROM outbox WHERE clientId = ?", arguments: [clientId])
                continue
            }
            doc = next
        }
        try db.execute(sql: "UPDATE scene SET doc = ? WHERE id = ?", arguments: [doc.jsonText, sceneId])
        try syncKind(db, sceneId: sceneId, doc: doc)
    }
}
