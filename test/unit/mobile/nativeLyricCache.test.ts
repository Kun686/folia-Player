import { describe, expect, it } from 'vitest';
import { cacheJSON } from '../../../src/utils/lyrics/nativeCacheRuntime';
import { parseLyricsByFormat } from '../../../src/utils/lyrics/parserCore';

// nativeLyricCache.test.ts — full renderer data survives the same document validator used for original .fia files.
const raw = parseLyricsByFormat('lrc', '[00:01.00]你好\n[00:10.00]第二句')!;
const run = (payload: unknown) => JSON.parse(cacheJSON(JSON.stringify({ version: 1, payload })));
describe('shared native lyric document', () => {
  it('preserves original words, translations, ruby, alternate vocals and manual segmentation', () => {
    const lyrics = structuredClone(raw);
    Object.assign(lyrics.lines[0], { translation: 'Hello', romanization: 'ni hao', wordSegments: ['你', '好'],
      alternateTexts: [{ role: 'translation', language: 'en', text: 'Hello' }],
      backgroundVocals: [{ text: '背景', startTime: 1, endTime: 2, words: [{ text: '背景', startTime: 1, endTime: 2 }] }] });
    lyrics.lines[0].words = [{ text: '你好', startTime: 1, endTime: 2, syllables: [{ text: '你', startTime: 1, endTime: 1.5,
      ruby: [{ text: 'ni', startTime: 1, endTime: 1.5 }] }] }];
    const result = run({ lyrics });
    for (const key of ['words', 'translation', 'romanization', 'wordSegments', 'alternateTexts', 'backgroundVocals']) {
      expect(result.payload.lyrics.lines[0][key]).toEqual((lyrics.lines[0] as any)[key]);
    }
    expect(result.lines[0]).toEqual({ startTime: lyrics.lines[0].startTime, endTime: lyrics.lines[0].endTime, fullText: '你好', words: [] });
  });
  it('uses imported selection before an online override and retains the original instrumental verdict', () => {
    const imported = parseLyricsByFormat('lrc', '[00:03.00]导入歌词')!;
    const state = { lyricsSource: 'imported', importedLyrics: imported, hasOnlineOverride: true, onlineOverrideLyrics: raw };
    expect(run({ lyrics: raw, state }).lines[0].fullText).toBe('导入歌词');
    expect(run({ lyrics: raw, state: { lyricsSource: 'online', hasOnlineOverride: true,
      onlineOverrideLyrics: null, matchedIsPureMusic: true } }).lines).toBeNull();
  });
  it('drops top-level provider/session fields and rejects malformed or excessive data', () => {
    const result = run({ lyrics: { ...raw, cookie: 'not-lyrics' }, session: { cookie: 'not-lyrics' },
      state: { lyricsSource: 'online', cookie: 'not-lyrics', matchedSongId: 42 } });
    expect(JSON.stringify(result)).not.toContain('not-lyrics');
    for (const payload of [null, [], { lyrics: { lines: [{}] } }, { state: { lyricsSource: 'unknown' } },
      { lyrics: { lines: Array(2001).fill(raw.lines[0]) } }, { lyrics: { ...raw, title: 'x'.repeat(2_000_001) } }]) {
      expect(() => run(payload)).toThrow();
    }
    expect(run({ lyrics: null }).payload).toEqual({ lyrics: null });
    expect(run({}).payload).toEqual({});
  });
});
