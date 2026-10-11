import { describe, expect, it, vi } from 'vitest';
import { buildLocalMatchDocument, localMatchTarget } from '@/utils/localMatchDocument';
import { localMatchJSON } from '@/utils/lyrics/nativeLocalMatchRuntime';
import { sourcesJSON } from '@/utils/lyrics/nativeLocalRuntime';
import { localLyricsFromSnapshot } from '@/utils/lyrics/localLyricSnapshot';
import { resolveLocalSongLyrics } from '@/utils/lyrics/localSongLyrics';
import type { LocalMatchSnapshot } from '@/types/localSongMatch';
import type { ApplyLocalSongMatchSelectionInput } from '@/utils/localSongMatchSelection';

// localMatch.test.ts — matching preserves imported assets and shares source semantics with the background parser.
vi.mock('@/utils/lyrics/workerClient', async () => {
  const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
  return { parseLyricsAsync: (...args: Parameters<typeof parseLyricsByFormat>) => Promise.resolve(parseLyricsByFormat(...args)) };
});
const snapshot: LocalMatchSnapshot = {
  base: { id: 'local-id', name: 'Original title', artists: [{ id: '', name: 'Original artist' }],
    album: { id: '', name: 'Original album' }, durationMs: 180000, sourceRef: { kind: 'local', mediaId: 'local-id' } },
  fileName: 'original.m4a', lyrics: { token: 'token', content: '[00:01.00]Imported', embeddedContent: '[00:01.00]Embedded' },
};
const lyrics = { lines: [{ startTime: 1, endTime: 3, fullText: 'Matched', words: [] }] };
const input: ApplyLocalSongMatchSelectionInput = {
  songId: 'local-id', metadata: 'online', cover: 'online', lyrics: 'online',
  candidate: { durationMs: 180000, score: 100, titleMatched: true, durationMatched: true, raw: snapshot.base, source: 'qq', songId: 42, title: 'Online title', artists: [{ id: 5, name: ' Online artist ' }],
    album: { id: 8, name: 'Online album' }, coverUrl: 'https://example.invalid/cover.jpg' },
  onlineLyrics: { source: 'qq', songId: 42, isPureMusic: false, lyrics },
};
const nextSnapshot = (): LocalMatchSnapshot => {
  const next = buildLocalMatchDocument(snapshot, input);
  return { ...snapshot, document: next.document, lyrics: { ...snapshot.lyrics, matched: next.document, lyricsSource: 'online' } };
};
describe('native local match', () => {
  it('stores normalized metadata and the selected provider without changing the imported snapshot', () => {
    const before = structuredClone(snapshot), next = buildLocalMatchDocument(snapshot, input);
    expect(snapshot).toEqual(before);
    expect(next.source).toBe('online');
    expect(next.document).toMatchObject({ title: 'Online title', titleOrigin: 'manual-match', artistNames: ['Online artist'],
      albumName: 'Online album', useOnlineCover: true, matchedLyricsSongId: 42, matchedLyricsSource: 'qq' });
    expect(JSON.parse(localMatchJSON(JSON.stringify(next.document)))).toMatchObject(JSON.parse(JSON.stringify(next.document)));
  });
  it('lyrics and online cover can be selected while retaining imported metadata', () => {
    const next = buildLocalMatchDocument(snapshot, { ...input, metadata: 'imported' });
    expect(next.document).toMatchObject({ title: 'Original title', artistNames: ['Original artist'],
      useOnlineCover: true, onlineMetadata: { source: 'qq', songId: 42 }, matchedLyrics: lyrics });
  });
  it('restore imported information retains independent lyric payloads and disables the online cover', () => {
    const saved = nextSnapshot();
    const next = buildLocalMatchDocument(saved, { songId: 'local-id', metadata: 'imported', cover: 'embedded',
      lyrics: 'automatic', setNoAutoMatch: true });
    expect(next).toMatchObject({ source: null, document: { title: 'Original title', titleOrigin: 'import',
      artistNames: ['Original artist'], albumName: 'Original album', useOnlineCover: false, noAutoMatch: true,
      hasManualLyricSelection: false, matchedLyrics: lyrics } });
    expect(saved.lyrics.content).toBe(snapshot.lyrics.content);
    expect(localMatchTarget({ ...saved, document: next.document }).importedMetadata.title).toBe('Original title');
  });
  it('missing artist/album and failed lyric fetch preserve previous selections', () => {
    const saved = nextSnapshot();
    const next = buildLocalMatchDocument(saved, { ...input, candidate: { ...input.candidate!, source: 'netease', songId: 42,
      title: 'New title', artists: [], album: undefined }, onlineLyrics: undefined, lyricsFailed: true });
    expect(next.document).toMatchObject({ title: 'New title', artistNames: ['Online artist'], albumName: 'Online album',
      matchedLyricsSource: 'qq', matchedLyricsSongId: 42 });
    expect(next.source).toBe('online');
  });
  it.each(['online', 'local', 'embedded', undefined] as const)('frontend/native source selection agree: %s', async source => {
    const saved = nextSnapshot(), selected = { ...saved.lyrics, lyricsSource: source };
    const original = await resolveLocalSongLyrics(localLyricsFromSnapshot(selected), 'local');
    const native = JSON.parse(sourcesJSON(JSON.stringify({ version: 1, snapshot: selected })));
    expect(native).toEqual(original.lyrics?.lines.map(({ startTime, endTime, fullText }) => ({ startTime, endTime, fullText, words: [] })));
  });
  it('a pure music match suppresses imported/embedded lyrics in both parsers', async () => {
    const next = buildLocalMatchDocument(snapshot, { ...input, onlineLyrics: { ...input.onlineLyrics!, isPureMusic: true, lyrics: { lines: [] } } });
    const selected = { ...snapshot.lyrics, matched: next.document, lyricsSource: 'online' as const };
    const original = await resolveLocalSongLyrics(localLyricsFromSnapshot(selected), 'local');
    expect(original.source).toBe('online');
    expect(original.lyrics?.lines).toEqual([]);
    expect(JSON.parse(sourcesJSON(JSON.stringify({ version: 1, snapshot: selected })))).toEqual([]);
    expect(() => localMatchJSON(JSON.stringify(next.document))).not.toThrow();
  });
  it('rejects mismatched identity and malformed or unbounded persisted fields', () => {
    expect(() => buildLocalMatchDocument(snapshot, { ...input, songId: 'other' })).toThrow();
    const doc = buildLocalMatchDocument(snapshot, input).document;
    for (const patch of [{ title: 1 }, { title: 'x'.repeat(513) }, { titleOrigin: 'other' },
      { artistNames: Array(101).fill('x') }, { matchedLyricsSource: 'other' }, { matchedLyrics: { lines: [{}] } },
      { matchedLyricsSongId: 1.5 }, { onlineMetadata: { ...doc.onlineMetadata, source: 'other' } }]) {
      expect(() => localMatchJSON(JSON.stringify({ ...doc, ...patch }))).toThrow();
    }
  });
});
