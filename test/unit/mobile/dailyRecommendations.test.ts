import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '../../../src/types';
import type { omni } from '../../../src/services/onlineMusic/omni';
import { createMobileDailyRecommendations } from '../../../src/mobile/mobileDailyRecommendations';
import { writeOnlineTracksCache } from '../../../src/library/core/services/onlineCollectionCache';

// dailyRecommendations.test.ts — original controller/resource behavior under native account changes and dismissed requests.
vi.mock('../../../src/services/db', () => ({ removeFromCache: vi.fn(async () => {}) }));
vi.mock('../../../src/library/core/services/onlineCollectionCache', async original => ({
  ...await original<typeof import('../../../src/library/core/services/onlineCollectionCache')>(),
  readOnlineTracksCache: vi.fn(async () => ({ tracks: [], snapshotTime: 0, schemaVersion: 0 })),
  writeOnlineTracksCache: vi.fn(async () => {}),
}));
const song = (id: number): UnifiedSong => ({ id, name: 'Song ' + id, artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000,
  sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  let generation = 0;
  const api = { getLoginStatus: vi.fn(async () => ({ id: 9, nickname: 'User' })), canEditCollectionTracks: () => false,
    getProviderDailySongs: vi.fn(async () => [song(1), song(2)]), getProviderRecommendationHistoryDates: vi.fn(async () => ['2026-10-11']),
    getProviderRecommendationHistorySongs: vi.fn(async () => [song(8)]), dislikeSong: vi.fn(async () => ({ replacement: song(3), limitReached: false })) };
  const service = createMobileDailyRecommendations(api as unknown as typeof omni, () => { const ticket = generation; return () => ticket === generation; }, async () => {});
  const session = service.createSession('netease');
  return { api, service, session, invalidate: () => generation++ };
}
async function ready(session: ReturnType<ReturnType<typeof createMobileDailyRecommendations>['createSession']>) {
  await session.start(); await vi.waitFor(() => expect(session.getSnapshot().resource?.status).toBe('ready'));
}
beforeEach(() => vi.clearAllMocks());
describe('mobile daily recommendations', () => {
  it('uses source-bound reads and original date replacement; history cannot submit dislikes', async () => {
    const { session, api } = setup(); await ready(session);
    expect(api.getProviderDailySongs).toHaveBeenCalledWith('netease');
    expect(session.getSnapshot().mutation?.dailyHistoryDates).toEqual(['2026-10-11']);
    await session.selectDate('2026-10-11');
    expect(session.getSnapshot().resource?.tracks).toEqual([song(8)]);
    expect(session.getSnapshot().mutation?.dailyDate).toBe('2026-10-11');
    await session.remove(song(8)); expect(api.dislikeSong).not.toHaveBeenCalled();
    await ready(session); await session.selectDate('', true);
    expect(api.getProviderDailySongs).toHaveBeenLastCalledWith('netease', true);
    session.dispose();
  });
  it('keeps tracks and date after history failure; writes stay blocked until reread', async () => {
    const { session, api } = setup(); await ready(session);
    api.getProviderRecommendationHistorySongs.mockRejectedValueOnce(Error('private response'));
    await session.selectDate('2026-10-11');
    expect(session.getSnapshot()).toMatchObject({ error: true, mutation: { dailyDate: '' }, resource: { tracks: [song(1), song(2)] } });
    await session.remove(song(1)); expect(api.dislikeSong).not.toHaveBeenCalled();
    await ready(session); await session.remove(song(1));
    expect(session.getSnapshot().resource?.tracks).toEqual([song(3), song(2)]); session.dispose();
  });
  it('serializes dislike and date selection, and does not remove a row before confirmation', async () => {
    const { session, api } = setup(); await ready(session);
    const waiting = deferred<{ replacement: UnifiedSong; limitReached: boolean }>(); api.dislikeSong.mockReturnValueOnce(waiting.promise);
    const removing = session.remove(song(1)); await vi.waitFor(() => expect(api.dislikeSong).toHaveBeenCalledOnce());
    await session.remove(song(1)); await session.selectDate('2026-10-11');
    expect(api.getProviderRecommendationHistorySongs).not.toHaveBeenCalled();
    expect(session.getSnapshot().resource?.tracks).toEqual([song(1), song(2)]);
    waiting.resolve({ replacement: song(3), limitReached: false }); await removing;
    expect(session.getSnapshot().resource?.tracks).toEqual([song(3), song(2)]); session.dispose();
  });
  it('waits for a dismissed write before reopening and rejects account changes before resource commit', async () => {
    const { session, service, api, invalidate } = setup(); await ready(session);
    const waiting = deferred<{ replacement: UnifiedSong; limitReached: boolean }>(); api.dislikeSong.mockReturnValueOnce(waiting.promise);
    const removing = session.remove(song(1)); await vi.waitFor(() => expect(api.dislikeSong).toHaveBeenCalledOnce());
    session.dispose(); const second = service.createSession('netease'), starting = second.start();
    await Promise.resolve(); expect(second.getSnapshot().phase).toBe('loading');
    invalidate(); waiting.resolve({ replacement: song(3), limitReached: false }); await removing; await starting;
    expect(second.getSnapshot().phase).toBe('error'); expect(api.dislikeSong).toHaveBeenCalledOnce();
    expect(second.getSnapshot().resource).toBeNull(); second.dispose();
  });
  it('preserves rows on daily limit and stops further dislikes', async () => {
    const { session, api } = setup(); await ready(session);
    api.dislikeSong.mockResolvedValueOnce({ limitReached: true } as any);
    await session.remove(song(1)); await session.remove(song(2));
    expect(api.dislikeSong).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ error: false, mutation: { dailyLimitReached: true }, resource: { tracks: [song(1), song(2)] } }); session.dispose();
  });
  it('discards a late read on dismissal without writing cache and reports history failure separately', async () => {
    const { session, api } = setup(); const waiting = deferred<UnifiedSong[]>();
    api.getProviderDailySongs.mockReturnValueOnce(waiting.promise); api.getProviderRecommendationHistoryDates.mockRejectedValueOnce(Error('private history'));
    await session.start(); await vi.waitFor(() => expect(session.getSnapshot().historyError).toBe(true));
    session.dispose(); waiting.resolve([song(1)]); await Promise.resolve(); await Promise.resolve();
    expect(writeOnlineTracksCache).not.toHaveBeenCalled();
  });
});
