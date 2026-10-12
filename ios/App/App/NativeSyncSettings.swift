import Foundation

// NativeSyncSettings.swift — optional user-hosted sync has its own Keychain record and server/account-scoped checkpoint identity.
struct NativeSyncSettings: Codable {
    var enabled = false
    var baseURL = ""
    var token = ""
    var scope = UUID().uuidString
    var publicValues: [String: Any] { ["enabled": enabled, "baseURL": baseURL, "hasToken": !token.isEmpty, "scope": scope] }
    private struct Edit: Decodable { let enabled: Bool?; let baseURL: String?; let token: String? }

    static func normalizedURL(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.utf8.count <= 2048, !value.contains(where: { $0.isWhitespace }), !value.contains("\\"),
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              var parts = URLComponents(string: value), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil, parts.port.map({ (1...65535).contains($0) }) ?? true else {
            throw MobileFailure("sync-https-endpoint-required")
        }
        // Reject encoded separators and traversal before appending the fixed API route.
        let path = parts.percentEncodedPath.lowercased()
        guard !["%2f", "%5c", "%25"].contains(where: { path.contains($0) }),
              !parts.path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else {
            throw MobileFailure("sync-https-endpoint-required")
        }
        parts.scheme = "https"; parts.host = host.lowercased()
        if parts.port == 443 { parts.port = nil }
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let result = parts.url?.absoluteString else { throw MobileFailure("sync-https-endpoint-required") }
        return result
    }
    static func validToken(_ value: String) -> Bool {
        value.utf8.count <= 8192 && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
    func editing(_ values: [String: Any]) throws -> Self {
        guard !values.isEmpty, Set(values.keys).isSubset(of: ["enabled", "baseURL", "token"]),
              !values.values.contains(where: { $0 is NSNull }) else { throw MobileFailure("invalid-sync-settings") }
        let edit: Edit
        do { edit = try JSONDecoder().decode(Edit.self, from: JSONSerialization.data(withJSONObject: values)) }
        catch { throw MobileFailure("invalid-sync-settings") }
        var next = self
        if let raw = edit.baseURL {
            next.baseURL = raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : try Self.normalizedURL(raw)
            // A path change may select another tenant even on the same host; it must not inherit that tenant's token.
            if next.baseURL != baseURL { next.token = "" }
        }
        if let token = edit.token {
            guard Self.validToken(token) else { throw MobileFailure("invalid-sync-settings") }
            next.token = token.trimmingCharacters(in: .whitespaces)
        }
        if let enabled = edit.enabled { next.enabled = enabled }
        if (next.baseURL.isEmpty || next.token.isEmpty) && edit.enabled != true { next.enabled = false }
        if next.baseURL != baseURL || next.token != token { next.scope = UUID().uuidString }
        try next.validate()
        return next
    }
    func validate() throws {
        guard UUID(uuidString: scope) != nil, Self.validToken(token),
              !enabled || (!baseURL.isEmpty && !token.isEmpty) else { throw MobileFailure("invalid-sync-settings") }
        if !baseURL.isEmpty { guard try Self.normalizedURL(baseURL) == baseURL else { throw MobileFailure("invalid-sync-settings") } }
    }
    static func read(_ record: [String: Any]) throws -> Self {
        if record.isEmpty { return Self() }
        do {
            let settings = try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: record))
            try settings.validate(); return settings
        } catch { throw MobileFailure("invalid-sync-settings") }
    }
    func record() throws -> [String: Any] {
        guard let record = try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as? [String: Any] else {
            throw MobileFailure("invalid-sync-settings")
        }
        return record
    }
}
