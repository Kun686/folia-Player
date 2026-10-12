import type { Page } from '@playwright/test';
import { subscriptionFixture } from './subscriptions-fixture';

// recommended-playlists-fixture.ts — original API envelopes, paged tracks and account changes through the existing test bridge.
export async function recommendedFixture(page: Page) {
  await subscriptionFixture(page);
  await page.addInitScript(() => {
    const w = window as any, previous = w.fixtureOnlineRequest;
    w.fixtureHealth.recommendedCollectionProviders = ['netease'];
    w.recommendationCalls = []; w.recommendedSubscribed = false; w.recommendedWrites = [];
    const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const card = (id: number) => ({ id, type: 0, name: '推荐歌单' + (id - 199), copywriter: '原版推荐说明', trackCount: 151 });
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid'), path = url.pathname;
      if (payload.provider !== 'netease') return previous(payload);
      if (path === '/personalized') {
        w.recommendationCalls.push({ path, limit: url.searchParams.get('limit') });
        if (w.recommendationDelay) await new Promise<void>(resolve => { w.releaseRecommendations = resolve; });
        return reply(w.recommendationFailure ? { code: 301 } : w.recommendationMalformed ? { code: 200 } :
          { code: 200, result: w.recommendationEmpty ? [] : Array.from({ length: 35 }, (_, i) => card(200 + i)) });
      }
      if (path === '/user/playlist') return reply({ code: 200, more: false,
        playlist: w.recommendedSubscribed ? [{ ...card(200), creator: { userId: 10, nickname: '作者' } }] : [] });
      const id = Number(url.searchParams.get('id'));
      if (id < 200 || id > 234) return previous(payload);
      if (path === '/playlist/detail') {
        w.recommendationCalls.push({ path, id });
        if (w.recommendationDetailDelay) await new Promise<void>(resolve => { w.releaseRecommendationDetail = resolve; });
        return reply(w.recommendationDetailFailure ? { code: 502 } : { code: 200, playlist: { ...card(id),
          creator: w.recommendationOwnerMissing ? {} : { userId: w.recommendationOwned ? 9 : 10, nickname: '作者' } } });
      }
      if (path === '/playlist/track/all') {
        const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
        w.recommendationCalls.push({ path, id, offset, limit });
        if (offset && w.recommendationPageFailure) return reply({ code: 502 });
        return reply({ code: 200, songs: Array.from({ length: 151 }, (_, i) => ({ id: 1000 + i, name: '推荐歌曲' + (i + 1),
          ar: [{ id: 1, name: '歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 })).slice(offset, offset + limit) });
      }
      if (path === '/playlist/detail/dynamic') return reply({ code: 200, subscribed: w.recommendedSubscribed });
      if (path === '/playlist/subscribe') {
        const t = url.searchParams.get('t'); w.recommendedWrites.push({ id, t }); w.recommendedSubscribed = t === '1';
        return reply({ code: 200 });
      }
      return previous(payload);
    };
  });
}
