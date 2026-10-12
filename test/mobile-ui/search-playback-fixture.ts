import type { Page } from '@playwright/test';
import { accountLibraryFixture } from './account-library-fixture';

// search-playback-fixture.ts — real search adapters over controlled replies and versioned native bridge behavior.
export async function searchPlaybackFixture(page: Page) {
  await accountLibraryFixture(page);
  await page.addInitScript(() => {
    const w = window as any, request = w.fixtureOnlineRequest, bridge = w.Capacitor.nativePromise;
    w.searchCalls = []; w.searchPlaybackCalls = [];
    const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const song = (id: number) => ({ id, name: '搜索歌曲' + id, ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000,
      ...(w.searchUnavailable && id === 101 ? { privilege: { st: -200 }, noCopyrightRcmd: { typeDesc: '该歌曲暂不可播放' } } : {}) });
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      if (url.pathname === '/user/playlist' && payload.provider === 'netease') return reply({ code: 200,
        playlist: [{ id: 8, name: '搜索回归歌单', creator: { userId: 9 }, trackCount: 2 }], more: false });
      if (url.pathname === '/playlist/track/all') return reply({ code: 200, songs: [song(200), song(201)] });
      if (url.pathname === '/cloudsearch') {
        const offset = Number(url.searchParams.get('offset'));
        w.searchCalls.push({ provider: 'netease', query: url.searchParams.get('keywords'), offset });
        if (w.searchDelay) await new Promise<void>(resolve => { w.releaseSearch = resolve; });
        if (w.searchFailure) return reply({ code: 301 });
        if (w.searchMalformed) return reply({ code: 200, result: { songs: {}, songCount: 3 } });
        return reply({ code: 200, result: w.searchEmpty ? { songCount: 0 } : { songs: (offset ? [102] : [100, 101]).map(song), songCount: 3 } });
      }
      if (url.hostname === 'u.y.qq.com' && payload.body) {
        const data = JSON.parse(payload.body);
        if (data.request.method === 'DoSearchForQQMusicLite') {
          w.searchCalls.push({ provider: 'qq', query: data.request.param.query, page: data.request.param.page_num });
          return reply({ code: 0, request: { code: 0, data: { body: { item_song: [100, 101].map(id => ({ id, mid: 'qq-' + id,
            title: 'QQ搜索歌曲' + id, singer: [{ id: 1, name: '测试歌手' }], album: { id: 1, name: '专辑' }, interval: 180 })) } } } });
        }
      }
      return request(payload);
    };
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (['setQueue', 'editQueue', 'selectQueue'].includes(method)) w.searchPlaybackCalls.push({ method, ...structuredClone(options) });
      if (method === 'getState' && w.searchDelayState) await new Promise<void>(resolve => { w.releaseSearchState = resolve; });
      if (method === 'selectQueue' && w.searchStaleSelect) throw new Error('queue-changed');
      return bridge(plugin, method, options);
    };
  });
}
export async function seedSearchQueue(page: Page) {
  await page.evaluate(() => {
    const song = (providerId: string, id: string) => ({ id, name: providerId + '原队列歌曲', artists: [], album: { id: 1, name: '原专辑' }, durationMs: 180000,
      sourceRef: { kind: 'online', providerId, mediaId: id } });
    const queue = [song('qq', 'qq-101'), song('netease', '100')];
    (window as any).fixtureEmitPlayback({ queue, index: 0, currentSong: queue[0], position: 42, playing: false });
  });
}
