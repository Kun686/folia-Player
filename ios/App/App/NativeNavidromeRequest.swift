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
        let salt = try randomSalt()
        var parts = URLComponents(string: settings.baseURL + "/rest/" + operation)!
        parts.queryItems = [URLQueryItem(name: "u", value: settings.username),
            URLQueryItem(name: "t", value: token(password: settings.password, salt: salt)),
            URLQueryItem(name: "s", value: salt), URLQueryItem(name: "v", value: "1.16.1"),
            URLQueryItem(name: "c", value: "Folia"), URLQueryItem(name: "f", value: "json")]
        var values = parameters
        if operation == "getUser" { values["username"] = settings.username }
        parts.queryItems! += values.sorted(by: { $0.key < $1.key }).map { URLQueryItem(name: $0.key, value: $0.value) }
        // Form-style servers treat a literal '+' as space; URLComponents leaves it unescaped by default.
        parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = parts.url, url.absoluteString.utf8.count <= 32768 else { throw MobileFailure("invalid-navidrome-request") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "GET"; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
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
