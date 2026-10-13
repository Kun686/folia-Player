import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import type { PlaybackSnapshot } from '../../../src/mobile/bridge';
import { enqueueMobileSongs } from '../../../src/mobile/queueActions';

// collectionQueue.test.ts — atomic scope enqueue, provider cancellation, accepted counts and capacity.
const ports = vi.hoisted(() => ({ getState: vi.fn(), editQueue: vi.fn(), flushSessions: vi.fn(), captureProviderSession: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: ports }));
vi.mock('../../../src/mobile/runtime', () => ports);
vi.mock('../../../src/services/onlineMusic/songAvailability', () => ({ isSongUnavailable: (song: SongResult) => song.id === 'blocked' }));
const song = (providerId: 'qq' | 'netease', id: string): SongResult => ({ id, name: id, artists: [], album: { id: '', name: '' },
  durationMs: 60000, sourceRef: { kind: 'online', providerId, mediaId: id } });
const a = song('netease', 'current'), b = song('qq', '1'), c = song('netease', '1');
const state = (queue = [a], index = 0, queueRevision = 4): PlaybackSnapshot => ({ queue, index, currentSong: queue[index] ?? null,
  queueRevision, revision: 10, position: 42, duration: 60, playing: false, repeat: 'off' });
describe('mobile collection enqueue', () => {
  beforeEach(() => {
    vi.resetAllMocks(); ports.getState.mockResolvedValue(state()); ports.editQueue.mockResolvedValue(state());
    ports.flushSessions.mockResolvedValue(undefined); ports.captureProviderSession.mockReturnValue(() => true);
  });
  it('preserves mixed-provider identities and order while skipping the current song, unavailable entries and repeats', async () => {
    const count = await enqueueMobileSongs([a, b, song('qq', 'blocked'), { ...b }, c], 'append');
    expect(count).toBe(2);
    expect(ports.editQueue).toHaveBeenCalledExactlyOnceWith({ songs: [a, b, c], currentIndex: 0, queueRevision: 4 });
    expect(ports.captureProviderSession.mock.calls.map(args => args[0])).toEqual(['netease', 'qq']);
  });
  it('returns no additions without a native write for an unavailable scope or the current song only', async () => {
    expect(await enqueueMobileSongs([song('qq', 'blocked')], 'next')).toBe(0);
    expect(ports.getState).not.toHaveBeenCalled();
    expect(await enqueueMobileSongs([a], 'next')).toBe(0);
    expect(ports.editQueue).not.toHaveBeenCalled();
  });
  it('reports accepted songs even when they are already in the requested position, as the original queue does', async () => {
    ports.getState.mockResolvedValue(state([a, b]));
    expect(await enqueueMobileSongs([b], 'append')).toBe(1);
    expect(ports.editQueue).not.toHaveBeenCalled();
  });
  it('rebases a batch once and counts against the newer playing occurrence', async () => {
    ports.getState.mockResolvedValueOnce(state()).mockResolvedValueOnce(state([a, b], 1, 5));
    ports.editQueue.mockRejectedValueOnce(new Error('queue-changed')).mockResolvedValueOnce(state());
    expect(await enqueueMobileSongs([b, c], 'next')).toBe(1);
    expect(ports.editQueue).toHaveBeenCalledTimes(2);
    expect(ports.editQueue).toHaveBeenLastCalledWith({ songs: [a, b, c], currentIndex: 1, queueRevision: 5 });
  });
  it('does not partially write a scope exceeding the native 1000-song limit', async () => {
    ports.getState.mockResolvedValue(state(Array.from({ length: 1000 }, (_, index) => song('qq', String(index)))));
    await expect(enqueueMobileSongs([c], 'append')).rejects.toThrow('queue-full');
    expect(ports.editQueue).not.toHaveBeenCalled();
  });
  it.each(['flush', 'state'] as const)('cancels the whole mixed scope when QQ logs out during %s', async phase => {
    let valid = true;
    ports.captureProviderSession.mockImplementation(provider => () => provider !== 'qq' || valid);
    if (phase === 'flush') ports.flushSessions.mockImplementation(async () => { valid = false; });
    else ports.getState.mockImplementation(async () => { valid = false; return state(); });
    await expect(enqueueMobileSongs([c, b], 'append')).rejects.toThrow('queue-changed');
    expect(ports.editQueue).not.toHaveBeenCalled();
  });
  it('checks the caller native/local scope again after reading the queue', async () => {
    let valid = true;
    ports.getState.mockImplementation(async () => { valid = false; return state(); });
    await expect(enqueueMobileSongs([b], 'append', () => { if (!valid) throw Error('navidrome-settings-changed'); }))
      .rejects.toThrow('navidrome-settings-changed');
    expect(ports.editQueue).not.toHaveBeenCalled();
  });
  it('does not proceed when durable platform session persistence fails', async () => {
    ports.flushSessions.mockRejectedValue(new Error('secure-storage'));
    await expect(enqueueMobileSongs([b], 'append')).rejects.toThrow('secure-storage');
    expect(ports.getState).not.toHaveBeenCalled(); expect(ports.editQueue).not.toHaveBeenCalled();
  });
});
