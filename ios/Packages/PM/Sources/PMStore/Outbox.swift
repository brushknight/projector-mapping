import Foundation
import GRDB
import PMKit

/// A REST write that waits in the outbox while the server is away.
public enum RestIntent: Codable, Sendable, Hashable {
    /// `POST /presets`; `tempId` is the optimistic row shown until the server's list arrives.
    case createPreset(name: String, mode: String, sceneId: String, tempId: String)
    case deletePreset(id: String)
}

public struct OutboxItem: Sendable, Hashable {
    public var clientId: String
    public var target: String
    public var scene: SceneIntent?
    public var rest: RestIntent?
}

/// Structural edits made on this phone, in order. A scene intent is applied to the shown document at once and sent
/// as `patch` when the hub is connected; the server's `patched` (with `re` = clientId) retires it.
extension AppDatabase {
    public static let restTarget = "rest"

    /// Queues `intent` for the scene and shows it right away. Returns the client message id.
    @discardableResult
    public func enqueue(sceneId: String, _ intent: SceneIntent, clientId: String = AppDatabase.newClientId()) throws -> String {
        try writer.write { db in
            try db.execute(sql: "INSERT INTO outbox (clientId, target, intent, createdAt) VALUES (?, ?, ?, ?)",
                           arguments: [clientId, Channel.scene(sceneId), String(decoding: try JSONEncoder().encode(intent), as: UTF8.self),
                                       Date().timeIntervalSince1970])
            try Self.rebuild(db, sceneId: sceneId)
        }
        return clientId
    }

    @discardableResult
    public func enqueue(_ intent: RestIntent, clientId: String = AppDatabase.newClientId()) throws -> String {
        try writer.write { db in
            try db.execute(sql: "INSERT INTO outbox (clientId, target, intent, createdAt) VALUES (?, ?, ?, ?)",
                           arguments: [clientId, Self.restTarget, String(decoding: try JSONEncoder().encode(intent), as: UTF8.self),
                                       Date().timeIntervalSince1970])
        }
        return clientId
    }

    /// The oldest queued item per target that has nothing in flight (one patch per scene at a time keeps bases right).
    public func sendable() throws -> [OutboxItem] {
        try reader.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT o.clientId, o.target, o.intent FROM outbox o
                WHERE o.state = 'queued'
                  AND NOT EXISTS (SELECT 1 FROM outbox s WHERE s.target = o.target AND s.state = 'sent')
                  AND o.seq = (SELECT MIN(seq) FROM outbox m WHERE m.target = o.target AND m.state = 'queued')
                ORDER BY o.seq
                """)
            return rows.map(Self.item)
        }
    }

    public func pendingItems() throws -> [OutboxItem] {
        try reader.read { db in try Row.fetchAll(db, sql: "SELECT clientId, target, intent FROM outbox ORDER BY seq").map(Self.item) }
    }

    static func item(_ row: Row) -> OutboxItem {
        let target: String = row["target"]
        let data = Data((row["intent"] as String).utf8)
        if target == restTarget {
            return OutboxItem(clientId: row["clientId"], target: target, scene: nil, rest: try? JSONDecoder().decode(RestIntent.self, from: data))
        }
        return OutboxItem(clientId: row["clientId"], target: target, scene: try? JSONDecoder().decode(SceneIntent.self, from: data), rest: nil)
    }

    public func markSent(_ clientId: String) throws {
        try writer.write { db in try db.execute(sql: "UPDATE outbox SET state = 'sent' WHERE clientId = ?", arguments: [clientId]) }
    }

    /// After a stale rejection or a reconnect: the item goes back in line (it keeps its place).
    public func markQueued(_ clientId: String) throws {
        try writer.write { db in try db.execute(sql: "UPDATE outbox SET state = 'queued' WHERE clientId = ?", arguments: [clientId]) }
    }

    public func requeueAll() throws {
        try writer.write { db in try db.execute(sql: "UPDATE outbox SET state = 'queued'") }
    }

    /// Drops an item (done, or refused for good) and shows the scene without it.
    public func removeOutbox(_ clientId: String) throws {
        try writer.write { db in
            let target = try String.fetchOne(db, sql: "SELECT target FROM outbox WHERE clientId = ?", arguments: [clientId])
            try db.execute(sql: "DELETE FROM outbox WHERE clientId = ?", arguments: [clientId])
            if let target, case ("scene", let id?) = Channel.split(target) { try Self.rebuild(db, sceneId: id) }
        }
    }

    public func outboxTarget(_ clientId: String) throws -> String? {
        try reader.read { db in try String.fetchOne(db, sql: "SELECT target FROM outbox WHERE clientId = ?", arguments: [clientId]) }
    }

    public static func newClientId() -> String { "c-" + UUID().uuidString.prefix(8).lowercased() }
}
