import { describe, expect, it, vi } from 'vitest';
import { createMobileNavidromeEditor } from '../../../src/mobile/navidromeEditor';
import { createMobileNavidromeConnection } from '../../../src/mobile/navidromeConnection';
import type { NativeNavidromeResponse, NativeNavidromeSettings } from '../../../src/mobile/nativeNavidrome';
import type { SubsonicPlaylist } from '../../../src/types/navidrome';
import type { SongResult } from '../../../src/types';

// navidromeEditor.test.ts — write identity, ownership, positional removal, uncertainty and navigation lifetime.
vi.mock('../../../src/mobile/bridge', () => ({ native: {} }));
const settings: NativeNavidromeSettings = { enabled: true, baseURL: 'https://example.test', username: 'user', hasPassword: true, scope: 'account', revision: 1 };
const song = (id: string): SongResult => ({ id, name: id, durationMs: 120000, artists: [], album: { id: 0, name: '' }, sourceRef: { kind: 'navidrome', mediaId: id, scope: 'account' } });
const response = (body: Record<string, unknown> = {}): NativeNavidromeResponse => ({ scope: 'account', revision: 1,
  response: { 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', serverVersion: 'test', openSubsonic: true, ...body } } });
const list = (ids = ['one', 'two', 'one']): SubsonicPlaylist => ({ id: 'list', name: 'List', owner: 'user', songCount: ids.length,
  duration: 0, changed: 'version1', entry: ids.map(id => ({ id } as any)) });
function fixture() {
  let current = true;
  const bridge = { cancelNavidromeRequest: vi.fn().mockResolvedValue(undefined),
    navidromeRequest: vi.fn(async ({ operation, parameters }): Promise<NativeNavidromeResponse> => response(operation === 'getPlaylist' ? { playlist: list() }
      : operation === 'getPlaylists' ? { playlists: { playlist: [list(), { ...list(), id: 'foreign', owner: 'other' }] } } : { song: { id: parameters.id } })),
    navidromeMutation: vi.fn().mockResolvedValue(response({ playlist: list() })) };
  const editor = createMobileNavidromeEditor(settings, () => current, bridge, config => createMobileNavidromeConnection(config, bridge));
  return { editor, bridge, revoke() { current = false; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('Navidrome mobile writes', () => {
  it('maps create and add through original API and rejects foreign songs before sending a write', async () => {
    const f = fixture();
    expect((await f.editor.create(' 雪 + & ', [song('a'), song('a')])).ok).toBe(true);
    expect(f.bridge.navidromeMutation).toHaveBeenLastCalledWith({ id: expect.any(String), revision: 1, scope: 'account',
      operation: 'createPlaylist', parameters: { name: '雪 + &', songId: ['a', 'a'] } });
    expect((await f.editor.add('list', [song('b')])).ok).toBe(true);
    expect(f.bridge.navidromeMutation).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'updatePlaylist', parameters: { playlistId: 'list', songIdToAdd: ['b'] } }));
    expect((await f.editor.add('list', [{ ...song('bad'), sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'bad' } }])).ok).toBe(false);
    expect(f.bridge.navidromeMutation).toHaveBeenCalledTimes(2);
  });
  it('reads playlist ownership before every write and exposes only owned lists for adding', async () => {
    const f = fixture(); expect((await f.editor.playlists()).map(x => x.id)).toEqual(['list']);
    f.bridge.navidromeRequest.mockResolvedValue(response({ playlist: { ...list(), owner: 'other' } }));
    expect((await f.editor.rename('list', 'New')).ok).toBe(false);
    expect(f.editor.getSnapshot().error).toBe('navidrome-forbidden'); expect(f.bridge.navidromeMutation).not.toHaveBeenCalled();
  });
  it('serializes writes across callers and keeps an uncertain result blocked until explicitly refreshed', async () => {
    const f = fixture(), hold = deferred<NativeNavidromeResponse>(); f.bridge.navidromeMutation.mockReturnValue(hold.promise);
    const pending = f.editor.create('Once'); await vi.waitFor(() => expect(f.bridge.navidromeMutation).toHaveBeenCalledTimes(1));
    expect((await f.editor.create('Twice')).ok).toBe(false);
    hold.resolve({ ...response(), revision: 99 }); expect((await pending).ok).toBe(false);
    expect(f.editor.getSnapshot()).toMatchObject({ busy: false, error: 'navidrome-write-unconfirmed' });
    expect((await f.editor.create('Again')).ok).toBe(false); expect(f.bridge.navidromeMutation).toHaveBeenCalledTimes(1);
    await f.editor.playlists(); f.editor.acknowledgeRefresh(); f.bridge.navidromeMutation.mockResolvedValue(response({ playlist: list() }));
    expect((await f.editor.create('Confirmed')).ok).toBe(true); expect(f.bridge.navidromeMutation).toHaveBeenCalledTimes(2);
  });
  it('removes the selected duplicate occurrence and rejects any shifted server playlist', async () => {
    const f = fixture(); expect((await f.editor.remove(list(), 2)).ok).toBe(true);
    expect(f.bridge.navidromeMutation).toHaveBeenLastCalledWith(expect.objectContaining({ parameters: { playlistId: 'list', songIndexToRemove: ['2'] } }));
    f.bridge.navidromeRequest.mockResolvedValue(response({ playlist: list(['two', 'one']) }));
    expect((await f.editor.remove(list(), 2)).ok).toBe(false);
    expect(f.editor.getSnapshot().error).toBe('navidrome-playlist-changed'); expect(f.bridge.navidromeMutation).toHaveBeenCalledTimes(1);
  });
  it('does not submit after account changes during the ownership read', async () => {
    const f = fixture(); f.bridge.navidromeRequest.mockImplementation(async () => { f.revoke(); return response({ playlist: list() }); });
    expect((await f.editor.delete('list')).ok).toBe(false); expect(f.bridge.navidromeMutation).not.toHaveBeenCalled();
  });
  it('uses fresh authoritative favorites and never retries an unknown write outcome', async () => {
    const f = fixture(); expect(await f.editor.liked(song('one'))).toBe(false);
    expect(await f.editor.toggleLike(song('one'))).toEqual({ ok: true, value: true });
    expect(f.bridge.navidromeMutation.mock.calls.at(-1)?.[0].operation).toBe('star');
    f.bridge.navidromeRequest.mockResolvedValue(response({ song: { id: 'one', starred: 'timestamp' } }));
    f.bridge.navidromeMutation.mockRejectedValue(Error('request URL contained secret'));
    expect((await f.editor.toggleLike(song('one'))).ok).toBe(false);
    expect(f.bridge.navidromeMutation.mock.calls.at(-1)?.[0].operation).toBe('unstar');
    expect(f.editor.getSnapshot().error).toBe('navidrome-write-unconfirmed'); expect(f.bridge.navidromeMutation).toHaveBeenCalledTimes(2);
  });
  it('waits for sent writes before reading a reopened list', async () => {
    const f = fixture(), hold = deferred<NativeNavidromeResponse>(); f.bridge.navidromeMutation.mockReturnValue(hold.promise);
    const write = f.editor.create('New'); await vi.waitFor(() => expect(f.bridge.navidromeMutation).toHaveBeenCalledTimes(1));
    const read = f.editor.playlists(); expect(f.bridge.navidromeRequest).not.toHaveBeenCalled();
    hold.resolve(response({ playlist: list() })); await write; expect(await read).toHaveLength(1);
  });
});
