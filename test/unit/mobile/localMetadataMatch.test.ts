import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalMatchSnapshot } from '@/types/localSongMatch';
import { mobileMetadataServices, metadataSong } from '@/mobile/localMetadataMatch';

// localMetadataMatch.test.ts — original batch policy with controlled Omni and native persistence; no platform acceptance.
const state = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), search: vi.fn(), current: true, flush: vi.fn() }));
vi.mock('@/mobile/bridge', () => ({ native: { readLocalMatch: state.read, writeLocalMatch: state.write } }));
vi.mock('@/mobile/runtime', () => ({ captureProviderSession: () => () => state.current, flushSessions: state.flush }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { searchProviderSongs: state.search } }));
const snapshot = (id = 'a'): LocalMatchSnapshot => ({
  base: { id, name: 'Song ' + id, artists: [{ id: '', name: 'Artist' }], album: { id: '', name: 'Album' },
    durationMs: 180000, sourceRef: { kind: 'local', mediaId: id } }, fileName: id + '.m4a',
  lyrics: { token: 'lyric-' + id, content: '[00:01.00]Keep this lyric', lyricsSource: 'local' },
  libraryRevision: 'same-before-batch', contextToken: 'context-' + id, sessionToken: 'session', hasLocalCover: true,
});
const candidate = (id: string) => ({ ...snapshot(id).base, sourceRef: { kind: 'online' as const, providerId: 'qq', mediaId: id },
  album: { id: 'album', name: 'Album', coverUrl: 'https://example.invalid/cover.jpg' } });
const services = () => mobileMetadataServices(['netease', 'qq'], () => true);
beforeEach(() => {
  vi.clearAllMocks(); state.current = true; state.flush.mockResolvedValue(undefined);
  state.read.mockImplementation(async ({ id, online }) => ({ ...snapshot(id), sessionToken: online ? 'session' : undefined }));
  state.write.mockResolvedValue({ coverCached: true });
  state.search.mockImplementation(async (provider, query) => ({ items: provider === 'qq' ? [candidate(query.includes('Song b') ? 'b' : 'a')] : [] }));
});
describe('native folder metadata matching', () => {
  it('uses original fallback, preserves local cover/lyrics and passes independent song receipts for both workers', async () => {
    const result = await services().batch(['a', 'b'].map(id => metadataSong(snapshot(id))));
    expect(result.updates.map(item => item.status)).toEqual(['matched', 'matched']);
    expect(state.search.mock.calls.map(call => call[0])).toEqual(['netease', 'netease', 'qq', 'qq']);
    expect(state.write.mock.calls.map(([call]) => call.contextToken).sort()).toEqual(['context-a', 'context-b']);
    for (const [call] of state.write.mock.calls) {
      expect(call).toMatchObject({ sessionToken: 'session', libraryRevision: 'same-before-batch', metadata: 'online',
        source: 'local', cacheCover: false, protectOrigins: ['manual', 'manual-match', 'split'] });
      expect(call.document.matchedLyrics).toBeUndefined();
    }
  });
  it('skips noAutoMatch and fails closed when a native song/session receipt is missing', async () => {
    const song = metadataSong(snapshot()); song.noAutoMatch = true;
    expect((await services().batch([song])).updates[0].status).toBe('skipped');
    expect(state.read).not.toHaveBeenCalled();
    state.read.mockResolvedValue({ ...snapshot(), contextToken: undefined });
    expect((await services().batch([metadataSong(snapshot())])).updates[0].status).toBe('failed');
    expect(state.write).not.toHaveBeenCalled();
  });
  it('cancelled search discards a late result and never starts a commit', async () => {
    let resolve!: (page: unknown) => void;
    state.search.mockImplementation(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const batch = services().batch([metadataSong(snapshot())], { signal: controller.signal });
    await vi.waitFor(() => expect(state.search).toHaveBeenCalled());
    controller.abort();
    expect(await batch).toEqual({ updates: [], cancelled: true });
    resolve({ items: [candidate('a')] });
    await Promise.resolve();
    expect(state.write).not.toHaveBeenCalled();
  });
  it('reports a completed atomic save if cancel arrives during commit; starts no following song', async () => {
    let finish!: (value: unknown) => void;
    state.write.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const batch = services().batch(['a', 'b'].map(id => metadataSong(snapshot(id))), { signal: controller.signal, concurrency: 1 });
    await vi.waitFor(() => expect(state.write).toHaveBeenCalledTimes(1));
    controller.abort(); finish({ coverCached: true });
    expect(await batch).toMatchObject({ cancelled: true, updates: [{ songId: 'a', status: 'matched' }] });
    expect(state.read).toHaveBeenCalledTimes(1);
  });
  it('rejects account replacement and relevant native edit conflicts instead of retrying stale data', async () => {
    state.search.mockImplementation(async () => { state.current = false; return { items: [candidate('a')] }; });
    expect((await services().batch([metadataSong(snapshot())])).updates[0].status).toBe('failed');
    expect(state.write).not.toHaveBeenCalled();
    state.current = true;
    state.search.mockResolvedValue({ items: [candidate('a')] });
    state.write.mockRejectedValue(new Error('local-library-changed'));
    expect((await services().batch([metadataSong(snapshot())])).updates[0].status).toBe('failed');
    expect(state.write).toHaveBeenCalledTimes(1);
  });
  it('partial cover failures retain metadata success and restoration works without an online session', async () => {
    state.read.mockImplementation(async ({ id, online }) => ({ ...snapshot(id), hasLocalCover: false, sessionToken: online ? 'session' : undefined }));
    state.write.mockResolvedValue({ coverCached: false });
    expect((await services().batch([metadataSong(snapshot())])).updates[0].status).toBe('matched-cover-failed');
    state.current = false;
    await services().restore('a');
    expect(state.write.mock.lastCall?.[0]).toMatchObject({ metadata: 'imported', source: null, sessionToken: undefined,
      document: { title: 'Song a', titleOrigin: 'import', noAutoMatch: true, useOnlineCover: false } });
  });
});
