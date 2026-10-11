import Foundation
@_exported import GRDB
import PMKit

/// The phone's copy of the server: show, setups, scenes (confirmed document + version, and the document with this
/// phone's pending edits on top), presets, catalog, devices and the outbox. Screens read only from here.
public final class AppDatabase: Sendable {
    public let writer: any DatabaseWriter
    public var reader: any DatabaseReader { writer }

    public init(_ writer: any DatabaseWriter) throws {
        self.writer = writer
        try Self.migrator.migrate(writer)
    }

    public static func open(directory: URL) throws -> AppDatabase {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var config = Configuration()
        config.label = "projmap"
        let pool = try DatabasePool(path: directory.appendingPathComponent("projmap.sqlite").path, configuration: config)
        return try AppDatabase(pool)
    }

    public static func inMemory() throws -> AppDatabase {
        try AppDatabase(DatabaseQueue(configuration: Configuration()))
    }

    public static var defaultDirectory: URL {
        URL.applicationSupportDirectory.appendingPathComponent("projmap", isDirectory: true)
    }

    static var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("001_cache") { db in
            try db.execute(sql: """
                CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE scene (
                    id TEXT PRIMARY KEY, setupId TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
                    version INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
                    confirmed TEXT, doc TEXT);
                CREATE TABLE setup (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, doc TEXT NOT NULL);
                CREATE TABLE preset (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL, doc TEXT NOT NULL,
                    pending INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE device (id TEXT PRIMARY KEY, doc TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE outbox (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, clientId TEXT NOT NULL UNIQUE, target TEXT NOT NULL,
                    intent TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', createdAt DOUBLE NOT NULL);
                """)
        }
        return m
    }

    /// Forgets everything from the server (unpair, another server).
    public func wipe() throws {
        try writer.write { db in
            for t in ["kv", "scene", "setup", "preset", "device", "outbox"] { try db.execute(sql: "DELETE FROM \(t)") }
        }
    }
}

// MARK: - Key/value

enum KV {
    static let show = "show", catalog = "catalog", catalogVersion = "catalogVersion"

    static func get(_ db: Database, _ key: String) throws -> String? {
        try String.fetchOne(db, sql: "SELECT value FROM kv WHERE key = ?", arguments: [key])
    }

    static func set(_ db: Database, _ key: String, _ value: String?) throws {
        if let value {
            try db.execute(sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                           arguments: [key, value])
        } else {
            try db.execute(sql: "DELETE FROM kv WHERE key = ?", arguments: [key])
        }
    }
}

extension JSONValue {
    static func parse(_ text: String?) -> JSONValue? {
        guard let text else { return nil }
        return try? JSONValue(jsonText: text)
    }
}
