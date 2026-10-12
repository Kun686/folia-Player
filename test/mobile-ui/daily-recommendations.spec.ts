import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { dailyFixture } from './daily-recommendations-fixture';

// daily-recommendations.spec.ts — actual Omni/adapters/controller over a controlled native transport.
const sheet = (page: Page) => page.getByRole('dialog', { name: '每日推荐', exact: true });
async function login(page: Page) {
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('dialog', { name: '扫码登录' }).getByRole('button', { name: '关闭', exact: true }).tap();
}
async function open(page: Page) {
  await page.getByRole('button', { name: '每日推荐', exact: true }).tap();
  await expect(sheet(page).getByRole('button', { name: '播放 今日歌曲一', exact: true })).toBeVisible();
}
async function dislike(page: Page, name = '今日歌曲一') {
  await sheet(page).getByRole('button', { name: '歌曲操作 ' + name, exact: true }).tap();
  await page.getByRole('button', { name: '不喜欢，换一首', exact: true }).tap();
}
test('today, historical date and refresh use original identities and the native queue across rotation', async ({ page }, info) => {
  await dailyFixture(page); await login(page); await open(page);
  const dateControl = await sheet(page).getByRole('combobox', { name: '推荐日期' }).boundingBox();
  expect(dateControl!.height).toBeGreaterThanOrEqual(44);
  await sheet(page).getByRole('combobox', { name: '推荐日期' }).selectOption('2026-10-11');
  await expect(sheet(page).getByRole('button', { name: '播放 历史歌曲', exact: true })).toBeVisible();
  await sheet(page).getByRole('button', { name: '歌曲操作 历史歌曲', exact: true }).tap();
  await expect(page.getByRole('button', { name: '不喜欢，换一首', exact: true })).toHaveCount(0);
  await page.getByRole('dialog', { name: '歌曲操作', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
  await sheet(page).getByRole('combobox', { name: '推荐日期' }).selectOption('');
  await sheet(page).getByRole('button', { name: '刷新今日推荐', exact: true }).tap();
  await expect(sheet(page).getByRole('button', { name: '播放 刷新歌曲', exact: true })).toBeVisible();
  const size = page.viewportSize()!; await page.setViewportSize({ width: size.height, height: size.width });
  await expect(sheet(page).getByRole('button', { name: '播放 刷新歌曲', exact: true })).toBeVisible();
  await page.setViewportSize(size); await page.screenshot({ path: info.outputPath('daily.png') });
  await sheet(page).getByRole('button', { name: '播放 刷新歌曲', exact: true }).tap();
  await expect(sheet(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue[0].sourceRef)).toEqual({ kind: 'online', providerId: 'netease', mediaId: '301' });
  expect(await page.evaluate(() => (window as any).dailyRequests.every((value: any) => value.provider === 'netease'))).toBe(true);
});
test('failed history keeps today; failed dislike retains rows until explicit reread, then confirmed replacement works', async ({ page }) => {
  await dailyFixture(page); await login(page); await open(page); page.on('dialog', dialog => dialog.accept());
  await page.evaluate(() => { (window as any).historyDetailCode = 500; });
  await sheet(page).getByRole('combobox', { name: '推荐日期' }).selectOption('2026-10-11');
  await expect(sheet(page).getByRole('alert')).toBeVisible();
  await expect(sheet(page).getByRole('combobox', { name: '推荐日期' })).toHaveValue('');
  await expect(sheet(page).getByRole('button', { name: '播放 今日歌曲一', exact: true })).toBeVisible();
  await sheet(page).getByRole('button', { name: '重新读取推荐', exact: true }).tap();
  await page.evaluate(() => { (window as any).dislikeCode = 500; }); await dislike(page);
  await expect(sheet(page).getByRole('alert')).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: '播放 今日歌曲一', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).dislikeCode = 200; });
  await sheet(page).getByRole('button', { name: '重新读取推荐', exact: true }).tap(); await dislike(page);
  await expect(sheet(page).getByRole('button', { name: '播放 替换歌曲', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).dailyRequests.filter((value: any) => value.path.endsWith('/dislike')).length)).toBe(2);
});
test('dislike limit preserves songs, disables another mutation and keeps playback available', async ({ page }) => {
  await dailyFixture(page); await login(page); await open(page); page.on('dialog', dialog => dialog.accept());
  await page.evaluate(() => { (window as any).dislikeCode = 432; }); await dislike(page);
  await expect(sheet(page).getByText('今天的换歌次数已达上限。', { exact: true })).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: '播放 今日歌曲一', exact: true })).toBeEnabled();
  await sheet(page).getByRole('button', { name: '歌曲操作 今日歌曲二', exact: true }).tap();
  await expect(page.getByRole('button', { name: '不喜欢，换一首', exact: true })).toBeDisabled();
});
test('closing and reopening a pending dislike waits instead of resending; canceled confirmation sends nothing', async ({ page }) => {
  await dailyFixture(page); await login(page); await open(page);
  page.once('dialog', dialog => dialog.dismiss()); await dislike(page);
  expect(await page.evaluate(() => (window as any).dailyRequests.some((value: any) => value.path.endsWith('/dislike')))).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await page.evaluate(() => { (window as any).delayDislike = true; });
  await page.getByRole('button', { name: '不喜欢，换一首', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseDislike)).toBe('function');
  await sheet(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '每日推荐', exact: true }).tap();
  await expect(sheet(page).getByRole('status')).toBeVisible();
  await page.evaluate(() => (window as any).releaseDislike());
  await expect(sheet(page).getByRole('button', { name: '播放 替换歌曲', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).dailyRequests.filter((value: any) => value.path.endsWith('/dislike')).length)).toBe(1);
});
test('history access failure is separate; anonymous and old gateways cannot load personal recommendations', async ({ page }) => {
  await dailyFixture(page); await page.addInitScript(() => { (window as any).historyCode = 403; });
  await page.goto('/mobile.html');
  await expect(page.getByRole('button', { name: '每日推荐', exact: true })).toBeDisabled();
  await login(page); await open(page);
  await expect(sheet(page).getByRole('alert')).toContainText('历史推荐暂不可用');
  await expect(sheet(page).getByRole('button', { name: '播放 今日歌曲一', exact: true })).toBeEnabled();
  await sheet(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.addInitScript(() => { (window as any).fixtureHealth.dailyProviders = undefined; });
  await page.reload(); await expect(page.getByRole('button', { name: '每日推荐', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).dailyRequests)).toEqual([]);
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await expect(page.getByRole('button', { name: '每日推荐', exact: true })).toHaveCount(0);
});

test('daily songs reuse the common favorite, playlist and album actions without leaving a hidden modal over playback', async ({ page }) => {
  await dailyFixture(page); await login(page); await open(page);
  await sheet(page).getByRole('button', { name: '歌曲操作 今日歌曲一', exact: true }).tap();
  await expect(page.getByRole('button', { name: '加入在线歌单', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '专辑：专辑', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '专辑：专辑', exact: true }).tap();
  await expect(sheet(page)).toHaveCount(0);
  const catalog = page.getByRole('dialog', { name: '在线音乐目录', exact: true });
  await expect(catalog.getByRole('button', { name: '播放 专辑歌曲', exact: true })).toBeVisible();
  await catalog.getByRole('button', { name: '播放 专辑歌曲', exact: true }).tap();
  await expect(catalog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue[0].sourceRef.mediaId)).toBe('501');
});
