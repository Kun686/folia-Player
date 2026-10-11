import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBlob } from 'music-metadata';
import { embeddedTagsJSON } from '@/utils/lyrics/nativeEmbeddedRuntime';
import { selectEmbeddedLyrics } from '@/utils/lyrics/embeddedMetadataSelection';
import { flacTags } from '@/utils/lyrics/nativeFlacRuntime';

// embeddedFormats.test.ts — identical audio bytes and desktop expectations also run through iOS AVFoundation.
interface Sample { name: string; extension: string; audioBase64: string; tags: Record<string, string>[]; expected: { lyrics?: string; translationLyrics?: string } }
const fixture: { cases: Sample[] } = JSON.parse(readFileSync(new URL('../../../ios/App/NativeTests/EmbeddedFormatReference.json', import.meta.url), 'utf8'));
const select = (tags: unknown[]) => JSON.parse(embeddedTagsJSON(JSON.stringify({ version: 1, tags })));
const fileSelection = (bytes: Buffer) => new Promise<Sample['expected'] & { error?: string }>(resolve => {
    flacTags(bytes.length, (position, length) => bytes.subarray(position, position + length).toString('base64'), text => resolve(JSON.parse(text)));
});

describe('native FLAC and synchronized lyric metadata', () => {
    it.each(fixture.cases)('matches public desktop parsing and shared selection: $name', async sample => {
        const parsed = await parseBlob(new Blob([new Uint8Array(Buffer.from(sample.audioBase64, 'base64'))]));
        expect(selectEmbeddedLyrics(parsed.common.lyrics ?? [], parsed.native)).toEqual(sample.expected);
        expect(select(sample.tags)).toEqual(sample.expected);
    });
    it('preserves common format priority regardless of system metadata enumeration order', () => {
        const sample = fixture.cases.find(entry => entry.name === 'flac-priority-over-id3')!;
        expect(select([...sample.tags].reverse())).toEqual(sample.expected);
    });
    it('rejects truncated, excessive and malformed binary tags then parses a valid tag again', () => {
        const sample = fixture.cases.find(entry => entry.name === 'sylt-v24-utf8')!;
        const tag = sample.tags[0], bytes = Buffer.from(tag.value, 'base64');
        for (const value of ['garbage!', bytes.subarray(0, bytes.length - 1).toString('base64'),
            Buffer.alloc(262145).toString('base64')]) expect(() => select([{ ...tag, value }])).toThrow();
        const crowded = Buffer.concat([Buffer.from([3, 101, 110, 103, 2, 1, 0]),
            ...Array.from({ length: 2001 }, () => Buffer.from([97, 0, 0, 0, 0, 0]))]);
        expect(() => select([{ ...tag, value: crowded.toString('base64') }])).toThrow();
        expect(select(sample.tags)).toEqual(sample.expected);
    });
    it('bounds UTF-8 text and metadata fields and rejects unknown representations', () => {
        for (const tag of [{ value: '中'.repeat(666667) }, { value: 'ok', descriptor: '中'.repeat(342) },
            { value: 'ok', representation: 'unknown' }, { value: 'ok', fallback: true }, { value: 'ok', tagFormat: 'unknown' }]) {
            expect(() => select([tag])).toThrow();
        }
    });
    it.each(fixture.cases.filter(sample => sample.extension === 'flac'))('reads hidden Vorbis using original file parser: $name', async sample => {
        expect(await fileSelection(Buffer.from(sample.audioBase64, 'base64'))).toEqual(sample.expected);
    });
    it('seeks past large padding without copying padding or reading audio', async () => {
        const sample = fixture.cases.find(entry => entry.name === 'flac-common')!, bytes = Buffer.from(sample.audioBase64, 'base64');
        const head = Buffer.concat([bytes.subarray(0, 42), Buffer.from([1, 255, 255, 255])]);
        const tail = bytes.subarray(42), tailAt = head.length + 0xffffff;
        let total = 0;
        const result = await new Promise(resolve => flacTags(200_000_000, (position, length) => {
            total += length;
            if (position + length <= head.length) return head.subarray(position, position + length).toString('base64');
            if (position >= tailAt && position + length <= tailAt + tail.length) return tail.subarray(position - tailAt, position - tailAt + length).toString('base64');
            throw new Error('Parser read padding or audio');
        }, text => resolve(JSON.parse(text))));
        expect(result).toEqual(sample.expected); expect(total).toBeLessThan(1000);
    });
    it('rejects incomplete metadata, unsafe allocation lengths and excessive Vorbis counts', async () => {
        const bytes = Buffer.from(fixture.cases.find(entry => entry.name === 'flac-common')!.audioBase64, 'base64');
        const count = Buffer.alloc(8); count.writeUInt32LE(0x10000000, 4);
        const hugeCount = Buffer.concat([bytes.subarray(0, 42), Buffer.from([132, 0, 0, 8]), count]);
        const hugeLength = Buffer.concat([bytes.subarray(0, 42), Buffer.from([132, 255, 255, 255])]);
        for (const malformed of [bytes.subarray(0, 50), hugeCount, hugeLength]) {
            expect(await fileSelection(malformed)).toEqual({ error: 'invalid-flac-metadata' });
        }
    });
});
