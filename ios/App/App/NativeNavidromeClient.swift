import Foundation

// NativeNavidromeClient.swift — independent Keychain connection and bounded read transport, usable without a running WebView.
@MainActor final class NativeNavidromeClient {
    private let read: () throws -> [String: Any]
    private let write: ([String: Any]) throws -> Void
    private let configuration: () -> URLSessionConfiguration
    private let requests = NativeJSONTasks(prefix: "navidrome")
    private(set) var revision = 0
    nonisolated static let maxResponseBytes = 8 * 1024 * 1024
    init(read: @escaping () throws -> [String: Any] = { try SecureStore.read("navidrome.settings") },
         write: @escaping ([String: Any]) throws -> Void = { try SecureStore.write("navidrome.settings", $0) },
         configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) {
        self.read = read; self.write = write; self.configuration = configuration
    }
    func snapshot() throws -> [String: Any] {
        publicValues(try NativeNavidromeSettings.read(read()))
    }
    private func publicValues(_ settings: NativeNavidromeSettings) -> [String: Any] {
        var value = settings.publicValues; value["revision"] = revision; return value
    }
    func configure(_ values: [String: Any], expected: Int, scope: String) throws -> [String: Any] {
        let previous = try NativeNavidromeSettings.read(read())
        guard revision == expected, previous.scope == scope else { throw MobileFailure("navidrome-settings-changed") }
        let next = try previous.editing(values)
        try write(next.record())
        // A failed Keychain write must preserve current requests and the last committed settings.
        revision += 1; requests.cancelAll()
        return publicValues(next)
    }
    func cancel(_ id: String) { requests.cancel(id) }
    func send(id: String, expected: Int, scope: String, operation: String, parameters: [String: String]) async throws -> [String: Any] {
        try await requests.run(id: id) { [self] in
            let settings = try NativeNavidromeSettings.read(read())
            guard expected == revision, scope == settings.scope else { throw MobileFailure("navidrome-settings-changed") }
            let request = try NativeNavidromeRequest.make(settings: settings, operation: operation, parameters: parameters)
            let result = try await NativeJSONTransport.perform(request, configuration: configuration(),
                limit: Self.maxResponseBytes, timeout: 30, prefix: "navidrome")
            guard expected == revision, scope == (try NativeNavidromeSettings.read(read())).scope else {
                throw MobileFailure("navidrome-settings-changed")
            }
            return ["scope": scope, "revision": revision, "response": try NativeNavidromeRequest.response(result)]
        }
    }
}
