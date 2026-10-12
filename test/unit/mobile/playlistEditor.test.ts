import { describe, expect, it, vi } from 'vitest';
import { createMobilePlaylistEditor } from '../../../src/mobile/mobilePlaylistEditor';
import { createOnlineCollectionResource } from '../../../src/library/core/services/onlineCollectionResource';
import { formatEntryKey } from '../../../src/library/core/model/collectionEntries';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import type { omni } from '../../../src/services/onlineMusic/omni';
import type { SongResult } from '../../../src/types';

// playlistEditor.test.ts — confirmed writes, account boundaries, original authoritative resource removal and dismissal.
const song: SongResult = { id: 42, name: 'Song', artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000,
  sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } };
const list = { id: 8, providerId: 'netease', name: 'Owned', type: 'playlist', creator: { id: 9, nickname: 'User' } };
const user = { id: 9, nickname: 'User' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let epoch = 0;
  const api = { getLoginStatus: vi.fn().mockResolvedValue(user), canEditCollectionTracks: vi.fn().mockReturnValue(true),
    canAddSongToPlaylist: vi.fn().mockReturnValue(true), updateCollectionTracks: vi.fn().mockResolvedValue(undefined), likeSong: vi.fn().mockResolvedValue(undefined) };
  const removeCache = vi.fn().mockResolvedValue(undefined), changed = vi.fn();
  const editor = createMobilePlaylistEditor(api as unknown as typeof omni, () => { const ticket = epoch; return () => ticket === epoch; },
    async () => {}, removeCache, changed);
  return { api, removeCache, changed, editor, invalidate: () => epoch++ };
}
async function resource() {
  const current = createOnlineCollectionResource('test', {
    readCache: async () => ({ tracks: [], snapshotTime: 0, schemaVersion: 0 }), writeCache: vi.fn().mockResolvedValue(undefined),
    getCollectionTracks: async () => ({ items: [song], hasMore: false, nextOffset: 1 }), getCollectionDetail: async () => list,
    getPersonalFm: async () => [], getDailySongs: async () => [],
  });
  current.ensure({ ...list, source: 'online' }, {});
  await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
  return current;
}
describe('mobile online playlist editor', () => {
  it('uses original ownership rules and rejects foreign songs and collections before writing', async () => {
    const { editor, api } = fixture(), account = await editor.readAccount('netease');
    expect(editor.canEdit(list, user)).toBe(true);
    expect(editor.canEdit({ ...list, creator: { id: 10, nickname: 'Other' } }, user)).toBe(false);
    expect(editor.canEdit({ ...list, type: 'album' }, user)).toBe(false);
    await expect(editor.add({ ...song, sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } }, list, account)).rejects.toThrow('wrong-provider');
    await expect(editor.add(song, { ...list, creator: { id: 10, nickname: 'Other' } }, account)).rejects.toThrow();
    expect(api.updateCollectionTracks).not.toHaveBeenCalled();
  });
  it('serializes writes across dismissed sessions and holds new readers until completion', async () => {
    const { editor, api, changed, removeCache } = fixture(), account = await editor.readAccount('netease');
    const pending = deferred(); api.updateCollectionTracks.mockReturnValueOnce(pending.promise);
    const saving = editor.add(song, list, account); await vi.waitFor(() => expect(api.updateCollectionTracks).toHaveBeenCalledTimes(1));
    await expect(editor.add(song, list, account)).rejects.toThrow('playlist-busy');
    let read = false; const reading = editor.readAccount('netease').then(() => { read = true; });
    await Promise.resolve(); expect(read).toBe(false);
    pending.resolve(); await saving; await reading;
    expect(changed).toHaveBeenCalledOnce(); expect(removeCache).toHaveBeenCalledTimes(2);
  });
  it('rechecks login before sending and rejects stale credentials without touching the service', async () => {
    const { editor, api, invalidate } = fixture(), account = await editor.readAccount('netease');
    api.getLoginStatus.mockResolvedValueOnce({ id: 10 });
    await expect(editor.add(song, list, account)).rejects.toThrow();
    invalidate(); await expect(editor.add(song, list, account)).rejects.toThrow();
    expect(api.updateCollectionTracks).not.toHaveBeenCalled();
  });
  it('keeps original resource rows after a rejected removal and commits only confirmed success', async () => {
    const { editor, api } = fixture(), account = await editor.readAccount('netease'), current = await resource();
    const controller = editor.removals(list, current, account), entry = { track: song, entryKey: formatEntryKey(getPlaybackSongKey(song), 0) };
    api.updateCollectionTracks.mockRejectedValueOnce(new Error('sensitive upstream payload'));
    expect(await controller.removeEntry(entry)).toMatchObject({ ok: false });
    expect(current.getSnapshot().tracks).toEqual([song]);
    const pending = deferred(); api.updateCollectionTracks.mockReturnValueOnce(pending.promise);
    const removing = controller.removeEntry(entry); await vi.waitFor(() => expect(api.updateCollectionTracks).toHaveBeenCalledTimes(2));
    expect(current.getSnapshot().tracks).toEqual([song]);
    expect(await controller.removeEntry(entry)).toMatchObject({ ok: false, reason: 'busy' });
    controller.dispose(); pending.resolve(); expect(await removing).toEqual({ ok: true });
    expect(current.getSnapshot().tracks).toEqual([]); current.dispose();
  });
  it('does not commit late writes to the old resource after account invalidation', async () => {
    const { editor, api, invalidate, changed } = fixture(), account = await editor.readAccount('netease'), current = await resource();
    const controller = editor.removals(list, current, account), pending = deferred();
    api.updateCollectionTracks.mockReturnValueOnce(pending.promise);
    const removing = controller.removeEntry({ track: song, entryKey: formatEntryKey(getPlaybackSongKey(song), 0) });
    await vi.waitFor(() => expect(api.updateCollectionTracks).toHaveBeenCalled()); invalidate(); pending.resolve();
    expect(await removing).toMatchObject({ ok: false }); expect(changed).not.toHaveBeenCalled();
    expect(current.getSnapshot().tracks).toEqual([song]); controller.dispose(); current.dispose();
  });
});
