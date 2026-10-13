import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBlob } from 'music-metadata';
import { vorbisMetadataJSON } from '@/utils/lyrics/nativeVorbisMetadata';
import { selectEmbeddedLyrics } from '@/utils/lyrics/embeddedMetadataSelection';

// nativeVorbisMetadata.test.ts — identical real Ogg comments normalized by the original parser and native bridge runtime.
const parse = (comments: unknown) => new Promise<Record<string, any>>(resolve =>
  vorbisMetadataJSON(JSON.stringify({ version: 1, comments }), result => resolve(JSON.parse(result))));
describe('native Vorbis metadata', () => {
  it('matches actual Ogg tags, repeated artists, lyrics, track numbers and ReplayGain', async () => {
    const bytes = readFileSync(new URL('../../../ios/App/NativeTests/VorbisFixture.ogg', import.meta.url));
    const original = await parseBlob(new Blob([bytes]));
    const comments = original.native.vorbis.map(tag => `${tag.id}=${tag.value}`);
    expect(original.format.duration).toBe(8);
    expect(await parse(comments)).toEqual({ title: original.common.title, artists: original.common.artists,
      album: original.common.album, trackNumber: original.common.track.no, discNumber: original.common.disk.no,
      ...selectEmbeddedLyrics(original.common.lyrics ?? [], original.native),
      replayGain: { trackGain: original.common.replaygain_track_gain?.dB } });
  });
  it('preserves equals inside lyrics and ignores unknown comments without inventing metadata', async () => {
    expect(await parse(['TITLE=Equal = title', 'LYRICS=[00:00]a=b', 'UNKNOWN=opaque'])).toMatchObject({ title: 'Equal = title', lyrics: '[00:00]a=b' });
    expect(await parse([])).toEqual({ artists: [], replayGain: {} });
  });
  it('uses the original picture token without requiring browser globals', async () => {
    const word = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const picture = Buffer.from([1, 2, 3]), mime = Buffer.from('image/png');
    const value = Buffer.concat([word(3), word(mime.length), mime, word(0), word(1), word(1), word(24), word(0), word(picture.length), picture]);
    const saved = globalThis.atob;
    try {
      globalThis.atob = undefined as any;
      expect(await parse(['METADATA_BLOCK_PICTURE=' + value.toString('base64')])).toMatchObject({ cover: picture.toString('base64') });
    } finally { globalThis.atob = saved; }
  });
  it('rejects excessive, malformed and nontext comments and then recovers', async () => {
    for (const comments of [null, [1], Array(4097).fill('TITLE=a'), ['TITLE=' + 'x'.repeat(8_000_001)],
      ['METADATA_BLOCK_PICTURE=AA=='], ['LYRICS=' + 'x'.repeat(2_000_001)]]) {
      expect(await parse(comments), `Invalid input: ${Array.isArray(comments) ? String(comments[0]).slice(0, 40) : 'null'}`).toEqual({ error: 'invalid-local-metadata' });
    }
    expect(await parse(['TITLE=Recovered'])).toMatchObject({ title: 'Recovered' });
  });
});
