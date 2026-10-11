import { describe, expect, it } from 'vitest';
import { parseBlob } from 'music-metadata';
import { selectEmbeddedLyrics } from '@/utils/lyrics/embeddedMetadataSelection';
import { embeddedTagsJSON } from '@/utils/lyrics/nativeEmbeddedRuntime';

// embeddedMetadata.test.ts — preserve desktop ranking and compare actual ID3 parsing with native tag transport.
const original = '[00:00.00]Original\n[00:01.00]End';
const translation = '[00:00.00]译文\n[00:01.00]结束';
const enhanced = '[00:00.00]<00:00.00>Original<00:00.60> lyric\n[00:01.00]End';
const selectNative = (tags: unknown[]) => JSON.parse(embeddedTagsJSON(JSON.stringify({ version: 1, tags })));
const syncSafe = (value: number) => [(value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127];
const tags = [
    { language: 'eng', descriptor: 'plain', value: 'Untimed fallback' },
    { language: 'zho', descriptor: 'translation', value: translation },
    { language: 'eng', descriptor: 'original', value: enhanced },
];

describe('original embedded metadata candidate selection', () => {
    it('prefers timed originals, enhanced timing and a distinct translation', () => {
        expect(selectNative([{ value: original }, ...tags, { value: enhanced }])).toEqual({ lyrics: enhanced, translationLyrics: translation });
    });
    it('normalizes duplicates and never duplicates a sole Chinese track as its translation', () => {
        expect(selectEmbeddedLyrics([{ language: 'CHI', text: translation.replace(/\n/g, '\r\n') + '\n' },
            { language: 'eng', value: translation }])).toEqual({ lyrics: translation, translationLyrics: undefined });
    });
    it.each(['translation', 'translated', '译文'])('uses the original descriptor hint %s', descriptor => {
        expect(selectNative([{ value: original }, { value: translation, descriptor }])).toEqual({ lyrics: original, translationLyrics: translation });
    });
    it('retains common-tag precedence and only falls back to lyric native tags', () => {
        const native = { ID3: [{ id: 'TITLE', value: 'Not lyrics' }, { id: 'SYLT', value: { timeStampFormat: 2,
            syncText: [{ timestamp: 1250, text: 'Synchronized' }] } }] };
        expect(selectEmbeddedLyrics([], native).lyrics).toBe('[00:01.25]Synchronized');
        expect(selectEmbeddedLyrics([{ text: original }], native).lyrics).toBe(original);
        expect(selectEmbeddedLyrics([], { ID3: [{ id: 'SYLT', syncText: [{ timestamp: 1, text: 'Frame time unsupported' }], timeStampFormat: 1 }] }).lyrics).toBeUndefined();
    });
    it('matches the installed music-metadata parser on a real multi-USLT MP3', async () => {
        const encoder = new TextEncoder();
        const frames = tags.flatMap(tag => {
            const payload = [3, ...encoder.encode(tag.language), ...encoder.encode(tag.descriptor), 0, ...encoder.encode(tag.value)];
            return [...encoder.encode('USLT'), ...syncSafe(payload.length), 0, 0, ...payload];
        });
        const audio = Array.from({ length: 80 }, () => [255, 251, 144, 100, ...new Array<number>(413).fill(0)]).flat();
        const file = new Blob([new Uint8Array([73, 68, 51, 4, 0, 0, ...syncSafe(frames.length), ...frames, ...audio])]);
        const parsed = await parseBlob(file);
        expect(parsed.common.lyrics).toHaveLength(3);
        expect(selectEmbeddedLyrics(parsed.common.lyrics!, parsed.native)).toEqual(selectNative(tags));
    });
    it('rejects malformed or excessive native requests', () => {
        for (const bad of [null, { value: 123 }, { value: original, language: [] },
            { value: original, descriptor: 'x'.repeat(1025) }, { value: 'x'.repeat(2_000_001) }]) {
            expect(() => selectNative([bad])).toThrow();
        }
        expect(() => selectNative(new Array(65).fill({ value: original }))).toThrow();
        expect(() => selectNative(new Array(3).fill({ value: 'x'.repeat(1_400_000) }))).toThrow();
        expect(() => embeddedTagsJSON('{')).toThrow();
        expect(() => embeddedTagsJSON(JSON.stringify({ version: 2, tags: [] }))).toThrow();
    });
});
