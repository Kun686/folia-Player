import type { Page } from '@playwright/test';
import { accountLibraryFixture } from './account-library-fixture';

// subscriptions-fixture.ts — deterministic provider responses; no live account mutations.
export async function subscriptionFixture(page: Page) {
  await accountLibraryFixture(page);
  await page.addInitScript(() => {
    const w = window as any, previous = w.fixtureOnlineRequest;
    w.fixtureHealth.subscriptionProviders = ['netease'];
    w.subscriptions = { album: true, playlist: true }; w.subscriptionReads = []; w.subscriptionWrites = [];
    const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid'), path = url.pathname;
      if (payload.provider !== 'netease') return previous(payload);
      if (path === '/user/playlist') return reply({ code: 200, more: false, playlist: [
        { id: 8, name: '我的歌单', creator: { userId: 9 }, trackCount: 1 },
        ...(w.subscriptions.playlist ? [{ id: 9, name: '收藏歌单', creator: { userId: 10 }, trackCount: 1 }] : []),
      ] });
      if (path === '/album/sublist') return reply({ code: 200, hasMore: false, data: w.subscriptions.album ? [{ id: 1, name: '收藏专辑1' }] : [] });
      if (['/album/detail/dynamic', '/playlist/detail/dynamic'].includes(path)) {
        const type = path.includes('/album/') ? 'album' : 'playlist', value = w.subscriptions[type];
        w.subscriptionReads.push({ type, id: url.searchParams.get('id') });
        if (w.subscriptionReadDelay) await new Promise<void>(resolve => { w.releaseSubscriptionRead = resolve; });
        return reply(w.subscriptionReadFailure ? { code: 200 } : { code: 200, [type === 'album' ? 'isSub' : 'subscribed']: value });
      }
      if (['/album/sub', '/playlist/subscribe'].includes(path)) {
        const type = path === '/album/sub' ? 'album' : 'playlist', t = url.searchParams.get('t');
        w.subscriptionWrites.push({ type, t, id: url.searchParams.get('id') });
        if (w.subscriptionWriteDelay) await new Promise<void>(resolve => { w.releaseSubscriptionWrite = resolve; });
        if (!w.subscriptionWriteFailure || w.subscriptionAmbiguous) w.subscriptions[type] = t === '1';
        return reply({ code: w.subscriptionWriteFailure ? 502 : 200 });
      }
      return previous(payload);
    };
  });
}
