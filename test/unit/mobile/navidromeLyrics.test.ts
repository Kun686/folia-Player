import { describe, expect, it, vi } from 'vitest';
import { navidromeStepJSON } from '@/utils/lyrics/nativeNavidromeRuntime';
import { resolvePreferredNavidromeLyrics } from '@/utils/appNavidromeLyrics';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';

// navidromeLyrics.test.ts — native request replay shares desktop selection, word timing and translations.
vi.mock('@/utils/lyrics/workerClient', () => ({ parseLyricsAsync: async (...args: Parameters<typeof parseLyricsByFormat>) => parseLyricsByFormat(...args) }));
const song = { name: 'Song', artists: [{ id: 'artist', name: 'Artist' }], sourceRef: { kind: 'navidrome', mediaId: 'one' } };
const structured = [
  { kind: 'main', synced: true, line: [{ start: 1000, value: 'Hello world' }], cueLine: [
    { index: 0, start: 1000, end: 2500, value: 'Hello world', cue: [{ start: 1000, end: 1600, value: 'Hello ' }, { start: 1600, end: 2500, value: 'world' }] },
  ] },
  { kind: 'translation', synced: true, line: [{ start: 1000, value: '你好世界' }] },
];
const step = (responses: unknown[], inputSong: unknown = song): Promise<any> => new Promise(resolve => navidromeStepJSON(JSON.stringify({ version: 1, song: inputSong, responses }), value => resolve(JSON.parse(value))));
const reply = (operation: string, parameters: Record<string, string>, body: object | null) => ({ operation, parameters, response: body && { 'subsonic-response': { status: 'ok', ...body } } });
const first = (value: unknown) => reply('getLyricsBySongId', { id: 'one', enhanced: 'true' }, { lyricsList: { structuredLyrics: value } });
describe('native Navidrome lyric selection', () => {
  it('asks native for the original structured endpoint without credentials', async () => {
    expect(await step([])).toEqual({ request: { operation: 'getLyricsBySongId', parameters: { id: 'one', enhanced: 'true' } } });
  });
  it('preserves enhanced word timing and translation exactly like desktop', async () => {
    const result = await step([first(structured)]);
    expect(result.lyrics).toEqual(JSON.parse(JSON.stringify(await resolvePreferredNavidromeLyrics({ cachedStructuredLyrics: structured }))));
    expect(result.lyrics.lines[0]).toMatchObject({ fullText: 'Hello world', startTime: 1, translation: '你好世界', words: [{ startTime: 1 }, { startTime: 1.6 }] });
    expect(result.request).toBeUndefined();
  });
  it('prefers plain lyrics over line-only structured results', async () => {
    const lineOnly = [{ synced: true, line: [{ start: 1000, value: 'Old structured' }] }];
    const responses = [first(lineOnly)];
    expect(await step(responses)).toEqual({ request: { operation: 'getLyrics', parameters: { artist: 'Artist', title: 'Song' } } });
    const result = await step([...responses, reply('getLyrics', { title: 'Song', artist: 'Artist' }, { lyrics: { value: '[00:01.00]Preferred plain\n[00:03.00]Next' } })]);
    expect(result.lyrics.lines[0].fullText).toBe('Preferred plain');
  });
  it('falls back to structured when plain lyrics are absent', async () => {
    const result = await step([first([{ synced: true, line: [{ start: 1000, value: 'Retained' }] }]), reply('getLyrics', { artist: 'Artist', title: 'Song' }, {})]);
    expect(result.lyrics.lines[0].fullText).toBe('Retained');
  });
  it('supports absent optional endpoint and instrumental songs', async () => {
    const result = await step([reply('getLyricsBySongId', { id: 'one', enhanced: 'true' }, null), reply('getLyrics', { artist: 'Artist', title: 'Song' }, {})]);
    expect(result).toEqual({ lyrics: null, lines: null });
  });
  it('rejects a mismatched, extra or malformed replay', async () => {
    for (const responses of [[{ operation: 'getSong' }], [first(structured), first(structured)], [first('malformed')]]) {
      expect(await step(responses)).toEqual({ error: 'invalid-navidrome-lyrics' });
    }
  });
});
