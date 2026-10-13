import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSnapshot } from '../../../src/mobile/bridge';
import type { SongResult } from '../../../src/types';
import { addMobileSongs, editMobileQueue } from '../../../src/mobile/queueActions';
import { shufflePlaybackQueue } from '../../../src/utils/queueBatchOperations';

// test/unit/mobile/queueActions.test.ts — queue identity, occurrence and native CAS semantics.
const native = vi.hoisted(() => ({ getState: vi.fn(), editQueue: vi.fn() }));
vi.mock('../../../src/mobile/bridge', () => ({ native }));
const song = (providerId: 'qq' | 'netease', id: string) => ({ id, name: id,
  artists: [], album: { id: '', name: '' }, durationMs: 60000, sourceRef: { kind: 'online', providerId, mediaId: id } }) as SongResult;
const a = song('netease', '1'), b = song('qq', '1'), c = song('qq', '2');
const state = (queue = [a, b, c], index = 0): PlaybackSnapshot => ({ queue, index, currentSong: queue[index] ?? null,
  queueRevision: 4, revision: 10, position: 15, duration: 60, playing: true, repeat: 'off' });

describe('mobile queue actions', () => {
  beforeEach(() => { vi.resetAllMocks(); native.getState.mockResolvedValue(state()); native.editQueue.mockResolvedValue(state()); });
  it('adds next using original deduplication and provider identity', async () => {
    await addMobileSongs([c, c, a], 'next');
    expect(native.editQueue).toHaveBeenCalledWith({ songs: [a, c, b], currentIndex: 0, queueRevision: 4 });
  });
  it('does not start playback when adding to an empty queue', async () => {
    native.getState.mockResolvedValue(state([], -1));
    await addMobileSongs([a, b], 'append');
    expect(native.editQueue).toHaveBeenCalledWith({ songs: [a, b], currentIndex: -1, queueRevision: 4 });
  });
  it('rebases an identity-based add once after a remote advance', async () => {
    native.getState.mockResolvedValueOnce(state()).mockResolvedValueOnce({ ...state([a, b, c], 1), queueRevision: 5 });
    native.editQueue.mockRejectedValueOnce(new Error('queue-changed')).mockResolvedValueOnce(state());
    const d = song('qq', 'new');
    await addMobileSongs([d], 'next');
    expect(native.editQueue).toHaveBeenLastCalledWith({ songs: [a, b, d, c], currentIndex: 1, queueRevision: 5 });
  });
  it('does not rebase a row index after the queue changes', async () => {
    native.editQueue.mockRejectedValue(new Error('queue-changed'));
    await expect(editMobileQueue(state(), { type: 'remove', index: 1 })).rejects.toThrow('queue-changed');
    expect(native.editQueue).toHaveBeenCalledTimes(1);
    expect(native.getState).not.toHaveBeenCalled();
  });
  it('keeps the exact duplicate occurrence while reordering another row', async () => {
    const duplicate = { ...a };
    await editMobileQueue(state([a, b, duplicate, c], 2), { type: 'end', index: 0 });
    expect(native.editQueue).toHaveBeenCalledWith({ songs: [b, duplicate, c, a], currentIndex: 1, queueRevision: 4 });
  });
  it('detaches the current occurrence when removed, even if its identity appears again', async () => {
    await editMobileQueue(state([a, { ...a }, b]), { type: 'remove', index: 0 });
    expect(native.editQueue).toHaveBeenCalledWith({ songs: [{ ...a }, b], currentIndex: -1, queueRevision: 4 });
  });
  it('clears the queue without issuing any transport command', async () => {
    await editMobileQueue(state(), { type: 'clear' });
    expect(native.editQueue).toHaveBeenCalledWith({ songs: [], currentIndex: -1, queueRevision: 4 });
  });
  it('shares original shuffle semantics, retaining only one current identity at the front', () => {
    const result = shufflePlaybackQueue([b, a, { ...a }, c], a);
    expect(result[0]).toBe(a); expect(result).toHaveLength(3);
    expect(new Set(result.slice(1))).toEqual(new Set([b, c]));
  });
  it('does not retry a transport failure', async () => {
    native.editQueue.mockRejectedValue(new Error('network'));
    await expect(addMobileSongs([b], 'append')).rejects.toThrow('network');
    expect(native.editQueue).toHaveBeenCalledTimes(1);
  });
  it('does not add an old account song if settings change while reading the native queue', async () => {
    let valid = true;
    native.getState.mockImplementation(async () => { valid = false; return state(); });
    await expect(addMobileSongs([b], 'append', () => { if (!valid) throw Error('navidrome-settings-changed'); }))
      .rejects.toThrow('navidrome-settings-changed');
    expect(native.editQueue).not.toHaveBeenCalled();
  });
});
