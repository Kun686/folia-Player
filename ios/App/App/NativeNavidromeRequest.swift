import Foundation
import CryptoKit
import Security

// NativeNavidromeRequest.swift — original Subsonic 1.16.1 read routes; passwords and signed URLs never cross the bridge.
enum NativeNavidromeRequest {
    static let routes: [String: Set<String>] = [
        "ping": [], "getOpenSubsonicExtensions": [], "getUser": ["username"], "getMusicFolders": [], "getLicense": [],
        "getAlbumList2": ["type", "size", "offset"], "getAlbum": ["id"], "getPlaylists": [], "getPlaylist": ["id"],
        "getRandomSongs": ["size"], "getStarred2": [], "getArtists": [], "getArtist": ["id"], "getSong": ["id"],
        "getLyrics": ["artist", "title"], "getLyricsBySongId": ["id", "enhanced"],
        "search3": ["query", "artistCount", "albumCount", "songCount", "artistOffset", "albumOffset", "songOffset"],
    ]
    static func token(password: String, salt: String) -> String {
        // MD5 is required by the Subsonic protocol, not used as password storage or a new security primitive.
        Insecure.MD5.hash(data: Data((password + salt).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private static func randomSalt() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw MobileFailure("navidrome-random-failed")
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
    static func make(settings: NativeNavidromeSettings, operation: String, parameters: [String: String]) throws -> URLRequest {
        try settings.validate()
        guard !settings.baseURL.isEmpty, !settings.username.isEmpty, !settings.password.isEmpty else {
            throw MobileFailure("navidrome-not-configured")
        }
        guard settings.enabled || operation == "ping" else { throw MobileFailure("navidrome-disabled") }
        guard let allowed = routes[operation], Set(parameters.keys).isSubset(of: allowed),
              parameters.values.allSatisfy({ $0.utf8.count <= 4096 && !$0.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) })
        else { throw MobileFailure("invalid-navidrome-request") }
        if allowed.contains("id"), parameters["id"]?.isEmpty != false { throw MobileFailure("invalid-navidrome-request") }
        if operation == "search3", parameters["query"] == nil { throw MobileFailure("invalid-navidrome-request") }
        if operation == "getAlbumList2", !["alphabeticalByName", "alphabeticalByArtist", "newest", "recent", "frequent", "random"].contains(parameters["type"] ?? "") {
            throw MobileFailure("invalid-navidrome-request")
        }
        if operation == "getUser", let username = parameters["username"], username != settings.username {
            throw MobileFailure("invalid-navidrome-request")
        }
        for (key, value) in parameters {
            if key == "enhanced", !["true", "false"].contains(value) { throw MobileFailure("invalid-navidrome-request") }
            if key == "size" || key.hasSuffix("Count") || key.lowercased().hasSuffix("offset") {
                let maximum = key.lowercased().hasSuffix("offset") ? 10_000_000 : 500
                guard !value.isEmpty, value.utf8.allSatisfy({ (48...57).contains($0) }),
                      let number = Int(value), (0...maximum).contains(number) else { throw MobileFailure("invalid-navidrome-request") }
            }
        }
        var values = parameters
        if operation == "getUser" { values["username"] = settings.username }
        let url = try signedURL(settings, operation: operation, parameters: values)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "GET"; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }
    // Native-only media route: never accepted by the JavaScript read bridge.
    static func streamURL(_ settings: NativeNavidromeSettings, id: String) throws -> URL {
        try settings.validate()
        guard settings.enabled else { throw MobileFailure("navidrome-disabled") }
        guard validMediaID(id) else { throw MobileFailure("invalid-identity") }
        // Preserve the original format omission: the server selects the playable representation.
        return try signedURL(settings, operation: "stream", parameters: ["id": id])
    }
    static func validMediaID(_ id: String) -> Bool {
        !id.isEmpty && id.utf8.count <= 4096 && !id.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
    static func coverURL(_ settings: NativeNavidromeSettings, id: String) throws -> URL {
        try settings.validate()
        guard settings.enabled else { throw MobileFailure("navidrome-disabled") }
        guard validMediaID(id) else { throw MobileFailure("invalid-identity") }
        return try signedURL(settings, operation: "getCoverArt", parameters: ["id": id, "size": "600"])
    }
    static func isSignedMediaURL(_ url: URL) -> Bool {
        let names = Set(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name) ?? [])
        return ["stream", "getCoverArt"].contains(url.lastPathComponent)
            && url.deletingLastPathComponent().lastPathComponent == "rest" && names.isSuperset(of: ["u", "t", "s"])
    }
    private static func signedURL(_ settings: NativeNavidromeSettings, operation: String, parameters: [String: String]) throws -> URL {
        try signedURL(settings, operation: operation, values: parameters.mapValues { [$0] })
    }
    // Playback-only route, deliberately absent from both WebView read and mutation allowlists.
    static func scrobble(settings: NativeNavidromeSettings, id: String, time: Double, submission: Bool) throws -> URLRequest {
        try settings.validate()
        guard settings.enabled, !settings.password.isEmpty else { throw MobileFailure("navidrome-not-configured") }
        guard validMediaID(id), time.isFinite, time >= 0, time <= 8_640_000_000_000_000 else { throw MobileFailure("invalid-navidrome-request") }
        let url = try signedURL(settings, operation: "scrobble", parameters: ["id": id,
            "time": String(Int64(time.rounded(.down))), "submission": submission ? "true" : "false"])
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "GET"; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }
    // Write routes retain repeated Subsonic parameters; no credential or endpoint overrides are accepted.
    static func mutation(settings: NativeNavidromeSettings, operation: String, parameters: [String: Any]) throws -> URLRequest {
        try settings.validate()
        guard settings.enabled, !settings.username.isEmpty, !settings.password.isEmpty else { throw MobileFailure("navidrome-not-configured") }
        let routes: [String: Set<String>] = ["createPlaylist": ["name", "songId"], "deletePlaylist": ["id"],
            "updatePlaylist": ["playlistId", "name", "comment", "public", "songIdToAdd", "songIndexToRemove"],
            "star": ["id"], "unstar": ["id"]]
        guard let allowed = routes[operation], Set(parameters.keys).isSubset(of: allowed) else { throw MobileFailure("invalid-navidrome-request") }
        let arrays: Set<String> = ["songId", "songIdToAdd", "songIndexToRemove"]
        var values: [String: [String]] = [:]
        for (key, raw) in parameters {
            let entries: [String]
            if arrays.contains(key), let list = raw as? [String], list.count <= 1000 { entries = list }
            else if !arrays.contains(key), let text = raw as? String { entries = [text] }
            else { throw MobileFailure("invalid-navidrome-request") }
            guard entries.allSatisfy({ validMediaID($0) }) else { throw MobileFailure("invalid-navidrome-request") }
            if key == "songIndexToRemove", !entries.allSatisfy({ value in
                value.utf8.allSatisfy({ (48...57).contains($0) }) && Int(value).map { (0...10_000_000).contains($0) } == true
            }) { throw MobileFailure("invalid-navidrome-request") }
            if key == "public", !entries.allSatisfy({ ["true", "false"].contains($0) }) { throw MobileFailure("invalid-navidrome-request") }
            values[key] = entries
        }
        let required = operation == "createPlaylist" ? "name" : operation == "updatePlaylist" ? "playlistId" : "id"
        guard values[required]?.first?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
              values.values.reduce(0, { $0 + $1.count }) <= 1005,
              operation != "updatePlaylist" || values.keys.contains(where: { $0 != "playlistId" }) else { throw MobileFailure("invalid-navidrome-request") }
        let url = try signedURL(settings, operation: operation, values: values)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        // Match original Subsonic GET semantics, including older servers without formPost support.
        request.httpMethod = "GET"; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }
    private static func signedURL(_ settings: NativeNavidromeSettings, operation: String, values: [String: [String]]) throws -> URL {
        let salt = try randomSalt()
        guard var parts = URLComponents(string: settings.baseURL + "/rest/" + operation) else { throw MobileFailure("invalid-navidrome-request") }
        parts.queryItems = [URLQueryItem(name: "u", value: settings.username),
            URLQueryItem(name: "t", value: token(password: settings.password, salt: salt)),
            URLQueryItem(name: "s", value: salt), URLQueryItem(name: "v", value: "1.16.1"),
            URLQueryItem(name: "c", value: "Folia"), URLQueryItem(name: "f", value: "json")]
        parts.queryItems! += values.sorted(by: { $0.key < $1.key }).flatMap { key, entries in entries.map { URLQueryItem(name: key, value: $0) } }
        // Form-style servers treat a literal '+' as space; URLComponents leaves it unescaped by default.
        parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = parts.url, url.absoluteString.utf8.count <= 32768 else { throw MobileFailure("invalid-navidrome-request") }
        return url
    }
    static func response(_ result: [String: Any]) throws -> [String: Any] {
        guard let status = result["status"] as? Int else { throw MobileFailure("navidrome-invalid-response") }
        guard (200..<300).contains(status) else {
            if status == 401 { throw MobileFailure("navidrome-auth-required") }
            if status == 403 { throw MobileFailure("navidrome-forbidden") }
            if (300..<400).contains(status) { throw MobileFailure("navidrome-redirect-refused") }
            throw MobileFailure("navidrome-http-\(status)")
        }
        guard let text = result["body"] as? String, let data = text.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let envelope = object["subsonic-response"] as? [String: Any], let version = envelope["version"] as? String, !version.isEmpty
        else { throw MobileFailure("navidrome-invalid-response") }
        if envelope["status"] as? String == "failed" {
            // Do not forward server messages, which can echo the request URL or credentials.
            guard let error = envelope["error"] as? [String: Any], let raw = error["code"] as? NSNumber,
                  CFGetTypeID(raw) != CFBooleanGetTypeID(), raw.doubleValue == Double(raw.intValue), (0...999).contains(raw.intValue)
            else { throw MobileFailure("navidrome-invalid-response") }
            switch raw.intValue {
            case 40: throw MobileFailure("navidrome-auth-required")
            case 41: throw MobileFailure("navidrome-token-auth-unsupported")
            case 50: throw MobileFailure("navidrome-forbidden")
            case 70: throw MobileFailure("navidrome-not-found")
            default: throw MobileFailure("navidrome-api-\(raw.intValue)")
            }
        }
        guard envelope["status"] as? String == "ok", envelope["error"] == nil else { throw MobileFailure("navidrome-invalid-response") }
        return ["subsonic-response": envelope]
    }
}
