import Foundation

// NativeAISettings.swift — AI credentials stay in one device-local Keychain record; snapshots contain presence flags only.
struct NativeAISettings: Codable {
    static let geminiURL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"
    struct Connection: Codable {
        var apiURL = "https://api.openai.com/v1/chat/completions"
        var model = "gpt-5.6-luna"
        var temperature = 0.7
        var stream = false
        var apiKey = ""
        var publicValues: [String: Any] {
            ["apiURL": apiURL, "model": model, "temperature": temperature, "stream": stream, "hasKey": !apiKey.isEmpty]
        }
    }
    private struct Edit: Decodable {
        let provider: String
        let apiURL: String?
        let model: String?
        let temperature: Double?
        let stream: Bool?
        let apiKey: String?
    }
    var provider = "gemini"
    var geminiKey = ""
    var openai = Connection()
    var publicValues: [String: Any] {
        ["provider": provider, "gemini": ["hasKey": !geminiKey.isEmpty], "openai": openai.publicValues]
    }
    var keys: [String] { [geminiKey, openai.apiKey].filter { !$0.isEmpty } }
    var key: String { provider == "gemini" ? geminiKey : openai.apiKey }
    var endpoint: URL { get throws { try Self.endpoint(provider == "gemini" ? Self.geminiURL : openai.apiURL) } }

    static func endpoint(_ value: String) throws -> URL {
        guard value.utf8.count <= 2048, let url = URL(string: value), url.scheme == "https",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, !value.contains(where: { $0.isWhitespace }) else {
            throw MobileFailure("ai-https-endpoint-required")
        }
        return url
    }
    static func validKey(_ value: String) -> Bool {
        value.utf8.count <= 8192 && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
    func editing(_ values: [String: Any]) throws -> Self {
        guard Set(values.keys).isSubset(of: ["provider", "apiURL", "model", "temperature", "stream", "apiKey"]),
              !values.values.contains(where: { $0 is NSNull }) else {
            throw MobileFailure("invalid-ai-settings")
        }
        let edit: Edit
        do { edit = try JSONDecoder().decode(Edit.self, from: JSONSerialization.data(withJSONObject: values)) }
        catch { throw MobileFailure("invalid-ai-settings") }
        guard ["gemini", "openai"].contains(edit.provider), edit.apiKey.map(Self.validKey) ?? true else {
            throw MobileFailure("invalid-ai-settings")
        }
        var next = self
        next.provider = edit.provider
        if edit.provider == "gemini" {
            guard edit.apiURL == nil, edit.model == nil, edit.temperature == nil, edit.stream == nil else {
                throw MobileFailure("invalid-ai-settings")
            }
            if let key = edit.apiKey { next.geminiKey = key.trimmingCharacters(in: .whitespaces) }
        } else {
            if let raw = edit.apiURL {
                let url = try Self.endpoint(raw), old = try Self.endpoint(openai.apiURL)
                // A new service must not inherit another service's key. An explicit replacement can be saved in the same edit.
                if url.host?.lowercased() != old.host?.lowercased() || url.port != old.port { next.openai.apiKey = "" }
                next.openai.apiURL = url.absoluteString
            }
            if let model = edit.model { next.openai.model = model.trimmingCharacters(in: .whitespacesAndNewlines) }
            if let temperature = edit.temperature { next.openai.temperature = temperature }
            if let stream = edit.stream { next.openai.stream = stream }
            if let key = edit.apiKey { next.openai.apiKey = key.trimmingCharacters(in: .whitespaces) }
        }
        try next.validate()
        return next
    }
    func validate() throws {
        guard ["gemini", "openai"].contains(provider), Self.validKey(geminiKey), Self.validKey(openai.apiKey),
              !openai.model.isEmpty, openai.model.utf8.count <= 200,
              !openai.model.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              openai.temperature.isFinite, (0...2).contains(openai.temperature) else { throw MobileFailure("invalid-ai-settings") }
        _ = try Self.endpoint(openai.apiURL)
    }
    static func read(_ record: [String: Any]) throws -> Self {
        if record.isEmpty { return Self() }
        do {
            let value = try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: record))
            try value.validate()
            return value
        } catch { throw MobileFailure("invalid-ai-settings") }
    }
    func record() throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as? [String: Any] else {
            throw MobileFailure("invalid-ai-settings")
        }
        return value
    }
}
