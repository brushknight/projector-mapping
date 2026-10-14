import Foundation
import GRDB
import PMKit

/// What a tab needs about what is on the wall: the show, the active scene (with this phone's pending edits) and its
/// setup.
public struct ActiveState: Sendable, Equatable {
    public var show: Show?
    public var scene: Scene?
    public var sceneDoc: JSONValue?
    public var setup: Setup?
    public var pending: Int

    public init(show: Show? = nil, scene: Scene? = nil, sceneDoc: JSONValue? = nil, setup: Setup? = nil, pending: Int = 0) {
        self.show = show; self.scene = scene; self.sceneDoc = sceneDoc; self.setup = setup; self.pending = pending
    }

    public var onAir: Bool { show?.onAir ?? false }
}

/// Read queries. Each is a GRDB `ValueObservation`: screens subscribe and redraw when the database changes.
public enum Queries {
    public static func show(_ db: Database) throws -> Show? {
        JSONValue.parse(try KV.get(db, KV.show)).flatMap { try? $0.decode(Show.self) }
    }

    public static func active(_ db: Database) throws -> ActiveState {
        let show = try show(db)
        var state = ActiveState(show: show)
        let sceneId = try show?.activeSceneId ?? (String.fetchOne(db, sql: "SELECT id FROM scene WHERE doc IS NOT NULL ORDER BY sort LIMIT 1"))
        if let sceneId, let doc = JSONValue.parse(try String.fetchOne(db, sql: "SELECT doc FROM scene WHERE id = ?", arguments: [sceneId])) {
            state.sceneDoc = doc
            state.scene = try? doc.decode(Scene.self)
        }
        let setupId = show?.activeSetupId ?? state.scene?.setupId
        if let setupId {
            state.setup = JSONValue.parse(try String.fetchOne(db, sql: "SELECT doc FROM setup WHERE id = ?", arguments: [setupId]))
                .flatMap { try? $0.decode(Setup.self) }
        }
        state.pending = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM outbox") ?? 0
        return state
    }

    public static func catalog(_ db: Database) throws -> Catalog {
        guard let text = try KV.get(db, KV.catalog), let cat = try? Catalog.decode(Data(text.utf8)) else { return .empty }
        return cat
    }

    public static func scenes(_ db: Database) throws -> [SceneSummary] {
        try Row.fetchAll(db, sql: "SELECT id, name, setupId, version FROM scene ORDER BY sort, name").map {
            SceneSummary(id: $0["id"], name: $0["name"], setupId: $0["setupId"], version: $0["version"])
        }
    }

    public static func sounds(_ db: Database) throws -> [Asset] {
        JSONValue.parse(try KV.get(db, KV.sounds)).flatMap { try? $0.decode([Asset].self) } ?? []
    }

    public static func videos(_ db: Database) throws -> [Video] {
        JSONValue.parse(try KV.get(db, KV.videos)).flatMap { try? $0.decode([Video].self) } ?? []
    }

    public static func presets(_ db: Database, mode: String) throws -> [Preset] {
        try String.fetchAll(db, sql: "SELECT doc FROM preset WHERE mode = ? ORDER BY sort", arguments: [mode])
            .compactMap { JSONValue.parse($0).flatMap { try? $0.decode(Preset.self) } }
    }

    public static func allPresets(_ db: Database) throws -> [Preset] {
        try String.fetchAll(db, sql: "SELECT doc FROM preset ORDER BY sort")
            .compactMap { JSONValue.parse($0).flatMap { try? $0.decode(Preset.self) } }
    }

    public static func devices(_ db: Database) throws -> [Device] {
        try String.fetchAll(db, sql: "SELECT doc FROM device ORDER BY sort")
            .compactMap { JSONValue.parse($0).flatMap { try? $0.decode(Device.self) } }
    }
}

extension AppDatabase {
    public func observeActive() -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<ActiveState>>> {
        ValueObservation.tracking(Queries.active).removeDuplicates()
    }

    public func observeCatalog() -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<Catalog>>> {
        ValueObservation.tracking(Queries.catalog).removeDuplicates()
    }

    public func observeScenes() -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<[SceneSummary]>>> {
        ValueObservation.tracking(Queries.scenes).removeDuplicates()
    }

    public func observeSounds() -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<[Asset]>>> {
        ValueObservation.tracking(Queries.sounds).removeDuplicates()
    }

    public func observeVideos() -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<[Video]>>> {
        ValueObservation.tracking(Queries.videos).removeDuplicates()
    }

    public func observePresets(mode: String) -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<[Preset]>>> {
        ValueObservation.tracking { try Queries.presets($0, mode: mode) }.removeDuplicates()
    }

    public func observeAllPresets() -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<[Preset]>>> {
        ValueObservation.tracking(Queries.allPresets).removeDuplicates()
    }

    public func observeDevices() -> ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<[Device]>>> {
        ValueObservation.tracking(Queries.devices).removeDuplicates()
    }

    /// Async sequence of a query's values, for `.task { for try await v in db.values(…) { … } }`.
    public func values<T: Sendable>(_ observation: ValueObservation<ValueReducers.RemoveDuplicates<ValueReducers.Fetch<T>>>) -> AsyncValueObservation<T> {
        observation.values(in: reader)
    }

    public func read<T: Sendable>(_ fetch: @Sendable (Database) throws -> T) throws -> T {
        try reader.read(fetch)
    }
}
