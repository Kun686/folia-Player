import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileNavidromeConnection, safeNavidromeError } from '../../../src/mobile/navidromeConnection';
import type { NativeNavidromeOperation, NativeNavidromeResponse, NativeNavidromeSettings } from '../../../src/mobile/nativeNavidrome';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';

// navidromeConnection.test.ts — shared original parsing, native scheduling and stale-result isolation; no live service.
vi.mock('../../../src/mobile/bridge', () => ({ native: {} }));
const settings = (): NativeNavidromeSettings => ({ enabled: true, baseURL: 'https://music.example/tenant', username: 'user',
  hasPassword: true, scope: '978FF3A4-90CE-4689-80CE-23F2D0B3A601', revision: 4 });
const response = (payload: Record<string, unknown> = {}): NativeNavidromeResponse => ({ scope: settings().scope, revision: 4,
  response: { 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', serverVersion: 'test', openSubsonic: true, ...payload } } });
const bridge = () => ({ navidromeRequest: vi.fn().mockResolvedValue(response()), cancelNavidromeRequest: vi.fn().mockResolvedValue(undefined) });
const deferred = () => {
  let resolve!: (value: NativeNavidromeResponse) => void;
  const promise = new Promise<NativeNavidromeResponse>(done => { resolve = done; });
  return { promise, resolve };
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('mobile Navidrome shared reads', () => {
  const song = { id: 'song-1', title: 'Song' }, album = { id: 'album-1', song: [song] }, artist = { id: 'artist-1', album: [album] };
  const playlist = { id: 'playlist-1', entry: [song] }, lyric = { lang: 'zh', synced: true, line: [{ start: 0, value: '歌词' }] };
  const cases: [string, NativeNavidromeOperation, Record<string, unknown>, Record<string, string>, unknown, unknown[]][] = [
    ['ping', 'ping', {}, {}, true, []],
    ['getOpenSubsonicExtensions', 'getOpenSubsonicExtensions', { openSubsonicExtensions: [{ name: 'songLyrics', versions: [1] }] }, {}, [{ name: 'songLyrics', versions: [1] }], []],
    ['getUser', 'getUser', { user: { username: 'user' } }, { username: 'user' }, { username: 'user' }, []],
    ['getMusicFolders', 'getMusicFolders', { musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] } }, {}, [{ id: 1, name: 'Music' }], []],
    ['getLicense', 'getLicense', { license: { valid: true } }, {}, { valid: true }, []],
    ['getAlbumList2', 'getAlbumList2', { albumList2: { album: [album] } }, { type: 'newest', size: '500', offset: '1000' }, [album], ['newest', 500, 1000]],
    ['getAlbum', 'getAlbum', { album }, { id: 'album-1' }, album, ['album-1']],
    ['getPlaylists', 'getPlaylists', { playlists: { playlist: [playlist] } }, {}, [playlist], []],
    ['getPlaylist', 'getPlaylist', { playlist }, { id: 'playlist-1' }, playlist, ['playlist-1']],
    ['getRandomSongs', 'getRandomSongs', { randomSongs: { song: [song] } }, { size: '100' }, [song], []],
    ['getStarred2', 'getStarred2', { starred2: { song: [song] } }, {}, [song], []],
    ['getArtists', 'getArtists', { artists: { index: [{ name: 'A', artist: [artist] }, { name: 'B' }] } }, {}, [artist], []],
    ['getArtist', 'getArtist', { artist }, { id: 'artist-1' }, artist, ['artist-1']],
    ['getSong', 'getSong', { song }, { id: 'song-1' }, song, ['song-1']],
    ['getLyrics', 'getLyrics', { lyrics: { value: '[00:01]歌词' } }, { artist: 'Artist', title: 'Title' }, '[00:01]歌词', ['Artist', 'Title']],
    ['getLyricsBySongId', 'getLyricsBySongId', { lyricsList: { structuredLyrics: [lyric] } }, { id: 'song-1', enhanced: 'true' }, [lyric], ['song-1']],
    ['search', 'search3', { searchResult3: { song: [song], album: [album], artist: [artist] } }, { query: 'C++ 雪', artistCount: '5', albumCount: '10', songCount: '20' }, { song: [song], album: [album], artist: [artist] }, ['C++ 雪']],
  ];
  it.each(cases)('reuses original %s response and parameters', async (method, operation, payload, parameters, expected, args) => {
    const port = bridge(); port.navidromeRequest.mockResolvedValue(response(payload));
    const connection = createMobileNavidromeConnection(settings(), port);
    const call = connection.api[method as keyof typeof connection.api] as (config: NativeNavidromeSettings, ...args: unknown[]) => Promise<unknown>;
    expect(await call(connection.settings, ...args)).toEqual(expected);
    expect(port.navidromeRequest).toHaveBeenCalledWith({ id: expect.any(String), revision: 4, scope: settings().scope, operation, parameters });
    connection.dispose();
  });
  it('schedules the original five-way server profile without exceeding two native requests', async () => {
    const port = bridge(); let active = 0, maximum = 0;
    port.navidromeRequest.mockImplementation(async ({ operation }) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return response(operation === 'getOpenSubsonicExtensions' ? { openSubsonicExtensions: [{ name: 'songLyrics', versions: [1] }] } : {});
    });
    const connection = createMobileNavidromeConnection(settings(), port);
    const result = await connection.api.getServerProfile(connection.settings);
    expect(result).toMatchObject({ serverType: 'navidrome', serverVersion: 'test', openSubsonic: true,
      capabilities: { supportsSongLyrics: true, extensionVersions: { songLyrics: [1] } } });
    expect(maximum).toBe(2); expect(port.navidromeRequest).toHaveBeenCalledTimes(5);
    connection.dispose();
  });
  it('keeps secrets out of JavaScript config and does not use fetch or localStorage', async () => {
    const fetch = vi.fn(() => { throw Error('Web fetch must not run'); }); vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', new Proxy({}, { get() { throw Error('localStorage must not run'); } }));
    const initial = { ...settings(), password: 'must-not-copy', passwordHash: 'must-not-copy' };
    const port = bridge(), connection = createMobileNavidromeConnection(initial, port);
    initial.scope = 'changed-by-caller'; initial.username = 'other';
    await connection.api.ping(connection.settings);
    expect(connection.settings.scope).toBe(settings().scope); expect(Object.isFrozen(connection.settings)).toBe(true);
    expect(JSON.stringify({ config: connection.settings, request: port.navidromeRequest.mock.calls })).not.toContain('must-not-copy');
    expect(fetch).not.toHaveBeenCalled(); connection.dispose();
  });
  it('does not silently turn a network failure into an empty playlist', async () => {
    const port = bridge(), connection = createMobileNavidromeConnection(settings(), port);
    port.navidromeRequest.mockRejectedValueOnce(Error('https://music.example?password=secret'));
    await expect(connection.api.getPlaylists(connection.settings)).rejects.toThrow(/^navidrome-network$/);
    expect(await connection.api.getPlaylists(connection.settings)).toEqual([]);
    connection.dispose();
  });
  it.each(['navidrome-http-404', 'navidrome-not-found', 'navidrome-api-0'])('permits absent optional endpoints: %s', async code => {
    const port = bridge(), connection = createMobileNavidromeConnection(settings(), port);
    port.navidromeRequest.mockRejectedValue(Error(code));
    expect(await connection.api.getOpenSubsonicExtensions(connection.settings)).toEqual([]);
    expect(await connection.api.getLyricsBySongId(connection.settings, 'song-1')).toBeNull();
    await expect(connection.api.getAlbum(connection.settings, 'album-1')).rejects.toThrow(code);
    connection.dispose();
  });
  it('keeps auth failures fatal even for optional lyrics and cancels the whole connection', async () => {
    const port = bridge(), connection = createMobileNavidromeConnection(settings(), port);
    port.navidromeRequest.mockRejectedValue(Error('navidrome-auth-required'));
    await expect(connection.api.getLyricsBySongId(connection.settings, 'song-1')).rejects.toThrow('navidrome-auth-required');
    await expect(connection.api.getPlaylists(connection.settings)).rejects.toThrow('navidrome-auth-required');
    expect(port.navidromeRequest).toHaveBeenCalledTimes(1);
  });
  it('rejects unrecognized errors without returning raw strings or echoed headers', () => {
    for (const error of ['secret', null, {}, Error('Cookie: secret'), { message: 'navidrome-http-404 secret' }]) {
      expect(safeNavidromeError(error).message).toBe('navidrome-network');
    }
    expect(safeNavidromeError({ message: 'navidrome-timeout' }).message).toBe('navidrome-timeout');
  });
});

describe('mobile Navidrome connection ownership', () => {
  it('cancels active and queued reads immediately and ignores late successful responses', async () => {
    const port = bridge(), hold = deferred(); port.navidromeRequest.mockReturnValue(hold.promise);
    const connection = createMobileNavidromeConnection(settings(), port);
    const work = Array.from({ length: 6 }, () => connection.api.getPlaylists(connection.settings));
    const results = Promise.allSettled(work);
    expect(port.navidromeRequest).toHaveBeenCalledTimes(2);
    connection.dispose(); connection.dispose();
    expect((await results).every(item => item.status === 'rejected' && item.reason.message === 'navidrome-cancelled')).toBe(true);
    expect(port.cancelNavidromeRequest).toHaveBeenCalledTimes(2);
    hold.resolve(response()); await Promise.resolve(); await Promise.resolve();
    expect(port.navidromeRequest).toHaveBeenCalledTimes(2);
  });
  it('rejects a foreign config before invoking the bridge', async () => {
    const port = bridge(), connection = createMobileNavidromeConnection(settings(), port);
    await expect(connection.api.getPlaylists({ ...connection.settings, scope: 'other' })).rejects.toThrow('navidrome-settings-changed');
    await expect(connection.api.getPlaylists({ ...connection.settings, revision: 99 })).rejects.toThrow('navidrome-settings-changed');
    expect(port.navidromeRequest).not.toHaveBeenCalled(); connection.dispose();
  });
  it('invalidates the connection and its waiting reads on a mismatched native reply', async () => {
    const port = bridge(); port.navidromeRequest.mockResolvedValue({ ...response(), scope: 'other' });
    const connection = createMobileNavidromeConnection(settings(), port);
    const work = Array.from({ length: 5 }, () => connection.api.getPlaylists(connection.settings));
    expect((await Promise.allSettled(work)).every(item => item.status === 'rejected' && item.reason.message === 'navidrome-settings-changed')).toBe(true);
    expect(port.navidromeRequest).toHaveBeenCalledTimes(2); expect(() => connection.assertCurrent()).toThrow('navidrome-settings-changed');
  });
  it('bounds queued work as well as active native requests', async () => {
    const port = bridge(), hold = deferred(); port.navidromeRequest.mockReturnValue(hold.promise);
    const connection = createMobileNavidromeConnection(settings(), port);
    const pending = Promise.allSettled(Array.from({ length: 64 }, () => connection.api.getPlaylists(connection.settings)));
    await expect(connection.api.getPlaylists(connection.settings)).rejects.toThrow('navidrome-request-limit');
    expect(port.navidromeRequest).toHaveBeenCalledTimes(2);
    connection.dispose(); await pending; hold.resolve(response());
  });
  it('creates scoped source references without credentials or server URLs', () => {
    const connection = createMobileNavidromeConnection(settings(), bridge());
    const ref = connection.sourceRef('same:雪/id');
    expect(ref).toEqual({ kind: 'navidrome', scope: settings().scope, mediaId: 'same:雪/id' });
    expect(getPlaybackSongKey({ sourceRef: ref } as any)).toBe(`navidrome-scoped:${JSON.stringify([settings().scope, 'same:雪/id'])}`);
    expect(() => connection.sourceRef('')).toThrow('navidrome-not-configured');
    connection.dispose(); expect(() => connection.sourceRef('song')).toThrow('navidrome-cancelled');
  });
});
