import { describe, expect, it, vi } from 'vitest';
import { createAutoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyricCore';
import type { AutoMatchLyricPorts } from '@/utils/lyrics/autoMatchBestLyricTypes';
import type { LyricProviderSource, SongResult } from '@/types';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';

// lyricMatchCore.test.ts — host injection, bounded I/O contracts and concurrent invocation isolation.
const word = parseLyricsByFormat('yrc', '[1000,2000](1000,1000,0)Shared(2000,1000,0) lyric')!;
const line = parseLyricsByFormat('lrc', '[00:01.00]Shared lyric\n[00:03.00]Next lyric')!;
const song = (id: string | number, name = 'Portable song'): SongResult => ({
  id, name, artists: [{ id: 1, name: 'Portable artist' }], album: { id: 2, name: 'Portable album' },
  durationMs: 180000, ...(typeof id === 'string' ? { qqMid: id, kgHash: id } : {}),
});
function ports() {
  const deadlines: number[] = [];
  return {
    deadlines,
    searchSongs: vi.fn<AutoMatchLyricPorts['searchSongs']>(async provider => ({ items: [song(provider === 'netease' ? 42 : 'HASH')], hasMore: false, nextOffset: 1 })),
    getLyrics: vi.fn<AutoMatchLyricPorts['getLyrics']>(async () => ({ lyrics: word, isPureMusic: false })),
    getChorusRanges: vi.fn<AutoMatchLyricPorts['getChorusRanges']>(async () => []),
    searchQQ: vi.fn<AutoMatchLyricPorts['searchQQ']>(async () => [song('mid42')]),
    fetchQQ: vi.fn<AutoMatchLyricPorts['fetchQQ']>(async () => word),
    fetchAmll: vi.fn<AutoMatchLyricPorts['fetchAmll']>(async () => word),
    withTimeout: async <T,>(pending: Promise<T>, ms: number, _label: string, _fallback: T) => { deadlines.push(ms); return pending; },
  };
}
const run = (io: AutoMatchLyricPorts, preferredSource?: LyricProviderSource) =>
  createAutoMatchBestLyric(io)('Portable song', 'Portable artist', 180000, { preferredSource, album: 'Portable album' });

describe('portable original lyric matcher', () => {
  it.each(['qq', 'netease', 'amll', 'kugou'] as const)('retains the %s preference through injected transports', async source => {
    const io = ports();
    expect(await run(io, source)).toMatchObject({ source, lyrics: expect.objectContaining({ isWordByWord: true }) });
    if (source !== 'qq') expect(io.searchQQ).not.toHaveBeenCalled();
    if (source === 'qq') expect(io.searchSongs).not.toHaveBeenCalled();
  });

  it('keeps a provider baseline without fetching it again and still prefers another word-level source', async () => {
    const io = ports();
    const result = await createAutoMatchBestLyric(io)('Portable song', 'Portable artist', 180000, {
      preferredSource: 'netease', providerCandidate: { providerId: 'netease', song: song(42),
        lyricsResult: { lyrics: line, isPureMusic: false } },
    });
    expect(result).toMatchObject({ source: 'amll', id: 42 });
    expect(io.searchSongs).not.toHaveBeenCalled(); expect(io.getLyrics).not.toHaveBeenCalled();
    expect(io.fetchAmll).toHaveBeenCalledWith('ncm', ['42']);
  });

  it('falls back after a host I/O failure without converting a pure-music reply into lyrics', async () => {
    const io = ports(); io.searchQQ.mockRejectedValue(new Error('fixture-network-error'));
    io.getLyrics.mockResolvedValue({ lyrics: null, isPureMusic: true });
    expect(await run(io)).toEqual({ isPureMusic: true, source: 'netease', id: 42 });
    expect(io.fetchAmll).not.toHaveBeenCalled();
  });

  it('keeps both overlapping requests in one matcher isolated', async () => {
    const io = ports(); const pending = new Map<string, (value: SongResult[]) => void>();
    io.searchQQ.mockImplementation(query => new Promise(resolve => { pending.set(query, resolve); }));
    const match = createAutoMatchBestLyric(io);
    const first = match('First song', 'Portable artist', 180000);
    const second = match('Second song', 'Portable artist', 180000);
    expect(pending.size).toBe(2);
    [...pending].find(([key]) => key.includes('Second song'))![1]([song('second-mid', 'Second song')]);
    expect(await second).toMatchObject({ source: 'qq', id: 'second-mid' });
    [...pending].find(([key]) => key.includes('First song'))![1]([song('first-mid', 'First song')]);
    expect(await first).toMatchObject({ source: 'qq', id: 'first-mid' });
    expect(io.fetchQQ.mock.calls.map(([value]) => value.id)).toEqual(['second-mid', 'first-mid']);
  });

  it('does not share source state across independent host instances', async () => {
    const left = ports(), right = ports();
    left.fetchQQ.mockResolvedValue(line); right.fetchQQ.mockResolvedValue(word);
    left.fetchAmll.mockResolvedValue(null); left.getLyrics.mockResolvedValue({ lyrics: line, isPureMusic: false });
    const [a, b] = await Promise.all([run(left), run(right)]);
    expect(a).toMatchObject({ source: 'qq', lyrics: { isWordByWord: false } });
    expect(b).toMatchObject({ source: 'qq', lyrics: { isWordByWord: true } });
    expect(right.fetchAmll).not.toHaveBeenCalled();
  });

  it('retains exact metadata matching and the original search and lyric deadline values', async () => {
    const io = ports(); io.fetchQQ.mockResolvedValue(line);
    const result = await createAutoMatchBestLyric(io)('Portable song', 'Portable artist', 180000, {
      metadataCandidate: { source: 'qq', songId: 'mid42' }, exactMatchOnly: true,
    });
    expect(result).toMatchObject({ source: 'qq', lyrics: { isWordByWord: false } });
    expect(io.searchQQ).toHaveBeenCalledWith('Portable song - Portable artist', 1, 10);
    expect(io.deadlines).toEqual([3500, 5000]);
    expect(io.fetchAmll).not.toHaveBeenCalled(); expect(io.searchSongs).not.toHaveBeenCalled();
  });

  it('passes both QQ identifiers and the corresponding combined deadline to AMLL', async () => {
    const io = ports(); io.searchQQ.mockResolvedValue([{ ...song(42), qqMid: 'mid42' }]);
    const result = await createAutoMatchBestLyric(io)('Portable song', 'Portable artist', 180000, {
      preferredSource: 'amll', metadataCandidate: { source: 'qq', songId: 'mid42' },
    });
    expect(result).toMatchObject({ source: 'amll', matchedLyricsProviderPlatform: 'qq', id: 42 });
    expect(io.fetchAmll).toHaveBeenCalledWith('qq', ['mid42', '42']);
    expect(io.deadlines).toEqual([3500, 10000]);
  });

  it('never takes the eleventh search result or a different artist as a fallback identity', async () => {
    const io = ports(); io.fetchAmll.mockResolvedValue(null);
    const wrong = { ...song('wrong'), artists: [{ id: 9, name: 'ZZZZZZZZZZ' }], album: { id: 8, name: '' } };
    io.searchQQ.mockResolvedValue([...Array.from({ length: 10 }, () => wrong), song('eleventh')]);
    io.searchSongs.mockResolvedValue({ items: [wrong], hasMore: false, nextOffset: 1 });
    expect(await run(io)).toBeNull();
    expect(io.fetchQQ).not.toHaveBeenCalled(); expect(io.getLyrics).not.toHaveBeenCalled();
  });
});
