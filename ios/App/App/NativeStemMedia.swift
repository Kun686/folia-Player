import AVFoundation

// NativeStemMedia.swift — full local decode with a fixed 30-second resident window, independent of model runtime.
struct NativeStemMaterial {
    let mediaRevision: String, role: NativeStemRole, fromFrame: Int, totalFrames: Int, channels: [[Float]]
    var frames: Int { channels[0].count }
    func key(identity: NativeProfileIdentity, modelDigest: String) throws -> NativeStemCache.Key {
        try NativeStemCache.Key(identity: identity, mediaRevision: mediaRevision, modelDigest: modelDigest, role: role)
    }
}

actor NativeStemMedia {
    // Cached media carries the existing hard-link lease; no cache.store, download or remote prefix is requested.
    func read(cached: NativeCachedMedia, role: NativeStemRole) throws -> NativeStemMaterial {
        let deadline = ProcessInfo.processInfo.systemUptime + 60
        let snapshot = try NativeStemSnapshot.capture(cached: cached, deadline: deadline)
        return try Self.decode(snapshot, role: role, deadline: deadline)
    }
    func read(file: URL, role: NativeStemRole) throws -> NativeStemMaterial {
        let deadline = ProcessInfo.processInfo.systemUptime + 60
        let snapshot = try NativeStemSnapshot.capture(file, deadline: deadline)
        return try Self.decode(snapshot, role: role, deadline: deadline)
    }

    private static func decode(_ snapshot: NativeStemSnapshot, role: NativeStemRole, deadline: Double) throws -> NativeStemMaterial {
        let limit = 1_323_000
        var kept = Array(repeating: Array(repeating: Float(0), count: limit), count: 2), position = 0
        let total = try NativeStemFileDecoder.read(snapshot.url, deadline: deadline) { buffer in
            guard let source = buffer.floatChannelData else { throw MobileFailure("stem-decode-failed") }
            let count = Int(buffer.frameLength)
            // Decode continuously from the beginning: seeking straight to the tail would reset the resampler's history.
            for c in 0..<2 {
                let input = source[buffer.format.channelCount == 1 ? 0 : c]
                for i in 0..<count where !input[i].isFinite { throw MobileFailure("invalid-stem-pcm") }
                if role == .head {
                    let copy = min(count, max(0, limit - position))
                    if copy > 0 { kept[c].withUnsafeMutableBufferPointer { $0.baseAddress!.advanced(by: position).update(from: input, count: copy) } }
                } else if count > 0 {
                    let at = position % limit, first = min(count, limit - at)
                    kept[c].withUnsafeMutableBufferPointer {
                        $0.baseAddress!.advanced(by: at).update(from: input, count: first)
                        if first < count { $0.baseAddress!.update(from: input.advanced(by: first), count: count - first) }
                    }
                }
            }
            position += count
        }
        try Task.checkCancellation()
        guard total > 0 else { throw MobileFailure("stem-decode-failed") }
        let count = min(total, limit), start = role == .tail ? total - count : 0
        let offset = role == .tail && total > limit ? total % limit : 0
        let channels = kept.map { row in
            offset == 0 ? Array(row.prefix(count)) : Array(row[offset..<limit]) + Array(row[0..<offset])
        }
        return NativeStemMaterial(mediaRevision: snapshot.digest, role: role, fromFrame: start, totalFrames: total, channels: channels)
    }
}
