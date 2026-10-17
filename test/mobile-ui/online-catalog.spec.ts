import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { catalogFixture, queueQqSong } from './online-catalog-fixture';

// online-catalog.spec.ts — touch navigation, real provider identities/resources, failure and disposal across viewport sizes.
const catalog = (page: Page) => page.getByRole('dialog', { name: '在线音乐目录', exact: true });
async function search(page: Page) {
  await page.goto('/mobile.html');
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('测试');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 测试歌曲', exact: true }).tap();
}
async function queue(page: Page) {
  await queueQqSong(page);
  await page.getByRole('button', { name: '播放队列 · 1', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 QQ目录歌曲', exact: true }).tap();
}

test('NetEase artist pages retain loaded albums on failure, retry and navigate into playable albums', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await catalogFixture(page); await search(page);
  await page.evaluate(() => { (window as any).catalogAlbumFailure = true; });
  await page.getByRole('button', { name: '歌手：测试歌手', exact: true }).tap();
  const sheet = catalog(page);
  await expect(sheet.getByRole('button', { name: '播放 目录歌曲', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: '专辑', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: '专辑：作品专辑1', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).catalogAlbumFailure = false; });
  await sheet.getByRole('button', { name: '重试', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).catalogRequests.filter((r: any) => r.path === '/artist/album').map((r: any) => r.query.offset))).toEqual(['0', '50', '50']);
  await sheet.locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await sheet.getByRole('button', { name: '专辑：作品专辑51', exact: true }).tap();
  await expect(sheet.getByRole('heading', { name: '作品专辑51', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '播放 目录歌曲', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: '加入队列 目录歌曲', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue[0]?.sourceRef)).toMatchObject({ providerId: 'netease', mediaId: '131' });
  await sheet.getByRole('button', { name: '返回上一级', exact: true }).tap();
  await expect(sheet.getByRole('heading', { name: '测试歌手', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: '专辑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: '专辑：作品专辑1', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: '热门歌曲', exact: true }).tap();
  await sheet.getByRole('button', { name: '歌曲操作 目录歌曲', exact: true }).tap();
  await page.getByRole('dialog', { name: '歌曲操作', exact: true }).getByRole('button', { name: '专辑：专辑', exact: true }).tap();
  await expect(sheet.getByRole('heading', { name: '专辑', exact: true })).toBeVisible();
  const original = page.viewportSize()!;
  for (const size of [original, { width: original.height, height: original.width }, original]) {
    await page.setViewportSize(size);
    await expect(sheet.getByRole('button', { name: '播放 目录歌曲', exact: true })).toBeVisible();
    const bounds = await sheet.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
  }
  await page.screenshot({ path: info.outputPath('catalog.png') });
  await sheet.getByRole('button', { name: '播放 目录歌曲', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
  expect(errors).toEqual([]);
});

test('QQ queued song resolves mids even while NetEase tab is selected, and nested menus keep the catalog open', async ({ page }) => {
  await catalogFixture(page); await page.goto('/mobile.html'); await queue(page);
  await page.getByRole('button', { name: '歌手：QQ歌手', exact: true }).tap();
  const sheet = catalog(page);
  await expect(sheet.getByRole('button', { name: '播放 QQ目录歌曲', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: '歌曲操作 QQ目录歌曲', exact: true }).tap();
  await page.getByRole('dialog', { name: '歌曲操作', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: '专辑', exact: true }).tap();
  await sheet.getByRole('button', { name: '专辑：QQ专辑', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: '播放 QQ目录歌曲', exact: true })).toBeVisible();
  // Re-entering the same artist starts a new history entry; returning restores the earlier tab.
  await sheet.getByRole('button', { name: '歌曲操作 QQ目录歌曲', exact: true }).tap();
  await page.getByRole('dialog', { name: '歌曲操作', exact: true }).getByRole('button', { name: '歌手：QQ歌手', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: '热门歌曲', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: '返回上一级', exact: true }).tap();
  await expect(sheet.getByRole('heading', { name: 'QQ专辑', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: '返回上一级', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: '专辑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: '专辑：QQ专辑', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: '播放 QQ目录歌曲', exact: true })).toBeVisible();
  const requests = await page.evaluate(() => (window as any).catalogRequests);
  expect(requests.find((r: any) => r.path === '/getSongInfo/catalogSong')?.provider).toBe('qq');
  expect(requests.filter((r: any) => r.path === '/getSingerHotsong').map((r: any) => r.query)).toEqual(expect.arrayContaining([
    expect.objectContaining({ singermid: 'catalogArtist', page: '1', limit: '10' })]));
  expect(requests.find((r: any) => r.path === '/getSingerAlbum')?.query).toMatchObject({ singermid: 'catalogArtist', page: '0' });
  expect(requests.find((r: any) => r.path === '/getAlbumInfo')?.query).toMatchObject({ albummid: 'catalogAlbum' });
  await sheet.getByRole('button', { name: '播放 QQ目录歌曲', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue[0]?.sourceRef)).toMatchObject({ providerId: 'qq', mediaId: 'catalogSong' });
});

test('catalog errors are retryable and valid empty results remain distinct', async ({ page }) => {
  await catalogFixture(page); await search(page);
  await page.evaluate(() => { (window as any).catalogFailure = true; });
  await page.getByRole('button', { name: '专辑：专辑', exact: true }).tap();
  const sheet = catalog(page);
  await expect(sheet.getByRole('alert')).toBeVisible();
  await expect(sheet.getByText('暂无结果', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).catalogFailure = false; (window as any).catalogEmpty = true; });
  await sheet.getByRole('button', { name: '重试', exact: true }).tap();
  await expect(sheet.getByText('暂无结果', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('alert')).toHaveCount(0);
});

test('closing during an album request prevents late content and cache writes', async ({ page }) => {
  await catalogFixture(page); await search(page);
  await page.evaluate(() => { (window as any).catalogDelay = true; });
  await page.getByRole('button', { name: '专辑：专辑', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).catalogPending?.length ?? 0)).toBeGreaterThan(0);
  await catalog(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.evaluate(() => { const win = window as any; win.catalogPending.forEach((resolve: () => void) => resolve()); win.catalogDelay = false; win.catalogFailure = true; });
  await expect(catalog(page)).toHaveCount(0);
  await page.getByRole('button', { name: '歌曲操作 测试歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '专辑：专辑', exact: true }).tap();
  await expect(catalog(page).getByRole('alert')).toBeVisible();
  await expect(catalog(page).getByRole('button', { name: '播放 目录歌曲', exact: true })).toHaveCount(0);
});

test('closing while QQ identifiers resolve does not open a stale catalog', async ({ page }) => {
  await catalogFixture(page); await page.goto('/mobile.html'); await queue(page);
  await page.evaluate(() => { (window as any).catalogResolveDelay = true; });
  await page.getByRole('button', { name: '专辑：QQ专辑', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseCatalogResolve)).toBe('function');
  await catalog(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.evaluate(() => (window as any).releaseCatalogResolve());
  await expect(catalog(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).catalogRequests.some((r: any) => r.path === '/getAlbumInfo'))).toBe(false);
});

test('old gateways expose an explanation without attempting unsupported catalog requests', async ({ page }) => {
  await catalogFixture(page);
  await page.addInitScript(() => { (window as any).fixtureHealth = { protocol: 1, providers: ['netease', 'qq'] }; });
  await search(page);
  await expect(page.getByRole('button', { name: '专辑：专辑', exact: true })).toBeDisabled();
  await expect(page.getByText('当前连接尚不支持专辑与歌手浏览，请检查连接或更新音乐服务器。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).catalogRequests)).toEqual([]);
});
