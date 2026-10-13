import Foundation

// NativeNavidromeLyrics.swift — execute the original hydration/selection in JavaScriptCore with native session reads.
enum NativeNavidromeLyrics {
    static func document(_ song: [String: Any], client: NativeNavidromeClient, parser: NativeLyricParser) async throws -> [String: Any] {
        let epoch = try await client.validatePlayback(song)
        var responses: [[String: Any]] = []
        for _ in 0..<3 {
            try Task.checkCancellation()
            let step = try await parser.navidromeStep(["version": 1, "song": song, "responses": responses])
            _ = try await client.validatePlayback(song, expected: epoch)
            if step.keys.contains("lines") && step.keys.contains("lyrics") { return step }
            guard responses.count < 2, let request = step["request"] as? [String: Any],
                  let operation = request["operation"] as? String, ["getLyricsBySongId", "getLyrics"].contains(operation),
                  let parameters = request["parameters"] as? [String: String] else { throw MobileFailure("invalid-navidrome-request") }
            var response: Any = NSNull()
            do { response = try await client.resource(song, operation: operation, parameters: parameters) }
            catch {
                // Explicitly absent optional endpoints retain the original plain-LRC fallback; auth/network errors do not.
                guard operation == "getLyricsBySongId", let failure = error as? MobileFailure,
                      ["navidrome-http-404", "navidrome-not-found", "navidrome-api-0"].contains(failure.code) else { throw error }
            }
            _ = try await client.validatePlayback(song, expected: epoch)
            responses.append(["operation": operation, "parameters": parameters, "response": response])
        }
        throw MobileFailure("invalid-navidrome-request")
    }
}
