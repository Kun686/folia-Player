import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// playlist-response.spec.ts — malformed/empty pages through real providers; no live account requests.
async function fixture(page: Page, provider: 'qq' | 'netease', options = { publicPlaylist: false, libraryCount: 1, emptyTracks: false }) {
  await searchPlaybackFixture(page);
  await page.addInitScript(options => {
    const w = window as any, previous = w.fixtureOnlineRequest;
    w.playlistPageCalls = [];
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      const path = url.pathname.startsWith('/getSongListDetail/') ? '/getSongListDetail' : url.pathname;
      if (!['/user/playlist', '/playlist/track/all', '/user/playlist-detail', '/getSongListDetail'].includes(path)) return previous(payload);
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit')) || 50;
      w.playlistPageCalls.push({ provider: payload.provider, path, offset });
      const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
      if (path === '/user/playlist') {
        const rows = Array.from({ length: options.libraryCount }, (_, i) => payload.provider === 'qq'
          ? options.publicPlaylist ? { dissid: String(i + 1), name: '分页歌单' + (i + 1), songnum: 51 }
            : { tid: String(i + 1), dirId: i + 1, dirName: '分页歌单' + (i + 1), songNum: 51 }
          : { id: i + 1, name: '分页歌单' + (i + 1), creator: { userId: 9 }, trackCount: 51 });
        return reply({ code: 200, playlist: w.badLibrary ? {} : payload.provider === 'qq' ? rows : rows.slice(offset, offset + limit),
          total: rows.length, more: payload.provider !== 'qq' && offset + limit < rows.length });
      }
      const rows = Array.from({ length: options.emptyTracks ? 0 : 51 }, (_, i) => payload.provider === 'qq'
        ? { id: i + 1, mid: String(i + 1), title: '歌单歌曲' + (i + 1), singer: [{ id: 1, name: '歌手' }], album: { id: 1, name: '专辑' }, interval: 180 }
        : { id: i + 1, name: '歌单歌曲' + (i + 1), ar: [{ id: 1, name: '歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 });
      if (path === '/getSongListDetail') return reply({ response: { code: 0, cdlist: [{ disstid: '1', dissname: '分页歌单1',
        songnum: rows.length, songlist: w.badTracks ? {} : rows }] } });
      return reply({ code: 200, songs: w.badTracks ? {} : rows.slice(offset, offset + limit), total: rows.length, more: offset + limit < rows.length });
    };
  }, options);
  await page.goto('/mobile.html'); await seedSearchQueue(page);
  if (provider === 'qq') await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
}

for (const provider of ['qq', 'netease'] as const) {
  test(`${provider} malformed personal playlist page retains the library and offers retry`, async ({ page }) => {
    await fixture(page, provider, { libraryCount: 101, publicPlaylist: false, emptyTracks: false });
    await expect(page.locator('.collections button')).toHaveCount(100);
    await page.evaluate(() => { (window as any).badLibrary = true; });
    await page.getByRole('button', { name: '加载更多歌单', exact: true }).tap();
    await expect(page.getByRole('button', { name: '重试歌单加载', exact: true })).toBeVisible();
    await expect(page.locator('.collections button')).toHaveCount(100);
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
    await page.evaluate(() => { (window as any).badLibrary = false; });
    await page.getByRole('button', { name: '重试歌单加载', exact: true }).tap();
    await expect(page.getByRole('button', { name: '重试歌单加载', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '加载更多歌单', exact: true }).tap();
    await expect(page.locator('.collections button')).toHaveCount(101);
    await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
  });

  test(`${provider} confirmed empty personal library is not an error or a logout`, async ({ page }) => {
    await fixture(page, provider, { libraryCount: 0, publicPlaylist: false, emptyTracks: false });
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
    await expect(page.locator('.collections button')).toHaveCount(0);
    await expect(page.locator('.library-panel').getByRole('status')).toHaveCount(0);
    await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重试歌单加载', exact: true })).toHaveCount(0);
  });
}

for (const [provider, publicPlaylist] of [['qq', false], ['qq', true], ['netease', false]] as const) {
  test(`${provider} ${publicPlaylist ? 'public' : 'owned'} malformed track page preserves songs and retries its cursor`, async ({ page }) => {
    await fixture(page, provider, { libraryCount: 1, publicPlaylist, emptyTracks: false });
    await page.getByRole('button', { name: '分页歌单1', exact: true }).tap();
    // SongList virtualizes its rows; use the original scope count, not mounted DOM nodes.
    await expect(page.getByText('当前范围 50 首', { exact: true })).toBeVisible();
    await page.evaluate(() => { (window as any).badTracks = true; });
    await page.getByRole('button', { name: '加载更多', exact: true }).tap();
    await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible();
    await expect(page.getByText('当前范围 50 首', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
    await page.evaluate(() => { (window as any).badTracks = false; });
    await page.getByRole('button', { name: '重试歌曲加载', exact: true }).tap();
    await expect(page.getByText('当前范围 51 首', { exact: true })).toBeVisible();
    const path = provider === 'netease' ? '/playlist/track/all' : publicPlaylist ? '/getSongListDetail' : '/user/playlist-detail';
    expect(await page.evaluate(path => (window as any).playlistPageCalls.filter((call: any) => call.path === path).map((call: any) => call.offset), path))
      .toEqual(publicPlaylist ? [0, 0, 0] : [0, 50, 50]);
    await page.locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.getByRole('button', { name: '播放 歌单歌曲51', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.index)).toBe(50);
    expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.sourceRef)).toMatchObject({ providerId: provider, mediaId: '51' });
  });

  test(`${provider} ${publicPlaylist ? 'public' : 'owned'} confirmed empty tracks stop paging without retry`, async ({ page }) => {
    await fixture(page, provider, { libraryCount: 1, publicPlaylist, emptyTracks: true });
    await page.getByRole('button', { name: '分页歌单1', exact: true }).tap();
    await expect(page.locator('.library-panel').getByRole('status')).toHaveCount(0);
    await expect(page.locator('.song-main')).toHaveCount(0);
    await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toHaveCount(0);
  });
}
