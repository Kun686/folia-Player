import Foundation

// NativeGatewayStore.swift — one Keychain transaction for the endpoint and its separately keyed platform sessions.
struct NativeGatewayRecord: Codable {
    var version = 1
    var scope = UUID().uuidString
    var server = ""
    var token = ""
    var sessions: [String: [String: String]] = [:]
    // Optional for older Keychain records. Unlike gateway scope, this changes on account replacement/logout.
    var sessionGeneration: String?
    var publicValues: [String: Any] { ["server": server, "scope": scope, "sessions": sessions] }
    func validate() throws {
        guard version == 1, UUID(uuidString: scope) != nil,
              sessionGeneration == nil || UUID(uuidString: sessionGeneration!) != nil,
              Set(sessions.keys).isSubset(of: Set(NativeGatewayStore.providers)),
              sessions.values.allSatisfy({ $0.count <= 16 && $0.values.allSatisfy({ $0.count <= 24000 }) }),
              token.isEmpty || NativeGatewayStore.validToken(token),
              server.isEmpty == token.isEmpty else { throw MobileFailure("secure-storage") }
        if !server.isEmpty {
            guard try GatewayClient.validatedServer(server) == server else { throw MobileFailure("secure-storage") }
        }
    }
    func dictionary() throws -> [String: Any] {
        guard let result = try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as? [String: Any] else {
            throw MobileFailure("secure-storage")
        }
        return result
    }
}

final class NativeGatewayStore {
    static let shared = NativeGatewayStore()
    static let providers = ["netease", "qq", "kugou"]
    private let lock = NSLock()
    private let read: (String) throws -> [String: Any]
    private let write: (String, [String: Any]) throws -> Void
    private let remove: (String) throws -> Void
    private var legacyCleaned = false
    private static let key = "gateway.credentials"
    static func validToken(_ token: String) -> Bool {
        (32...4096).contains(token.count) && !token.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    }
    init(read: @escaping (String) throws -> [String: Any] = SecureStore.read,
         write: @escaping (String, [String: Any]) throws -> Void = SecureStore.write,
         remove: @escaping (String) throws -> Void = SecureStore.remove) {
        self.read = read; self.write = write; self.remove = remove
    }
    func snapshot() throws -> NativeGatewayRecord {
        lock.lock(); defer { lock.unlock() }; return try load()
    }
    func configure(server raw: String, token: String, expected: String) throws -> NativeGatewayRecord {
        // Validate before migration or any playback/account mutation.
        let server = try GatewayClient.validatedServer(raw)
        guard Self.validToken(token) else {
            throw MobileFailure("invalid-token")
        }
        lock.lock(); defer { lock.unlock() }
        var record = try load()
        guard record.scope == expected else { throw MobileFailure("gateway-settings-changed") }
        if record.server == server && record.token == token { return record }
        if record.server != server { record.sessions = [:] }
        record.server = server; record.token = token; record.scope = UUID().uuidString
        try write(Self.key, record.dictionary())
        return record
    }
    func saveSession(_ provider: String, values: [String: String], expected: String) throws -> NativeGatewayRecord {
        guard Self.providers.contains(provider), values.count <= 16,
              values.values.allSatisfy({ $0.count <= 24000 }) else { throw MobileFailure("invalid-session") }
        lock.lock(); defer { lock.unlock() }
        var record = try load()
        guard record.scope == expected else { throw MobileFailure("gateway-settings-changed") }
        if record.sessions[provider] != values { record.sessionGeneration = UUID().uuidString }
        record.sessions[provider] = values
        try write(Self.key, record.dictionary())
        return record
    }
    func clearSession(_ provider: String, expected: String) throws {
        guard Self.providers.contains(provider) else { throw MobileFailure("invalid-provider") }
        lock.lock(); defer { lock.unlock() }
        var record = try load()
        guard record.scope == expected else { throw MobileFailure("gateway-settings-changed") }
        record.sessions.removeValue(forKey: provider)
        record.sessionGeneration = UUID().uuidString
        try write(Self.key, record.dictionary())
    }
    // The consolidated copy is durable before any legacy item is deleted. Interrupted cleanup retries
    // from that copy, never reimports partially deleted data, and never exposes a mixed configuration.
    private func load() throws -> NativeGatewayRecord {
        let value = try read(Self.key)
        let record: NativeGatewayRecord
        if value.isEmpty {
            let gateway = try read("gateway")
            var migrated = NativeGatewayRecord()
            migrated.server = gateway["server"] as? String ?? ""
            if !migrated.server.isEmpty { migrated.server = try GatewayClient.validatedServer(migrated.server) }
            migrated.token = gateway["token"] as? String ?? ""
            for provider in Self.providers {
                let old = try read("session." + provider)
                guard let session = old as? [String: String] else { throw MobileFailure("secure-storage") }
                migrated.sessions[provider] = session
            }
            try migrated.validate()
            try write(Self.key, migrated.dictionary())
            record = migrated
        } else {
            do { record = try JSONDecoder().decode(NativeGatewayRecord.self, from: JSONSerialization.data(withJSONObject: value)) }
            catch { throw MobileFailure("secure-storage") }
            try record.validate()
        }
        if !legacyCleaned {
            for key in ["gateway"] + Self.providers.map({ "session." + $0 }) { try remove(key) }
            legacyCleaned = true
        }
        return record
    }
}
