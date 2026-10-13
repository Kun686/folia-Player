import { describe, expect, it, vi } from 'vitest';
import { createMobileNavidromeLibrary, nativeNavidromeSongs } from '../../../src/mobile/navidromeLibrary';
import { createMobileNavidromeConnection } from '../../../src/mobile/navidromeConnection';
import { createNavidromeRuntime } from '../../../src/mobile/navidromeRuntime';
import { createNavidromeArtwork, navidromeCoverId, navidromeCoverKey } from '../../../src/mobile/navidromeArtwork';
import type { NativeNavidromeSettings } from '../../../src/mobile/nativeNavidrome';

// navidromeLibrary.test.ts — original reads, bounded work and account/navigation isolation; no server.
vi.mock('../../../src/mobile/bridge', () => ({ native: {} }));
vi.mock('../../../src/mobile/runtime', () => ({ cancelProvider: vi.fn().mockResolvedValue(undefined) }));
const settings = (): NativeNavidromeSettings => ({ enabled: true, baseURL: 'https://music.example/library', username: 'user',
  hasPassword: true, scope: 'initial-scope', revision: 1 });
const song = (id = 'track') => ({ id, title: id, artist: 'Artist', album: 'Album', duration: 90, albumId: 'album',
  artistId: 'artist', path: 'music/track.flac', bitRate: 320, suffix: 'flac', replayGain: { trackGain: -4, trackPeak: 0.8 } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
function fixture() {
  let valid = true;
  const read = vi.fn(async (_operation: string, _params: Record<string, string>): Promise<Record<string, unknown>> => ({}));
  const bridge = { navidromeRequest: vi.fn(async ({ operation, parameters, scope, revision }) => ({ scope, revision,
    response: { 'subsonic-response': { status: 'ok' as const, version: '1.16.1', type: 'navidrome', serverVersion: 'test', openSubsonic: true, ...await read(operation, parameters) } } })),
    cancelNavidromeRequest: vi.fn().mockResolvedValue(undefined) };
  const connect = (config: NativeNavidromeSettings) => createMobileNavidromeConnection(config, bridge);
  const library = createMobileNavidromeLibrary(settings(), () => valid, connect);
  return { library, read, bridge, revoke: () => { valid = false; } };
}

describe('mobile Navidrome library', () => {
  it('preserves original metadata without signing a URL in JavaScript', () => {
    const [converted] = nativeNavidromeSongs(settings(), [song() as any]);
    expect(converted).toMatchObject({ name: 'track', durationMs: 90000, artists: [{ name: 'Artist' }],
      sourceRef: { kind: 'navidrome', scope: 'initial-scope', mediaId: 'track' },
      navidromeData: { navidromeData: { streamUrl: '', replayGain: { trackGain: -4, trackPeak: 0.8 } } } });
    expect(JSON.stringify(converted)).not.toMatch(/https:|password|token/);
    expect(nativeNavidromeSongs({ ...settings(), scope: 'other' }, [song() as any])[0].id).not.toBe(converted.id);
  });
  it('uses original overview limits and caches home when switching sections', async () => {
    const f = fixture(); await f.library.start();
    expect(f.read.mock.calls).toEqual([
      ['getAlbumList2', { type: 'alphabeticalByName', size: '500', offset: '0' }],
      ['getAlbumList2', { type: 'newest', size: '500', offset: '0' }],
      ['getAlbumList2', { type: 'recent', size: '500', offset: '0' }],
      ['getPlaylists', {}], ['getArtists', {}], ['getRandomSongs', { size: '100' }], ['getStarred2', {}],
    ]);
    f.library.home('artists'); expect(f.read).toHaveBeenCalledTimes(7); f.library.dispose();
  });
  it('expands 80 artist albums in order without overflowing the 64-request native wait list', async () => {
    const f = fixture(); let active = 0, maximum = 0;
    f.read.mockImplementation(async operation => {
      if (operation === 'getArtist') return { artist: { album: Array.from({ length: 80 }, (_, i) => ({ id: String(i) })) } };
      active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--;
      return { album: { song: [song(String(f.read.mock.calls.length - 2))] } };
    });
    await f.library.open({ source: 'navidrome', type: 'artist', id: 'artist', name: 'Artist' });
    expect(f.library.getSnapshot()).toMatchObject({ error: '', busy: false });
    expect(f.library.getSnapshot().songs).toHaveLength(80); expect(maximum).toBeLessThanOrEqual(2);
    expect(f.read.mock.calls.slice(1).map(call => call[1].id)).toEqual(Array.from({ length: 80 }, (_, i) => String(i)));
    f.library.dispose();
  });
  it('cancels old searches and never lets a late response replace a newer collection', async () => {
    const f = fixture(), late = deferred<Record<string, unknown>>();
    f.read.mockImplementation(async operation => operation === 'search3' ? late.promise : { album: { song: [song('new')] } });
    const old = f.library.search('old');
    await f.library.open({ source: 'navidrome', type: 'album', id: 'new', name: 'New' });
    late.resolve({ searchResult3: { song: [song('old')] } }); await old;
    expect(f.library.getSnapshot().songs.map(track => track.name)).toEqual(['new']);
    expect(f.bridge.cancelNavidromeRequest).toHaveBeenCalledTimes(1); f.library.dispose();
  });
  it('rejects stale queue actions, drops in-flight reads and ignores stale navigation', async () => {
    const f = fixture(), late = deferred<Record<string, unknown>>(); f.read.mockReturnValue(late.promise);
    const pending = f.library.search('old'); f.revoke();
    late.resolve({ searchResult3: { song: [song('old')] } }); await pending;
    expect(f.library.getSnapshot().songs).toEqual([]);
    expect(() => f.library.assertCurrent()).toThrow('navidrome-settings-changed');
    await f.library.search('new'); f.library.home(); expect(f.read).toHaveBeenCalledTimes(1); f.library.dispose();
  });
  it('exposes safe read errors and can recover on refresh and strict-effect replay', async () => {
    const f = fixture(); f.read.mockRejectedValueOnce(Error('password=secret'));
    await f.library.start(); expect(f.library.getSnapshot().error).toBe('navidrome-network');
    await f.library.load(); expect(f.library.getSnapshot().error).toBe('');
    f.library.dispose(); await f.library.start(); expect(f.library.getSnapshot().busy).toBe(false); f.library.dispose();
  });
});

describe('mobile Navidrome settings checkpoint', () => {
  it('keeps password write-only, invalidates old work immediately and prevents overlapping saves', async () => {
    const hold = deferred<NativeNavidromeSettings>();
    const bridge = { getNavidromeSettings: vi.fn().mockResolvedValue({ ...settings(), password: 'do-not-retain' }), setNavidromeSettings: vi.fn().mockReturnValue(hold.promise) };
    const revoke = vi.fn(), runtime = createNavidromeRuntime(bridge, revoke); await runtime.load();
    const current = runtime.capture(), pending = runtime.save({ password: 'new-secret' });
    expect(current()).toBe(false);
    await expect(runtime.save({ password: 'other' })).rejects.toThrow('navidrome-settings-changed');
    expect(bridge.setNavidromeSettings).toHaveBeenCalledTimes(1);
    expect(bridge.setNavidromeSettings).toHaveBeenCalledWith({ revision: 1, scope: 'initial-scope', settings: { password: 'new-secret' } });
    hold.resolve({ ...settings(), revision: 2, scope: 'new-scope' }); await pending;
    expect(JSON.stringify(runtime.getSnapshot())).not.toMatch(/do-not-retain|new-secret|password/);
    expect(Object.isFrozen(runtime.getSnapshot().settings)).toBe(true); expect(revoke).toHaveBeenCalledTimes(2);
  });
  it('preserves last committed settings on failed writes and recovers on retry', async () => {
    const bridge = { getNavidromeSettings: vi.fn().mockResolvedValue(settings()),
      setNavidromeSettings: vi.fn().mockRejectedValueOnce(Error('secure-storage')).mockResolvedValue({ ...settings(), enabled: false, revision: 2 }) };
    const runtime = createNavidromeRuntime(bridge); await runtime.load();
    await expect(runtime.save({ enabled: false })).rejects.toThrow('secure-storage');
    expect(runtime.getSnapshot()).toMatchObject({ settings: settings(), busy: false, error: 'secure-storage' });
    await runtime.save({ enabled: false }); expect(runtime.getSnapshot()).toMatchObject({ error: '', settings: { enabled: false } });
  });
});

describe('visible Navidrome artwork work', () => {
  it('keeps two active native reads, removes canceled rows, and discards stale replies', async () => {
    let current = true; const hold = deferred<{ url: string }>();
    const bridge = { navidromeArtwork: vi.fn().mockReturnValue(hold.promise) };
    const load = createNavidromeArtwork('scope', () => current, bridge), controllers = Array.from({ length: 4 }, () => new AbortController());
    const settled = Promise.allSettled(controllers.map((c, i) => load(String(i), c.signal)));
    expect(bridge.navidromeArtwork).toHaveBeenCalledTimes(2); controllers[2].abort(); current = false;
    hold.resolve({ url: 'data:image/jpeg;base64,fixture' });
    expect((await settled).every(result => result.status === 'rejected')).toBe(true);
    expect(bridge.navidromeArtwork).toHaveBeenCalledTimes(2);
  });
  it('bounds pending rows and releases active slots after errors', async () => {
    const hold = deferred<{ url: string }>(), bridge = { navidromeArtwork: vi.fn().mockReturnValue(hold.promise) };
    const load = createNavidromeArtwork('scope', () => true, bridge), signal = new AbortController().signal;
    const pending = Promise.all(Array.from({ length: 66 }, (_, i) => load(String(i), signal)));
    await expect(load('overflow', signal)).rejects.toThrow('cover-busy');
    hold.resolve({ url: 'data:ok' }); expect(await pending).toHaveLength(66);
    bridge.navidromeArtwork.mockRejectedValueOnce(Error('bad'));
    await expect(load('bad', signal)).rejects.toThrow('bad'); await expect(load('ok', signal)).resolves.toBe('data:ok');
    expect(navidromeCoverId(navidromeCoverKey('艺术家:%/'))).toBe('艺术家:%/');
    expect(navidromeCoverId('https://external.example')).toBeUndefined();
  });
});
