import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import type { PlaybackSnapshot } from '../../../src/mobile/bridge';
import { buildReplacementQueue } from '../../../src/utils/queueSongReplacement';
import { prepareMobileSongReplacement, type PreparedSongReplacement } from '../../../src/mobile/mobileSongReplacement';
import { playMobileReplacement } from '../../../src/mobile/queueActions';

// songReplacement.test.ts — original queue transform, explicit confirmation and stale-intent protection.
const mocks = vi.hoisted(() => ({ getState: vi.fn(), editQueue: vi.fn(), selectQueue: vi.fn(),
  getSongReplacement: vi.fn(), flushSessions: vi.fn(), captureProviderSession: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native: mocks }));
vi.mock('../../../src/mobile/runtime', () => mocks);
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: mocks }));
vi.mock('../../../src/services/onlineMusic/songAvailability', () => ({ isSongUnavailable: (song: SongResult) => song.privilege?.st === -200 }));
const song = (id: string, providerId = 'netease'): SongResult => ({ id, name: id, artists: [], album: { id: '', name: '' }, durationMs: 10000,
  sourceRef: { kind: 'online', providerId, mediaId: id } });
const original = { ...song('1'), privilege: { st: -200 } } as SongResult;
const alternative = song('2'), current = song('1', 'qq'), otherUnavailable = { ...original, id: '3', sourceRef: { ...original.sourceRef!, mediaId: '3' } } as SongResult;
const unavailable = (value: SongResult) => value.privilege?.st === -200;
const state = (queue = [current], index = 0): PlaybackSnapshot => ({ queue, index, currentSong: queue[index] ?? null,
  queueRevision: 7, revision: 15, position: 4, duration: 10, playing: true, repeat: 'all' });
const request = (): PreparedSongReplacement => ({ originalSong: original, replacementSong: alternative,
  queue: [original, current, otherUnavailable, { ...original }], queueRevision: 7, current: () => true });
beforeEach(() => {
  vi.resetAllMocks(); mocks.getState.mockResolvedValue(state()); mocks.captureProviderSession.mockReturnValue(() => true);
  mocks.getSongReplacement.mockResolvedValue({ song: alternative, label: 'Other version' });
  mocks.editQueue.mockImplementation(async ({ songs, currentIndex, queueRevision }) => ({ ...state(songs, currentIndex), queueRevision: queueRevision + 1 }));
});

describe('original queue replacement shared with desktop', () => {
  it('replaces duplicates by full identity, removes other unavailable tracks, retains local and Navidrome and does not mutate input', () => {
    const local = { ...original, isLocal: true, sourceRef: { kind: 'local', mediaId: '1' } } as SongResult;
    const navidrome = { ...original, isNavidrome: true, sourceRef: { kind: 'navidrome', mediaId: '1' } } as SongResult;
    const queue = Object.freeze([original, current, local, otherUnavailable, navidrome, { ...original }]);
    const result = buildReplacementQueue([...queue], original, alternative, unavailable);
    expect(result).toEqual([alternative, current, local, navidrome, alternative]);
    expect(queue).toHaveLength(6); expect(queue[0]).toBe(original);
  });
  it.each([[], [current], [alternative, current], [otherUnavailable]].map(queue => ({ queue })))('ensures an alternative in queue $queue', ({ queue }) => {
    const result = buildReplacementQueue(queue, original, alternative, unavailable);
    expect(result.filter(item => item === alternative)).toHaveLength(1);
    expect(result).not.toContain(otherUnavailable);
    if (queue.includes(current)) expect(result).toContain(current);
  });
});

describe('prepare without changing playback', () => {
  it('skips lookup for an available song and rejects an invalid index', async () => {
    expect(await prepareMobileSongReplacement([current], 0, [], () => true)).toBeNull();
    await expect(prepareMobileSongReplacement([], 0, ['netease'], () => true)).rejects.toThrow('invalid-queue');
    expect(mocks.getState).not.toHaveBeenCalled(); expect(mocks.getSongReplacement).not.toHaveBeenCalled();
  });
  it('requires the configured gateway to advertise this provider', async () => {
    await expect(prepareMobileSongReplacement([original], 0, ['qq'], () => true)).rejects.toThrow('replacement-unsupported');
    expect(mocks.flushSessions).not.toHaveBeenCalled(); expect(mocks.getSongReplacement).not.toHaveBeenCalled();
  });
  it('routes through Omni and captures a separate queue snapshot, session and native revision', async () => {
    const queue = [original, current];
    const value = await prepareMobileSongReplacement(queue, 0, ['netease'], () => true);
    expect(mocks.captureProviderSession).toHaveBeenCalledExactlyOnceWith('netease');
    expect(mocks.getSongReplacement).toHaveBeenCalledExactlyOnceWith(original);
    expect(value).toMatchObject({ originalSong: original, replacementSong: alternative, label: 'Other version', queueRevision: 7, queue });
    queue.pop(); expect(value?.queue).toHaveLength(2);
    expect(mocks.editQueue).not.toHaveBeenCalled(); expect(mocks.selectQueue).not.toHaveBeenCalled();
  });
  it.each([null, original, otherUnavailable, song('2', 'qq'), { ...alternative, sourceRef: { kind: 'local', mediaId: '2' } }, song('1')])(
    'rejects absent, restricted, identical or mismatched replacement %j', async candidate => {
      mocks.getSongReplacement.mockResolvedValue(candidate && { song: candidate });
      await expect(prepareMobileSongReplacement([original], 0, ['netease'], () => true)).rejects.toThrow('song-unavailable');
      expect(mocks.editQueue).not.toHaveBeenCalled();
    });
  it.each(['before', 'flush', 'read', 'lookup', 'session'])('retires a canceled lookup at %s', async stage => {
    let valid = stage !== 'before';
    if (stage === 'flush') mocks.flushSessions.mockImplementation(async () => { valid = false; });
    if (stage === 'read') mocks.getState.mockImplementation(async () => { valid = false; return state(); });
    if (stage === 'lookup' || stage === 'session') mocks.getSongReplacement.mockImplementation(async () => { valid = false; return { song: alternative }; });
    if (stage === 'session') mocks.captureProviderSession.mockReturnValue(() => valid);
    await expect(prepareMobileSongReplacement([original], 0, ['netease'], () => stage === 'session' || valid)).rejects.toThrow('queue-changed');
    expect(mocks.editQueue).not.toHaveBeenCalled(); expect(mocks.selectQueue).not.toHaveBeenCalled();
  });
  it('propagates persistence failure before lookup', async () => {
    mocks.flushSessions.mockRejectedValue(new Error('keychain'));
    await expect(prepareMobileSongReplacement([original], 0, ['netease'], () => true)).rejects.toThrow('keychain');
    expect(mocks.getSongReplacement).not.toHaveBeenCalled();
  });
});

describe('confirmation uses versioned native queue operations', () => {
  it('preserves the current source identity, applies the original transform and selects with the committed revision', async () => {
    await playMobileReplacement(request());
    expect(mocks.editQueue).toHaveBeenCalledExactlyOnceWith({ songs: [alternative, current, alternative], currentIndex: 1, queueRevision: 7 });
    expect(mocks.selectQueue).toHaveBeenCalledExactlyOnceWith({ index: 0, queueRevision: 8 });
  });
  it('detaches current audio when absent from the chosen collection', async () => {
    await playMobileReplacement({ ...request(), queue: [original] });
    expect(mocks.editQueue).toHaveBeenCalledWith({ songs: [alternative], currentIndex: -1, queueRevision: 7 });
  });
  it('refuses a queue or remote-control change while the prompt was open', async () => {
    mocks.getState.mockResolvedValue({ ...state(), queueRevision: 8 });
    await expect(playMobileReplacement(request())).rejects.toThrow('queue-changed');
    expect(mocks.editQueue).not.toHaveBeenCalled(); expect(mocks.selectQueue).not.toHaveBeenCalled();
  });
  it.each(['flush', 'read', 'edit'])('cancels when the intent or account changes during %s', async stage => {
    let valid = true;
    mocks[stage === 'flush' ? 'flushSessions' : stage === 'read' ? 'getState' : 'editQueue'].mockImplementation(async () => { valid = false; return state([alternative]); });
    await expect(playMobileReplacement({ ...request(), current: () => valid })).rejects.toThrow('queue-changed');
    expect(mocks.selectQueue).not.toHaveBeenCalled();
    if (stage !== 'edit') expect(mocks.editQueue).not.toHaveBeenCalled();
  });
  it.each(['queue-changed', 'network'])('does not retry a failed queue edit: %s', async message => {
    mocks.editQueue.mockRejectedValue(new Error(message));
    await expect(playMobileReplacement(request())).rejects.toThrow(message);
    expect(mocks.editQueue).toHaveBeenCalledOnce(); expect(mocks.selectQueue).not.toHaveBeenCalled();
  });
  it('does not retry selection when another native intent follows the edit', async () => {
    mocks.selectQueue.mockRejectedValue(new Error('queue-changed'));
    await expect(playMobileReplacement(request())).rejects.toThrow('queue-changed');
    expect(mocks.getState).toHaveBeenCalledOnce(); expect(mocks.selectQueue).toHaveBeenCalledOnce();
  });
  it('rejects oversized queues and newly unavailable replacements before editing', async () => {
    await expect(playMobileReplacement({ ...request(), queue: Array.from({ length: 1000 }, (_, id) => song(String(id), 'qq')) })).rejects.toThrow('queue-full');
    await expect(playMobileReplacement({ ...request(), replacementSong: otherUnavailable })).rejects.toThrow('song-unavailable');
    expect(mocks.editQueue).not.toHaveBeenCalled();
  });
  it('does not select an incorrect index if the committed queue lacks the replacement', async () => {
    mocks.editQueue.mockResolvedValue(state());
    await expect(playMobileReplacement(request())).rejects.toThrow('queue-changed');
    expect(mocks.selectQueue).not.toHaveBeenCalled();
  });
});
