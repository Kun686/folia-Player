import { describe, expect, it, vi } from 'vitest';
import { createMobilePlaylistEditor } from '../../../src/mobile/mobilePlaylistEditor';
import type { omni } from '../../../src/services/onlineMusic/omni';

// collectionSubscriptions.test.ts — original controller semantics with native session and confirmed status gates.
const user = { id: 9, nickname: 'User' };
const album = { id: 8, providerId: 'netease', name: 'Album', type: 'album' };
const playlist = { ...album, type: 'playlist', creator: { id: 10, nickname: 'Other' } };
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  let epoch = 0;
  const api = { getLoginStatus: vi.fn().mockResolvedValue(user), canEditCollectionTracks: vi.fn().mockReturnValue(true),
    canSubscribeCollection: vi.fn(value => value.providerId === 'netease'), getSubscriptionStatus: vi.fn().mockResolvedValue(false),
    subscribe: vi.fn().mockResolvedValue(undefined) };
  const changed = vi.fn(), flush = vi.fn().mockResolvedValue(undefined);
  const editor = createMobilePlaylistEditor(api as unknown as typeof omni, () => { const ticket = epoch; return () => ticket === epoch; },
    flush, vi.fn(), vi.fn(), changed);
  const open = async (collection = album) => {
    const controller = (await editor.subscription(collection, await editor.readAccount(collection.providerId)))!;
    const unsubscribe = controller.subscribe(() => {});
    await vi.waitFor(() => expect(controller.getSnapshot().subscribed).toBeTypeOf('boolean'));
    return { controller, close() { unsubscribe(); controller.dispose(); } };
  };
  return { editor, api, open, changed, flush, invalidate: () => epoch++ };
}
describe('mobile collection subscriptions', () => {
  it('reuses ownership and cloud restrictions and keeps QQ read-only', async () => {
    const { editor, api } = fixture(), account = await editor.readAccount('netease');
    expect(editor.canSubscribe(playlist, user)).toBe(true); expect(editor.canSubscribe(album, user)).toBe(true);
    for (const value of [{ ...playlist, creator: user }, { ...playlist, isOwned: true }, { ...playlist, creator: user, isLiked: true },
      { ...album, type: 'cloud' }, { ...playlist, id: -100 }, { ...album, type: 'artist' }, { ...album, providerId: 'qq' }]) {
      expect(editor.canSubscribe(value, user)).toBe(false);
      expect(await editor.subscription(value, account)).toBeNull();
    }
    expect(api.getSubscriptionStatus).not.toHaveBeenCalled(); expect(api.subscribe).not.toHaveBeenCalled();
  });
  it('does not create an actionable controller when status is unknown or malformed', async () => {
    const { editor, api } = fixture(), account = await editor.readAccount('netease');
    api.getSubscriptionStatus.mockRejectedValueOnce(new Error('secret cookie'));
    await expect(editor.subscription(album, account)).rejects.toThrow('subscription-unconfirmed');
    api.getSubscriptionStatus.mockResolvedValueOnce(undefined);
    await expect(editor.subscription(album, account)).rejects.toThrow('subscription-unconfirmed');
    expect(api.subscribe).not.toHaveBeenCalled();
  });
  it('single-flights a toggle and only commits confirmed results, even when dismissed', async () => {
    const { open, api, changed } = fixture(), first = await open(), pending = deferred();
    api.subscribe.mockReturnValueOnce(pending.promise);
    const saving = first.controller.toggleSubscribe();
    await vi.waitFor(() => expect(api.subscribe).toHaveBeenCalledOnce());
    expect(first.controller.getSnapshot().subscribed).toBe(false);
    expect(await first.controller.toggleSubscribe()).toMatchObject({ ok: false, reason: 'busy' });
    let reopened = false; const reading = open().then(value => { reopened = true; return value; });
    await Promise.resolve(); expect(reopened).toBe(false);
    first.close(); api.getSubscriptionStatus.mockResolvedValue(true); pending.resolve();
    expect(await saving).toEqual({ ok: true }); const second = await reading;
    expect(second.controller.getSnapshot().subscribed).toBe(true); expect(changed).toHaveBeenCalledOnce();
    expect(await second.controller.toggleSubscribe()).toEqual({ ok: true });
    expect(api.subscribe.mock.calls.map(call => call[1])).toEqual([true, false]); second.close();
  });
  it('requires a fresh read after an ambiguous write, does not retry, and never logs the raw error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { open, api } = fixture(), view = await open();
      api.subscribe.mockRejectedValueOnce(new Error('cookie=secret'));
      expect(await view.controller.toggleSubscribe()).toMatchObject({ ok: false, message: 'subscription-unconfirmed' });
      expect(view.controller.getSnapshot().subscribed).toBe(false);
      expect(await view.controller.toggleSubscribe()).toMatchObject({ ok: false });
      expect(api.subscribe).toHaveBeenCalledOnce(); expect(log.mock.calls.flat().map(String).join(' ')).not.toContain('secret');
      view.close(); api.getSubscriptionStatus.mockResolvedValue(true);
      const next = await open(); expect(next.controller.getSnapshot().subscribed).toBe(true); next.close();
    } finally { log.mockRestore(); }
  });
  it('rejects reads and writes from old sessions and detects a changed login before sending', async () => {
    const { open, editor, api, invalidate } = fixture(), account = await editor.readAccount('netease');
    const pending = deferred<boolean>(); api.getSubscriptionStatus.mockReturnValueOnce(pending.promise);
    const reading = editor.subscription(album, account); await vi.waitFor(() => expect(api.getSubscriptionStatus).toHaveBeenCalled());
    invalidate(); pending.resolve(false); await expect(reading).rejects.toThrow();
    const view = await open(); api.getLoginStatus.mockResolvedValueOnce({ id: 11 });
    expect(await view.controller.toggleSubscribe()).toMatchObject({ ok: false });
    expect(api.subscribe).not.toHaveBeenCalled(); view.close();
  });
  it('discards a sent write result after logout and does not refresh another account', async () => {
    const { open, api, invalidate, changed } = fixture(), view = await open(), pending = deferred();
    api.subscribe.mockReturnValueOnce(pending.promise); const saving = view.controller.toggleSubscribe();
    await vi.waitFor(() => expect(api.subscribe).toHaveBeenCalledOnce()); invalidate(); pending.resolve();
    expect(await saving).toMatchObject({ ok: false }); expect(changed).not.toHaveBeenCalled();
    expect(view.controller.getSnapshot().subscribed).toBe(false); view.close();
  });
  it('refuses an unpersisted session before issuing a write', async () => {
    const { open, api, flush } = fixture(), view = await open(); flush.mockRejectedValueOnce(new Error('keychain'));
    expect(await view.controller.toggleSubscribe()).toMatchObject({ ok: false }); expect(api.subscribe).not.toHaveBeenCalled(); view.close();
  });
});
