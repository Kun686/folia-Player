import { describe, expect, it, vi } from 'vitest';
import { createNavidromeWriteApi } from '../../../src/services/navidromeWriteApi';

// navidromeWriteApi.test.ts — original endpoint/array/boolean mapping and desktop fallback parity.
describe('shared Subsonic mutations', () => {
  it('preserves original optional fields and repeated array values', async () => {
    const request = vi.fn().mockResolvedValue({ 'subsonic-response': { status: 'ok', playlist: { id: 'p' } } });
    const api = createNavidromeWriteApi(request), config = { username: 'u' };
    expect(await api.createPlaylist(config, 'New', ['a', 'b'])).toEqual({ id: 'p' });
    await api.updatePlaylist(config, 'p', { name: 'Renamed', public: false, comment: '', songIdsToAdd: ['a', 'a'], songIndexesToRemove: [2, 0] });
    await api.deletePlaylist(config, 'p'); await api.star(config, 'a'); await api.unstar(config, 'a');
    expect(request.mock.calls).toEqual([
      [config, 'createPlaylist', { name: 'New', songId: ['a', 'b'] }],
      [config, 'updatePlaylist', { playlistId: 'p', name: 'Renamed', public: false, songIdToAdd: ['a', 'a'], songIndexToRemove: [2, 0] }],
      [config, 'deletePlaylist', { id: 'p' }], [config, 'star', { id: 'a' }], [config, 'unstar', { id: 'a' }],
    ]);
  });
  it('keeps desktop fallback while allowing native callers to reject failures', async () => {
    const request = vi.fn().mockRejectedValue(Error('offline')), report = vi.fn();
    expect(await createNavidromeWriteApi(request, report).createPlaylist({}, 'x')).toBeNull();
    expect(await createNavidromeWriteApi(request, report).deletePlaylist({}, 'x')).toBe(false);
    await expect(createNavidromeWriteApi(request, (_op, error) => { throw error; }).star({}, 'x')).rejects.toThrow('offline');
    expect(request).toHaveBeenCalledTimes(3);
  });
});
