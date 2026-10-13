import Foundation

// NativeLyricMatchTransport.swift — one immutable account/configuration snapshot per match; AMLL has a separate public session.
final class NativeLyricMatchTransport: @unchecked Sendable {
    private let gateway: GatewayClient
    let record: NativeGatewayRecord
    private let configuration: URLSessionConfiguration
    init(gateway: GatewayClient, configuration: URLSessionConfiguration = .ephemeral) throws {
        self.gateway = gateway; record = try gateway.credentials.snapshot()
        self.configuration = configuration.copy() as! URLSessionConfiguration
    }
    func validate() throws {
        try Task.checkCancellation()
        let current = try gateway.credentials.snapshot()
        // A platform session replacement intentionally does not rotate the gateway scope.
        guard current.scope == record.scope, current.sessionGeneration == record.sessionGeneration,
              current.sessions == record.sessions else { throw MobileFailure("lyric-session-changed") }
    }
    func send(_ request: [String: Any]) async throws -> [String: Any] {
        try validate()
        let reply: [String: Any]
        if request["provider"] as? String == "amll" {
            guard Set(request.keys) == Set(["provider", "path"]), let path = request["path"] as? String,
                  path.utf8.count <= 512, let url = URL(string: path),
                  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  parts.scheme == "https", parts.host == "api.amll.dev", parts.path == "/v1/lyrics/get",
                  parts.port == nil, parts.user == nil, parts.password == nil, parts.fragment == nil,
                  let queries = parts.queryItems, queries.count == 1,
                  ["ncmMusicId", "qqMusicId"].contains(queries[0].name), let id = queries[0].value,
                  !id.isEmpty, id.utf8.count <= 128 else { throw MobileFailure("forbidden") }
            var outgoing = URLRequest(url: url)
            outgoing.setValue("Folia/mobile (Kun686/folia-Player)", forHTTPHeaderField: "User-Agent")
            do {
                reply = try await NativeJSONTransport.perform(outgoing,
                    configuration: configuration.copy() as! URLSessionConfiguration,
                    limit: 2_000_000, timeout: 5, prefix: "lyric")
            } catch let failure as MobileFailure where failure.code == "lyric-response-too-large" {
                throw MobileFailure("lyrics-too-large")
            }
        } else {
            reply = try await gateway.send("/mobile/request", body: request, scope: record.scope)
        }
        try validate()
        return reply
    }
}

enum NativeBestLyrics {
    static func match(_ input: [String: Any], gateway: GatewayClient) async throws -> [String: Any]? {
        let transport = try NativeLyricMatchTransport(gateway: gateway)
        var input = input
        input["sessions"] = transport.record.sessions
        let result = try await NativeLyricMatchJob().run(input, request: transport.send)
        try transport.validate()
        return result
    }
}
