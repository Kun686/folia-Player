import { Buffer } from 'buffer';
import { FrameParser } from '../../../node_modules/music-metadata/lib/id3v2/FrameParser.js';
import { parseLyrics } from '../../../node_modules/music-metadata/lib/lrc/LyricsParser.js';
import type { ParsedLyricTag } from './embeddedMetadataSelection';

// nativeMetadataDecoding.ts — reuse installed music-metadata 11.16.1 (MIT), not a second ID3 decoder.
// These internal entry points are version-guarded by build-transitions.mjs and compared with parseBlob in tests.
export { parseLyrics as parseMetadataLyricText };

export function decodeNativeSylt(value: string): ParsedLyricTag {
    if (value.length > 349528) throw new Error('lyrics-too-large');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length > 262144 || bytes.length < 6 || bytes.toString('base64') !== value) throw new Error('invalid-embedded-lyrics');
    // AVFoundation provides the decoded frame payload. SYLT's payload layout is shared by ID3v2.3 and v2.4.
    // Token readers use the backing ArrayBuffer; isolate this frame so pooled Buffer bytes cannot mask truncation.
    const frame = Uint8Array.from(bytes);
    const tag = new FrameParser(4, { addWarning() { throw new Error('invalid-embedded-lyrics'); } }).readData(frame, 'SYLT', false) as ParsedLyricTag;
    if (!tag || !Array.isArray(tag.syncText) || tag.syncText.length > 2000) throw new Error('invalid-embedded-lyrics');
    return tag;
}
