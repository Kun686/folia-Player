import { Buffer } from 'buffer';
import { AbstractTokenizer, EndOfStreamError } from 'strtok3/core';
import type { IReadChunkOptions } from 'strtok3';
import type { IGetToken } from '@tokenizer/token';
import { FlacParser } from '../../../node_modules/music-metadata/lib/flac/FlacParser.js';
import { MetadataCollector } from '../../../node_modules/music-metadata/lib/common/MetadataCollector.js';
import { VorbisDecoder } from '../../../node_modules/music-metadata/lib/ogg/vorbis/VorbisDecoder.js';
import { selectEmbeddedLyrics } from './embeddedMetadataSelection';

// nativeFlacRuntime.ts — bounded file I/O for the original FLAC parser, independent of system Vorbis exposure.
type ReadBytes = (position: number, length: number) => string | null;
function invalid(): never { throw new Error('invalid-flac-metadata'); }

class NativeFileTokenizer extends AbstractTokenizer {
    readonly fileInfo: { size: number; mimeType: string };
    failed = false;
    private bytes = 0;
    private reads = 0;
    constructor(size: number, private readBytes: ReadBytes) {
        super();
        if (!Number.isSafeInteger(size) || size < 0) invalid();
        this.fileInfo = { size, mimeType: 'audio/flac' };
    }
    supportsRandomAccess() { return true; }
    setPosition(position: number) {
        if (!Number.isSafeInteger(position) || position < 0 || position > this.fileInfo.size) invalid();
        this.position = position;
    }
    private bound(length: number) {
        if (!Number.isSafeInteger(length) || length < 0 || length > 4_000_000) invalid();
    }
    async readToken<T>(token: IGetToken<T>, position?: number): Promise<T> {
        this.bound(token.len); return super.readToken(token, position);
    }
    async peekToken<T>(token: IGetToken<T>, position?: number): Promise<T> {
        this.bound(token.len); return super.peekToken(token, position);
    }
    async peekBuffer(buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> {
        try {
            const { position, length, mayBeLess } = this.normalizeOptions(buffer, options);
            this.bound(length);
            if (!Number.isSafeInteger(position) || position < 0 || position > this.fileInfo.size || length > buffer.length) invalid();
            const count = Math.min(length, this.fileInfo.size - position);
            if (!mayBeLess && count !== length) throw new EndOfStreamError();
            this.bytes += count; this.reads++;
            if (this.bytes > 8_000_000 || this.reads > 512) invalid();
            if (count === 0) return 0;
            const value = this.readBytes(position, count);
            if (typeof value !== 'string' || value.length > Math.ceil(count / 3) * 4) invalid();
            const bytes = Buffer.from(value, 'base64');
            if (bytes.length !== count) invalid();
            buffer.set(bytes); return count;
        } catch (error) { this.failed = true; throw error; }
    }
    async readBuffer(buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> {
        const position = options?.position ?? this.position;
        const count = await this.peekBuffer(buffer, options);
        this.position = position + count; return count;
    }
}

class BoundedFlacParser extends FlacParser {
    async parseComment(data: Uint8Array): Promise<void> {
        // Reuse the library decoder to validate its count before FlacParser allocates the tag array.
        const decoder = new VorbisDecoder(data, 0);
        decoder.readStringUtf8();
        const count = decoder.readInt32();
        if (count < 0 || count > 4096 || count > data.length / 4) invalid();
        return super.parseComment(data);
    }
}

export function flacTags(size: number, read: ReadBytes, done: (result: string) => void): void {
    // All async work uses immediate local reads. JavaScriptCore drains these jobs before returning to Swift.
    void (async () => {
        const tokenizer = new NativeFileTokenizer(size, read), options = { skipCovers: true, skipPostHeaders: true };
        try {
            const metadata = new MetadataCollector(options);
            await new BoundedFlacParser(metadata, tokenizer, options).parse();
            if (tokenizer.failed || metadata.format.container !== 'FLAC' || (metadata.common.lyrics?.length ?? 0) > 64) invalid();
            const result = selectEmbeddedLyrics(metadata.common.lyrics ?? [], metadata.native);
            if ([result.lyrics, result.translationLyrics].some(text => text && Buffer.byteLength(text, 'utf8') > 2_000_000)) invalid();
            return JSON.stringify({ ...result, trackNumber: metadata.common.track.no ?? undefined,
                discNumber: metadata.common.disk.no ?? undefined });
        } finally { await tokenizer.close(); }
    })().then(done, () => done(JSON.stringify({ error: 'invalid-flac-metadata' })));
}
