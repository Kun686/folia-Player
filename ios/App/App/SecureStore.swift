import Foundation
import Security

// SecureStore.swift — all credentials are device-local and available after first unlock.
enum SecureStore {
    static let service = "app.folia.personal.mobile"
    static func read(_ key: String) throws -> [String: Any] {
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return [:] }
        guard status == errSecSuccess, let data = result as? Data,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFailure("secure-storage") }
        return object
    }
    static func write(_ key: String, _ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(base(key) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = base(key); attributes.forEach { item[$0.key] = $0.value }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw MobileFailure("secure-storage") }
        } else if status != errSecSuccess { throw MobileFailure("secure-storage") }
    }
    static func remove(_ key: String) throws {
        let status = SecItemDelete(base(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw MobileFailure("secure-storage") }
    }
    private static func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }
}
struct MobileFailure: Error { let code: String; init(_ code: String) { self.code = code } }
