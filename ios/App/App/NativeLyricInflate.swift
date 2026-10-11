import Foundation
import zlib

// NativeLyricInflate.swift — SDK zlib replaces the browser DecompressionStream in the original QRC pipeline.
enum NativeLyricInflate {
    static func text(_ base64: String) -> String? {
        guard let input = Data(base64Encoded: base64), !input.isEmpty, input.count <= 1_000_000 else { return nil }
        var stream = z_stream()
        guard inflateInit_(&stream, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
        defer { inflateEnd(&stream) }
        var output = [UInt8](repeating: 0, count: 2_000_001)
        let status = input.withUnsafeBytes { bytes in
            output.withUnsafeMutableBytes { target in
                stream.next_in = UnsafeMutablePointer(mutating: bytes.bindMemory(to: UInt8.self).baseAddress)
                stream.avail_in = uInt(bytes.count)
                stream.next_out = target.bindMemory(to: UInt8.self).baseAddress
                stream.avail_out = uInt(target.count)
                return inflate(&stream, Z_FINISH)
            }
        }
        let count = Int(stream.total_out)
        guard count <= 2_000_000, count > 0 || status == Z_STREAM_END else { return nil }
        // The original reader keeps chunks already emitted before a trailing checksum/truncation error.
        guard [Z_STREAM_END, Z_DATA_ERROR, Z_BUF_ERROR].contains(status) else { return nil }
        return String(decoding: output.prefix(count), as: UTF8.self)
    }
}
