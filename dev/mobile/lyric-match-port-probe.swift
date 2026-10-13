import Foundation
import JavaScriptCore

// lyric-match-port-probe.swift — finite Mac QA host; no browser, network, accounts, signing or App installation.
do {
    guard CommandLine.arguments.count == 3 else {
        throw NSError(domain: "Usage: lyric-match-port-probe bundled.js new-result.json", code: 1)
    }
    let script = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    guard !FileManager.default.fileExists(atPath: output.path), let context = JSContext() else {
        throw NSError(domain: "new-output-and-context-required", code: 1)
    }
    context.evaluateScript(try String(contentsOf: script, encoding: .utf8), withSourceURL: script)
    guard context.exception == nil else { throw NSError(domain: "bundle-load-failed", code: 1) }
    var receipt: String?
    let complete: @convention(block) (String) -> Void = { receipt = $0 }
    context.objectForKeyedSubscript("FoliaLyricProbe")?.invokeMethod("run", withArguments: [complete])
    guard context.exception == nil, let receipt, let data = receipt.data(using: .utf8), data.count < 1_000_000 else {
        throw NSError(domain: "JavaScriptCore-probe-did-not-complete", code: 1)
    }
    try data.write(to: output, options: .atomic)
    let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    guard result?["passed"] as? Bool == true, result?["globalsAbsent"] as? Bool == true,
          (result?["cases"] as? [Any])?.count == 4 else { throw NSError(domain: "portable-lyric-policy-failed", code: 1) }
    print("PASS: four original source paths and four pure-music reuse checks in bare JavaScriptCore")
} catch {
    FileHandle.standardError.write(Data(("\(error)\n").utf8))
    exit(1)
}
