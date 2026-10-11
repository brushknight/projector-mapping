import Foundation

/// One RFC 6902 operation: `{ "op": "replace", "path": "/backdrop/layers/0/light/intensity", "value": 0.62 }`.
public struct PatchOp: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable { case add, remove, replace, move, copy, test }
    public var op: Kind
    public var path: String
    public var from: String?
    public var value: JSONValue?

    public init(_ op: Kind, _ path: String, value: JSONValue? = nil, from: String? = nil) {
        self.op = op
        self.path = path
        self.value = value
        self.from = from
    }

    public static func replace(_ path: String, _ value: JSONValue) -> PatchOp { PatchOp(.replace, path, value: value) }
    public static func add(_ path: String, _ value: JSONValue) -> PatchOp { PatchOp(.add, path, value: value) }
    public static func remove(_ path: String) -> PatchOp { PatchOp(.remove, path) }
    public static func move(from: String, to path: String) -> PatchOp { PatchOp(.move, path, from: from) }

    /// True when the op only sets an existing leaf (the server accepts those at any base version).
    public var isLeafReplace: Bool {
        guard op == .replace, let value else { return false }
        switch value {
        case .object, .array: return false
        default: return true
        }
    }
}

public enum JSONPatchError: Error, Equatable, Sendable {
    case badPointer(String)
    case missing(String)
    case notContainer(String)
    case indexOutOfRange(String)
    case testFailed(String)
    case missingValue(String)
}

/// JSON Pointer (RFC 6901) helpers.
public enum JSONPointer {
    public static func tokens(_ pointer: String) throws -> [String] {
        if pointer.isEmpty { return [] }
        guard pointer.hasPrefix("/") else { throw JSONPatchError.badPointer(pointer) }
        return pointer.dropFirst().split(separator: "/", omittingEmptySubsequences: false).map {
            $0.replacingOccurrences(of: "~1", with: "/").replacingOccurrences(of: "~0", with: "~")
        }
    }

    public static func escape(_ token: String) -> String {
        token.replacingOccurrences(of: "~", with: "~0").replacingOccurrences(of: "/", with: "~1")
    }

    public static func join(_ tokens: [String]) -> String {
        tokens.map { "/" + escape($0) }.joined()
    }
}

extension JSONValue {
    /// The value at a JSON Pointer, or nil.
    public func value(at pointer: String) -> JSONValue? {
        guard let tokens = try? JSONPointer.tokens(pointer) else { return nil }
        var cur = self
        for t in tokens {
            switch cur {
            case .object(let o):
                guard let next = o[t] else { return nil }
                cur = next
            case .array(let a):
                guard let i = Int(t), a.indices.contains(i) else { return nil }
                cur = a[i]
            default:
                return nil
            }
        }
        return cur
    }

    /// Applies a JSON Patch; throws (and changes nothing) when an op does not fit.
    public func applying(_ ops: [PatchOp]) throws -> JSONValue {
        var doc = self
        for op in ops { doc = try doc.applying(op) }
        return doc
    }

    public func applying(_ op: PatchOp) throws -> JSONValue {
        let tokens = try JSONPointer.tokens(op.path)
        switch op.op {
        case .add:
            guard let v = op.value else { throw JSONPatchError.missingValue(op.path) }
            return try Self.edit(self, tokens[...], path: op.path, mode: .add(v))
        case .replace:
            guard let v = op.value else { throw JSONPatchError.missingValue(op.path) }
            if tokens.isEmpty { return v }
            return try Self.edit(self, tokens[...], path: op.path, mode: .replace(v))
        case .remove:
            return try Self.edit(self, tokens[...], path: op.path, mode: .remove)
        case .move:
            guard let from = op.from, let v = value(at: from) else { throw JSONPatchError.missing(op.from ?? "") }
            let removed = try applying(.remove(from))
            return try removed.applying(.add(op.path, v))
        case .copy:
            guard let from = op.from, let v = value(at: from) else { throw JSONPatchError.missing(op.from ?? "") }
            return try applying(.add(op.path, v))
        case .test:
            guard value(at: op.path) == op.value else { throw JSONPatchError.testFailed(op.path) }
            return self
        }
    }

    private enum Mode { case add(JSONValue), replace(JSONValue), remove }

    private static func edit(_ node: JSONValue, _ tokens: ArraySlice<String>, path: String, mode: Mode) throws -> JSONValue {
        guard let head = tokens.first else {
            if case .add(let v) = mode { return v }
            throw JSONPatchError.badPointer(path)
        }
        let rest = tokens.dropFirst()
        switch node {
        case .object(var o):
            if rest.isEmpty {
                switch mode {
                case .add(let v): o[head] = v
                case .replace(let v):
                    guard o[head] != nil else { throw JSONPatchError.missing(path) }
                    o[head] = v
                case .remove:
                    guard o.removeValue(forKey: head) != nil else { throw JSONPatchError.missing(path) }
                }
                return .object(o)
            }
            guard let child = o[head] else { throw JSONPatchError.missing(path) }
            o[head] = try edit(child, rest, path: path, mode: mode)
            return .object(o)
        case .array(var a):
            if rest.isEmpty {
                switch mode {
                case .add(let v):
                    if head == "-" { a.append(v); return .array(a) }
                    guard let i = Int(head), i >= 0, i <= a.count else { throw JSONPatchError.indexOutOfRange(path) }
                    a.insert(v, at: i)
                case .replace(let v):
                    guard let i = Int(head), a.indices.contains(i) else { throw JSONPatchError.indexOutOfRange(path) }
                    a[i] = v
                case .remove:
                    guard let i = Int(head), a.indices.contains(i) else { throw JSONPatchError.indexOutOfRange(path) }
                    a.remove(at: i)
                }
                return .array(a)
            }
            guard let i = Int(head), a.indices.contains(i) else { throw JSONPatchError.indexOutOfRange(path) }
            a[i] = try edit(a[i], rest, path: path, mode: mode)
            return .array(a)
        default:
            throw JSONPatchError.notContainer(path)
        }
    }
}
