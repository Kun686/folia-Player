import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture } from './search-playback-fixture';

// qq-search-response.spec.ts — mobile QQ responses retain retry/cursor/queue behavior.
async function search(page: Page) {
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('分页搜索');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
}
test.beforeEach(async ({ page }) => {
  await searchPlaybackFixture(page);
  await page.addInitScript(() => {
    const w = window as any, previous = w.fixtureOnlineRequest;
    w.qqSearchMode = 'normal'; w.qqSearchPages = [];
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      if (payload.provider !== 'qq' || url.pathname !== '/mobile/search') return previous(payload);
      const page = Number(url.searchParams.get('page'));
      w.qqSearchPages.push(page);
      if (w.qqSearchMode === 'upstream-error') return {
        status: 502, headers: {}, body: JSON.stringify({ code: 502, errorKey: 'unavailable' }),
      };
      const songs = Array.from({ length: page === 1 ? 50 : 1 }, (_, i) => {
        const id = (page - 1) * 50 + i + 1;
        return { id, mid: 'qq-search-' + id, title: 'QQ分页歌曲' + id,
          singer: [{ id: 1, name: '歌手' }], album: { id: 1, name: '专辑' }, interval: 180 };
      });
      const data = w.qqSearchMode === 'missing-data' ? undefined
        : w.qqSearchMode === 'missing-songs' ? { body: {} }
        : { body: { item_song: w.qqSearchMode === 'empty' ? [] : songs } };
      return { status: 200, headers: {}, body: JSON.stringify({
        code: 200, data,
      }) };
    };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
});

test('a missing QQ search payload offers retry rather than claiming no results', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => { (window as any).qqSearchMode = 'missing-data'; });
  await search(page);
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible();
  await expect(page.getByText('暂无结果', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('qq-search-error.png') });
  await page.evaluate(() => { (window as any).qqSearchMode = 'normal'; });
  await page.getByRole('button', { name: '重试歌曲加载', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 QQ分页歌曲1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).qqSearchPages)).toEqual([1, 1]);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a missing QQ song list preserves earlier pages and retries the same page before playback', async ({ page }, info) => {
  await search(page);
  await expect(page.getByRole('button', { name: '播放 QQ分页歌曲1', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).qqSearchMode = 'missing-songs'; });
  await page.getByRole('button', { name: '加载更多', exact: true }).tap();
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 QQ分页歌曲1', exact: true })).toBeVisible();
  // Check both ends of the virtual list without confusing mounted rows with loaded songs.
  await page.locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole('button', { name: '播放 QQ分页歌曲50', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
  await page.screenshot({ path: info.outputPath('qq-search-page-error.png') });
  await page.evaluate(() => { (window as any).qqSearchMode = 'normal'; });
  await page.getByRole('button', { name: '重试歌曲加载', exact: true }).tap();
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).qqSearchPages)).toEqual([1, 2, 2]);
  await page.locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole('button', { name: '播放 QQ分页歌曲51', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.currentSong?.sourceRef)).toMatchObject({
    providerId: 'qq', mediaId: 'qq-search-51',
  });
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.length)).toBe(1);
});

test('explicit empty QQ search stops paging without an error or logout', async ({ page }, info) => {
  await page.evaluate(() => { (window as any).qqSearchMode = 'empty'; });
  await search(page);
  await expect(page.getByText('暂无结果', { exact: true })).toBeVisible();
  await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).qqSearchPages)).toEqual([1]);
  await page.screenshot({ path: info.outputPath('qq-search-empty.png') });
});

test('QQ gateway business error remains retryable without logging out', async ({ page }) => {
  await page.evaluate(() => { (window as any).qqSearchMode = 'upstream-error'; });
  await search(page);
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible();
  await expect(page.getByText('暂无结果', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});
