import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playMobileSearchSong } from '../../../src/mobile/queueActions';
import type { PlaybackSnapshot } from '../../../src/mobile/bridge';
import type { SongResult } from '../../../src/types';

// searchPlayback.test.ts — search selects one source identity while preserving the user's queue and newer intents.
const native = vi.hoisted(() => ({ getState: vi.fn(), editQueue: vi.fn(), selectQueue: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native }));
const song = (providerId: string, id: string): SongResult => ({ id, name: id, artists: [], album: { id: '', name: '' }, durationMs: 10000,
  sourceRef: { kind: 'online', providerId, mediaId: id } });
const a = song('qq', '1'), b = song('netease', '1'), c = song('netease', '2');
const snapshot = (queue = [a, b], index = 0): PlaybackSnapshot => ({ queue, index, currentSong: queue[index] ?? null,
  queueRevision: 10, revision: 20, position: 4, duration: 10, playing: true, repeat: 'off' });
beforeEach(() => {
  vi.resetAllMocks(); native.getState.mockResolvedValue(snapshot());
  native.editQueue.mockImplementation(async ({ songs, currentIndex, queueRevision }) => ({ ...snapshot(songs, currentIndex), queueRevision: queueRevision + 1 }));
});
describe('mobile original search playback', () => {
  it('appends only the selected song and uses the committed revision to select it', async () => {
    await playMobileSearchSong(c);
    expect(native.editQueue).toHaveBeenCalledExactlyOnceWith({ songs: [a, b, c], currentIndex: 0, queueRevision: 10 });
    expect(native.selectQueue).toHaveBeenCalledExactlyOnceWith({ index: 2, queueRevision: 11 });
  });
  it('selects the first matching provider identity without reordering or duplicating existing songs', async () => {
    native.getState.mockResolvedValue(snapshot([a, b, { ...b }, c]));
    await playMobileSearchSong({ ...b, name: 'Fresh search metadata' });
    expect(native.editQueue).not.toHaveBeenCalled();
    expect(native.selectQueue).toHaveBeenCalledExactlyOnceWith({ index: 1, queueRevision: 10 });
  });
  it.each([false, true])('can start from an empty queue, including a detached current song: %s', async detached => {
    native.getState.mockResolvedValue({ ...snapshot([], -1), currentSong: detached ? { ...c } : null });
    await playMobileSearchSong(c);
    expect(native.editQueue).toHaveBeenCalledExactlyOnceWith({ songs: [c], currentIndex: -1, queueRevision: 10 });
    expect(native.selectQueue).toHaveBeenCalledWith({ index: 0, queueRevision: 11 });
  });
  it('does not append beyond the native bound, but can select an existing song in a full queue', async () => {
    native.getState.mockResolvedValue(snapshot(Array.from({ length: 1000 }, (_, i) => song('qq', String(i)))));
    await expect(playMobileSearchSong(c)).rejects.toThrow('queue-full');
    expect(native.editQueue).not.toHaveBeenCalled(); expect(native.selectQueue).not.toHaveBeenCalled();
    await playMobileSearchSong(a); expect(native.selectQueue).toHaveBeenCalledWith({ index: 1, queueRevision: 10 });
  });
  it.each(['queue-changed', 'network'])('never retries a failed append or selects afterward: %s', async message => {
    native.editQueue.mockRejectedValue(new Error(message));
    await expect(playMobileSearchSong(c)).rejects.toThrow(message);
    expect(native.editQueue).toHaveBeenCalledOnce(); expect(native.getState).toHaveBeenCalledOnce(); expect(native.selectQueue).not.toHaveBeenCalled();
  });
  it('does not override a remote intent that arrives between appending and selecting', async () => {
    native.selectQueue.mockRejectedValue(new Error('queue-changed'));
    await expect(playMobileSearchSong(c)).rejects.toThrow('queue-changed');
    expect(native.editQueue).toHaveBeenCalledOnce(); expect(native.selectQueue).toHaveBeenCalledOnce(); expect(native.getState).toHaveBeenCalledOnce();
  });
  it.each(['read', 'edit'])('cancels after the account session changes during %s', async stage => {
    let current = true;
    if (stage === 'read') native.getState.mockImplementation(async () => { current = false; return snapshot(); });
    else native.editQueue.mockImplementation(async () => { current = false; return snapshot([a, b, c]); });
    await expect(playMobileSearchSong(c, () => current)).rejects.toThrow('queue-changed');
    expect(native.selectQueue).not.toHaveBeenCalled();
    if (stage === 'read') expect(native.editQueue).not.toHaveBeenCalled();
  });
  it('rejects an already canceled action before reading native state', async () => {
    await expect(playMobileSearchSong(c, () => false)).rejects.toThrow('queue-changed');
    expect(native.getState).not.toHaveBeenCalled();
  });
  it('does not select a stale index if the native edit response no longer contains the song', async () => {
    native.editQueue.mockResolvedValue(snapshot());
    await expect(playMobileSearchSong(c)).rejects.toThrow('queue-changed'); expect(native.selectQueue).not.toHaveBeenCalled();
  });
});
