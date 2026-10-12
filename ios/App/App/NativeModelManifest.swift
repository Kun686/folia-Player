import Foundation

// NativeModelManifest.swift — the same fixed weights used by desktop; iOS has no Python runtime download.
struct NativeModelManifest: Sendable {
    enum Name: String, Codable, CaseIterable, Sendable { case beatThis = "beat_this", htdemucs }
    struct Entry: Codable, Sendable {
        let name: Name, file: String, bytes: Int64, sha256: String, enables: String, license: String
        let mirrors: [URL]
    }
    private struct Document: Decodable {
        struct Model: Decodable {
            let name: String
            let file: String?, bytes: Int64?, sha256: String?, enables: String?, license: String?
        }
        let models: [Model], mirrors: [String]
    }
    let entries: [Entry]
    init(bundle: Bundle = .main) throws {
        guard let url = bundle.url(forResource: "modelManifest", withExtension: "json") else {
            throw MobileFailure("ort-manifest-unavailable")
        }
        try self.init(data: Data(contentsOf: url))
    }
    // Data injection is internal to native tests; the bridge never accepts a manifest or model URL.
    init(data: Data) throws {
        let document = try JSONDecoder().decode(Document.self, from: data)
        entries = try Name.allCases.map { name in
            let matches = document.models.filter { $0.name == name.rawValue }
            guard matches.count == 1, let model = matches.first,
                  model.file == name.rawValue + ".onnx", let bytes = model.bytes, (1...200_000_000).contains(bytes),
                  let digest = model.sha256, digest.count == 64, digest.allSatisfy({ "0123456789abcdef".contains($0) }),
                  model.license == "MIT", model.enables == (name == .beatThis ? "beatGrid" : "stems"),
                  !document.mirrors.isEmpty, document.mirrors.count <= 8 else { throw MobileFailure("ort-manifest-unavailable") }
            let mirrors = try document.mirrors.map { template -> URL in
                guard template.components(separatedBy: "{file}").count == 2,
                      let url = URL(string: template.replacingOccurrences(of: "{file}", with: name.rawValue + ".onnx")),
                      url.scheme == "https", url.host?.isEmpty == false, url.user == nil, url.password == nil,
                      url.fragment == nil else { throw MobileFailure("ort-manifest-unavailable") }
                return url
            }
            return Entry(name: name, file: name.rawValue + ".onnx", bytes: bytes, sha256: digest,
                         enables: model.enables!, license: "MIT", mirrors: mirrors)
        }
    }
    func entry(_ name: Name) -> Entry { entries.first { $0.name == name }! }
}
