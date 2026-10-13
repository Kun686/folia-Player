import Foundation

// NativeNavidromeSettings.swift — direct Subsonic credentials remain in their own device-only Keychain record.
struct NativeNavidromeSettings: Codable {
    var enabled = false
    var baseURL = ""
    var username = ""
    var password = ""
    var scope = ""
    var publicValues: [String: Any] {
        ["enabled": enabled, "baseURL": baseURL, "username": username, "hasPassword": !password.isEmpty, "scope": scope]
    }
    private struct Edit: Decodable { let enabled: Bool?; let baseURL: String?; let username: String?; let password: String? }
    static func normalizedURL(_ value: String) throws -> String {
        // Share the existing HTTPS/tenant-path validation; only the user-facing error belongs to this service.
        do { return try NativeSyncSettings.normalizedURL(value) }
        catch { throw MobileFailure("navidrome-https-endpoint-required") }
    }
    private static func validText(_ value: String, limit: Int) -> Bool {
        value.utf8.count <= limit && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
    func editing(_ values: [String: Any]) throws -> Self {
        guard !values.isEmpty, Set(values.keys).isSubset(of: ["enabled", "baseURL", "username", "password"]),
              !values.values.contains(where: { $0 is NSNull }) else { throw MobileFailure("invalid-navidrome-settings") }
        let edit: Edit
        do { edit = try JSONDecoder().decode(Edit.self, from: JSONSerialization.data(withJSONObject: values)) }
        catch { throw MobileFailure("invalid-navidrome-settings") }
        var next = self
        if let raw = edit.baseURL {
            next.baseURL = raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : try Self.normalizedURL(raw)
        }
        if let username = edit.username { next.username = username.trimmingCharacters(in: .whitespaces) }
        if next.baseURL != baseURL || next.username != username { next.password = "" }
        // Whitespace is significant in passwords. Never trim or hash the stored password a second time.
        if let password = edit.password { next.password = password }
        if let enabled = edit.enabled { next.enabled = enabled }
        if (next.baseURL.isEmpty || next.username.isEmpty || next.password.isEmpty) && edit.enabled != true { next.enabled = false }
        if scope.isEmpty || next.baseURL != baseURL || next.username != username || next.password != password {
            next.scope = UUID().uuidString
        }
        try next.validate()
        return next
    }
    func validate() throws {
        guard Self.validText(username, limit: 512), Self.validText(password, limit: 8192),
              !enabled || (!baseURL.isEmpty && !username.isEmpty && !password.isEmpty),
              UUID(uuidString: scope) != nil || (scope.isEmpty && baseURL.isEmpty && username.isEmpty && password.isEmpty && !enabled)
        else { throw MobileFailure("invalid-navidrome-settings") }
        if !baseURL.isEmpty, try Self.normalizedURL(baseURL) != baseURL { throw MobileFailure("invalid-navidrome-settings") }
    }
    static func read(_ record: [String: Any]) throws -> Self {
        if record.isEmpty { return Self() }
        do {
            let settings = try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: record))
            try settings.validate(); return settings
        } catch { throw MobileFailure("invalid-navidrome-settings") }
    }
    func record() throws -> [String: Any] {
        guard let record = try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as? [String: Any] else {
            throw MobileFailure("invalid-navidrome-settings")
        }
        return record
    }
}
