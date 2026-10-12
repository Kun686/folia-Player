import { describe, expect, it, vi } from 'vitest';
import { createMobileSongLikes } from '../../../src/mobile/mobileSongLikes';
import type { SongResult } from '../../../src/types';

// mobileSongLikes.test.ts — controlled Omni results; no user account is read or changed.
const song = (providerId = 'netease', mediaId = '42'): SongResult => ({ id: mediaId, name: 'fixture', artists: [], durationMs: 180000,
  album: { id: '', name: '' }, sourceRef: { kind: 'online', providerId, mediaId } });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let revision = 0;
  const api = { getLoginStatus: vi.fn(async (_provider: string) => ({ id: 'user', nickname: 'fixture' })),
    getProviderLikedSongIds: vi.fn(async (_provider: string, _user: string | number): Promise<(number | string)[]> => []),
    canLikeSong: vi.fn(() => true), likeSong: vi.fn(async (_song: SongResult, _liked: boolean, _context?: { isCurrent(): boolean }) => {}) };
  const likes = createMobileSongLikes(api, () => { const epoch = revision; return () => epoch === revision; });
  const session = likes.createSession(song(), true);
  return { api, likes, session, invalidate: () => { revision++; } };
}
async function ready(session: ReturnType<ReturnType<typeof createMobileSongLikes>['createSession']>) {
  session.start(); await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
}
describe('mobile source-owned likes', () => {
  it('reads the owner and canonical media identity, then writes an explicit desired value', async () => {
    const { api, session } = fixture(); api.getProviderLikedSongIds.mockResolvedValue([42]); await ready(session);
    expect(api.getLoginStatus).toHaveBeenCalledWith('netease');
    expect(api.getProviderLikedSongIds).toHaveBeenCalledWith('netease', 'user', expect.any(Function));
    expect(session.getSnapshot().liked).toBe(true); await session.change();
    expect(api.likeSong).toHaveBeenCalledWith(song(), false, expect.objectContaining({ isCurrent: expect.any(Function) }));
    expect(session.getSnapshot().liked).toBe(false);
  });
  it('does not read likes or write when the account is anonymous', async () => {
    const { api, session } = fixture(); api.getLoginStatus.mockResolvedValue(null as any); session.start();
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('anonymous')); await session.change();
    expect(api.getProviderLikedSongIds).not.toHaveBeenCalled(); expect(api.likeSong).not.toHaveBeenCalled();
  });
  it.each(['old-server', 'read-only-provider'])('does not offer writes for %s', async reason => {
    const { api, likes } = fixture(); api.canLikeSong.mockReturnValue(reason !== 'read-only-provider');
    const session = likes.createSession(song('qq'), reason !== 'old-server'); await ready(session); await session.change();
    expect(session.getSnapshot()).toMatchObject({ liked: false, writable: false }); expect(api.likeSong).not.toHaveBeenCalled();
    expect(api.getProviderLikedSongIds).toHaveBeenCalledWith('qq', 'user', expect.any(Function));
  });
  it.each(['account', 'likes'])('keeps %s read failures unknown, without a false unliked state', async stage => {
    const { api, session } = fixture();
    if (stage === 'account') api.getLoginStatus.mockRejectedValueOnce(Error('sensitive'));
    else api.getProviderLikedSongIds.mockRejectedValueOnce(Error('sensitive'));
    session.start(); await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ phase: 'error', liked: null }));
    await session.change(); expect(api.likeSong).not.toHaveBeenCalled();
    await session.read(); expect(session.getSnapshot().phase).toBe('ready');
    expect(JSON.stringify(session.getSnapshot())).not.toContain('sensitive');
  });
  it('blocks rapid taps and leaves the confirmed heart intact until success', async () => {
    const { api, session } = fixture(); await ready(session); const pending = deferred<void>();
    api.likeSong.mockReturnValueOnce(pending.promise); const first = session.change(); await session.change();
    expect(session.getSnapshot()).toMatchObject({ phase: 'saving', liked: false });
    await vi.waitFor(() => expect(api.likeSong).toHaveBeenCalledOnce()); pending.resolve(); await first;
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', liked: true });
  });
  it('requires a fresh read after an uncertain mutation, never retries or inverts it automatically', async () => {
    const { api, session } = fixture(); await ready(session); api.likeSong.mockRejectedValueOnce(Error('timeout'));
    await session.change(); await session.change(); expect(api.likeSong).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', liked: false });
    api.getProviderLikedSongIds.mockResolvedValue([42]); await session.read(); expect(session.getSnapshot().liked).toBe(true);
    await session.change(); expect(api.likeSong.mock.calls[1][1]).toBe(false);
  });
  it('reopening waits for an already sent mutation before reading the remote result', async () => {
    const { api, session, likes } = fixture(); await ready(session); const pending = deferred<void>();
    api.likeSong.mockReturnValueOnce(pending.promise); const sent = session.change(); session.dispose();
    const reopened = likes.createSession(song(), true); reopened.start();
    await Promise.resolve(); expect(api.getProviderLikedSongIds).toHaveBeenCalledOnce();
    api.getProviderLikedSongIds.mockResolvedValue([42]); pending.resolve(); await sent;
    await vi.waitFor(() => expect(reopened.getSnapshot()).toMatchObject({ phase: 'ready', liked: true }));
    expect(api.likeSong).toHaveBeenCalledOnce();
  });
  it('a pending mutation on one platform does not block another platform', async () => {
    const { api, session, likes } = fixture(); await ready(session); const pending = deferred<void>();
    api.likeSong.mockReturnValueOnce(pending.promise); const sent = session.change();
    const qq = likes.createSession(song('qq'), false); await ready(qq);
    pending.resolve(); await sent; expect(qq.getSnapshot().phase).toBe('ready');
  });
  it('account replacement after reading prevents a write', async () => {
    const { api, session, invalidate } = fixture(); await ready(session); invalidate(); await session.change();
    expect(api.likeSong).not.toHaveBeenCalled(); expect(session.getSnapshot().phase).toBe('error');
  });
  it('account replacement while reading discards the result', async () => {
    const { api, session, invalidate } = fixture(); const pending = deferred<(string | number)[]>();
    api.getProviderLikedSongIds.mockReturnValueOnce(pending.promise); session.start();
    await vi.waitFor(() => expect(api.getProviderLikedSongIds).toHaveBeenCalledOnce()); invalidate(); pending.resolve([42]);
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ phase: 'error', liked: null }));
  });
  it('account replacement while saving revokes the shared Omni commit guard', async () => {
    const { api, session, invalidate } = fixture(); await ready(session); const pending = deferred<void>();
    api.likeSong.mockReturnValueOnce(pending.promise); const sent = session.change();
    await vi.waitFor(() => expect(api.likeSong).toHaveBeenCalledOnce()); const guard = api.likeSong.mock.calls[0][2]!;
    invalidate(); expect(guard.isCurrent()).toBe(false); pending.resolve(); await sent;
    expect(session.getSnapshot().phase).toBe('error');
  });
  it('effect cleanup and restart discard a late read from the old lifecycle', async () => {
    const { api, session } = fixture(); const old = deferred<(string | number)[]>();
    api.getProviderLikedSongIds.mockReturnValueOnce(old.promise); session.start();
    await vi.waitFor(() => expect(api.getProviderLikedSongIds).toHaveBeenCalledOnce());
    session.dispose(); await ready(session); old.resolve([42]); await Promise.resolve();
    expect(session.getSnapshot().liked).toBe(false);
  });
  it('rejects local songs without provider inference', () => {
    const { likes } = fixture(); expect(() => likes.createSession({ ...song(), sourceRef: { kind: 'local', mediaId: '42' } }, true)).toThrow('online-song-required');
  });
});
