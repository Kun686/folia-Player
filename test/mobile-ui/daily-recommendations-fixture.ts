import type { Page } from '@playwright/test';

// daily-recommendations-fixture.ts — controlled transport; no real accounts or recommendation writes.
export async function dailyFixture(page: Page) {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureHealth = { protocol: 1, providers: ['netease', 'qq'], dailyProviders: ['netease'], catalogProviders: ['netease'], playlistEditProviders: ['netease'], songLikeProviders: ['netease'] };
    const song = (id: number, name: string) => ({ id, name, ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 });
    win.dailySongs = [song(101, '今日歌曲一'), song(102, '今日歌曲二')]; win.dailyRequests = [];
    win.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      if (url.pathname === '/album') return { status: 200, body: JSON.stringify({ code: 200, album: { id: 1, name: '推荐专辑' }, songs: [song(501, '专辑歌曲')] }), headers: {} };
      if (!url.pathname.includes('recommend/songs')) return;
      win.dailyRequests.push({ provider: payload.provider, path: url.pathname, query: Object.fromEntries(url.searchParams) });
      let body: any;
      if (url.pathname === '/recommend/songs') {
        if (win.delayDailyRead) await new Promise<void>(resolve => { win.releaseDailyRead = resolve; });
        if (url.searchParams.get('afresh') === 'true') win.dailySongs = [song(301, '刷新歌曲')];
        body = { code: win.dailyCode ?? 200, data: { dailySongs: win.dailySongs } };
      } else if (url.pathname === '/history/recommend/songs') {
        body = { code: win.historyCode ?? 200, data: { dates: [{ date: '2026-10-11' }] } };
      } else if (url.pathname === '/history/recommend/songs/detail') {
        body = { code: win.historyDetailCode ?? 200, data: { songs: [song(201, '历史歌曲')] } };
      } else if (url.pathname === '/recommend/songs/dislike') {
        if (win.delayDislike) await new Promise<void>(resolve => { win.releaseDislike = resolve; });
        const replacement = song(401, '替换歌曲');
        if (!win.dislikeCode || win.dislikeCode === 200) win.dailySongs = win.dailySongs.map((value: any) => String(value.id) === url.searchParams.get('id') ? replacement : value);
        body = { code: win.dislikeCode ?? 200, data: replacement };
      }
      return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
    };
  });
}
