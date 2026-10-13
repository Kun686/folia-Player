import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, OnlineLyricsState, SongResult } from '../../../src/types';
import type { OnlineLyricsStorage } from '../../../src/services/onlineLyricsStorage';
import { importMobileOnlineLyrics, resetMobileOnlineLyrics, scopedLyricStorage, switchMobileOnlineLyrics } from '../../../src/mobile/onlineLyricEditor';
import { matchOnlineLyricSelection } from '../../../src/utils/onlineLyricEdits';
import { resolveOnlineLyrics } from '../../../src/utils/onlineLyricsSelection';

// onlineLyricEditor.test.ts — actual original import parser plus persistence/cancellation semantics at the native boundary.
const api = vi.hoisted(() => ({ getLyrics: vi.fn(), readNavidromeLyrics: vi.fn() }));
vi.mock('@/mobile/bridge', () => ({ native: { readNavidromeLyrics: api.readNavidromeLyrics } }));
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: api }));
vi.mock('../../../src/utils/lyrics/workerClient', async () => {
  const { parseLyricsByFormat } = await import('../../../src/utils/lyrics/parserCore');
  return { parseLyricsAsync: async (...args: Parameters<typeof parseLyricsByFormat>) => parseLyricsByFormat(...args) };
});
const song = { id: 42, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } } as SongResult;
const base: LyricData = { lines: [{ startTime: 0, endTime: 9, fullText: '原始', words: [] }] };
let selected: OnlineLyricsState | null, writes: string[], current: boolean, storage: OnlineLyricsStorage;
beforeEach(() => {
  selected = matchOnlineLyricSelection(null, { lyrics: base, isPureMusic: false }, 'qq-mid', 'qq');
  writes = []; current = true; api.getLyrics.mockReset().mockResolvedValue({ lyrics: base });
  storage = scopedLyricStorage({ isCurrent: () => true, readState: async () => selected, readLyrics: async () => base,
    writeState: async value => { selected = value; writes.push('state'); }, writeLyrics: async () => { writes.push('lyrics'); } }, () => current);
});
describe('mobile original online lyric edits', () => {
  it('imports UTF-16 LRC and switches back without losing the matched or imported source', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[00:00.00]手动歌词\r\n[00:08.00]下一句', 'utf16le')]);
    await importMobileOnlineLyrics(storage, new File([bytes], '歌词.lrc'));
    expect(selected?.importedLyrics?.lines[0].fullText).toBe('手动歌词');
    expect(selected?.matchedLyricsSource).toBe('qq'); expect(selected?.matchedSongId).toBe('qq-mid');
    expect(resolveOnlineLyrics(selected, base)?.lines[0].fullText).toBe('手动歌词');
    await switchMobileOnlineLyrics(storage, 'online'); expect(resolveOnlineLyrics(selected, null)).toEqual(base);
    await switchMobileOnlineLyrics(storage, 'imported'); expect(resolveOnlineLyrics(selected, base)?.lines[0].fullText).toBe('手动歌词');
  });
  it('keeps imported lyrics when a new online match is applied, including an instrumental verdict', async () => {
    await importMobileOnlineLyrics(storage, new File(['[00:00.00]保留'], 'keep.lrc'));
    const next = matchOnlineLyricSelection(selected, { lyrics: null, isPureMusic: true }, 9, 'netease');
    expect(next.importedLyricsName).toBe('keep.lrc'); expect(next.importedLyrics?.lines[0].fullText).toBe('保留');
    expect(resolveOnlineLyrics(next, base)).toBeNull();
  });
  it('restores the owning provider before clearing manual state, without touching the audio queue', async () => {
    await resetMobileOnlineLyrics(storage, song);
    expect(api.getLyrics).toHaveBeenCalledWith(song); expect(writes).toEqual(['lyrics', 'state']);
    expect(selected).toEqual({ lyricsSource: 'online' });
  });
  it('restores Navidrome through native parsing and retains selection on session failure', async () => {
    const scoped: SongResult = { ...song, sourceRef: { kind: 'navidrome', mediaId: 'track', scope: 'scope' } };
    api.readNavidromeLyrics.mockResolvedValue({ payload: { lyrics: base } });
    await resetMobileOnlineLyrics(storage, scoped);
    expect(api.readNavidromeLyrics).toHaveBeenCalledWith({ song: scoped, refresh: true });
    expect(api.getLyrics).not.toHaveBeenCalled(); expect(writes).toEqual(['lyrics', 'state']);
    const saved = selected; writes = [];
    api.readNavidromeLyrics.mockRejectedValue(new Error('navidrome-settings-changed'));
    await expect(resetMobileOnlineLyrics(storage, scoped)).rejects.toThrow('navidrome-settings-changed');
    expect(selected).toBe(saved); expect(writes).toEqual([]);
  });
  it('preserves selections if the original provider fails or persistence rejects a write', async () => {
    const original = selected; api.getLyrics.mockRejectedValue(new Error('offline'));
    await expect(resetMobileOnlineLyrics(storage, song)).rejects.toThrow('offline');
    expect(writes).toEqual([]); expect(selected).toBe(original);
    storage.writeState = vi.fn().mockRejectedValue(new Error('disk-full'));
    await expect(switchMobileOnlineLyrics(storage, 'online')).rejects.toThrow('disk-full');
    expect(selected).toBe(original);
  });
  it('rejects missing/empty/oversize files without overwriting state', async () => {
    selected = null;
    await expect(switchMobileOnlineLyrics(storage, 'imported')).rejects.toThrow('missing-imported-lyrics');
    await expect(importMobileOnlineLyrics(storage, new File([], 'empty.lrc'))).rejects.toThrow('invalid-lyrics');
    await expect(importMobileOnlineLyrics(storage, new File(['x'.repeat(2_000_001)], 'big.lrc'))).rejects.toThrow('lyrics-too-large');
    expect(writes).toEqual([]);
  });
  it('discards a late restore after the dialog closes, the song changes, or the account expires', async () => {
    let finish!: (value: unknown) => void;
    api.getLyrics.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const task = resetMobileOnlineLyrics(storage, song);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    current = false; finish({ lyrics: base });
    await expect(task).rejects.toMatchObject({ name: 'AbortError' }); expect(writes).toEqual([]);
  });
});
