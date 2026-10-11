import Foundation
import PMKit

/// The shared contract (`contract/` at the repository root): every client decodes every fixture.
public enum Fixtures {
    public static let root: URL = {
        var u = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { u.deleteLastPathComponent() }
        return u
    }()

    public static var directory: URL { root.appendingPathComponent("contract/fixtures") }
    public static var catalogURL: URL { root.appendingPathComponent("contract/catalog.json") }

    public static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(name.hasSuffix(".json") ? name : name + ".json"))
    }

    public static func json(_ name: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: data(name))
    }

    public static func all() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    public static func wsMessages() throws -> [JSONValue] {
        try json("ws-messages").array ?? []
    }
}
