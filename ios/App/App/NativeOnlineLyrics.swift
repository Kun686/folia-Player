import Foundation

// NativeOnlineLyrics.swift — execute the shared provider adapter through the authenticated native transport.
enum NativeOnlineLyrics {
    static func load(_ song: [String: Any], session: [String: Any], gateway: GatewayClient,
                     parser: NativeLyricParser) async throws -> [[String: Any]]? {
        var responses: [[String: Any]] = []
        for _ in 0..<3 {
            try Task.checkCancellation()
            let input = try JSONSerialization.data(withJSONObject: ["version": 1, "song": song, "session": session, "responses": responses])
            let data = try await parser.onlineStep(input)
            guard let step = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFailure("invalid-lyric-response") }
            if step.keys.contains("lines") { return step["lines"] as? [[String: Any]] }
            guard responses.count < 2, let request = step["request"] as? [String: Any] else { throw MobileFailure("invalid-lyric-request") }
            let response = try await gateway.send("/mobile/request", body: request)
            try Task.checkCancellation()
            guard let body = response["body"] as? String, body.utf8.count <= 2_000_000,
                  let status = response["status"] as? Int else { throw MobileFailure("invalid-lyric-response") }
            responses.append(["body": body, "status": status])
        }
        throw MobileFailure("invalid-lyric-request")
    }
}
