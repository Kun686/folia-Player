import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// queue-preference.spec.ts — original persisted preference over the real touch handlers and controlled queue bridge.
const settings = (page: Page) => page.getByRole('dialog', { name: '服务器与外观', exact: true });
const preference = (page: Page) => settings(page).getByRole('combobox', { name: '加入队列的默认位置', exact: true });
async function choose(page: Page, value: 'append' | 'next') {
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await preference(page).selectOption(value);
  await expect(preference(page)).toHaveValue(value);
  await settings(page).getByRole('button', { name: '关闭', exact: true }).tap();
}
async function search(page: Page) {
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('歌曲');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
}
const identities = (page: Page) => page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) =>
  s.sourceRef.kind === 'online' ? s.sourceRef.providerId + ':' + s.sourceRef.mediaId : 'local'));
async function menu(page: Page, song: string, action: string) {
  await page.getByRole('button', { name: '歌曲操作 ' + song, exact: true }).tap();
  await page.getByRole('dialog', { name: '歌曲操作', exact: true }).getByRole('button', { name: action, exact: true }).tap();
}
test.beforeEach(async ({ page }) => {
  await searchPlaybackFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page);
});

test('queue preference persists and generic additions honor it while explicit next and end remain exact', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await expect(preference(page)).toHaveValue('append');
  await preference(page).selectOption('next');
  expect(await page.evaluate(() => localStorage.getItem('queue_add_behavior'))).toBe('next');
  await page.reload(); await seedSearchQueue(page);
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await expect(preference(page)).toHaveValue('next');
  await page.setViewportSize(info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 });
  await preference(page).scrollIntoViewIfNeeded();
  await expect(preference(page)).toBeVisible();
  expect((await preference(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await settings(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('queue-preference.png') });
  await settings(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await search(page);
  await page.getByRole('button', { name: '加入队列 搜索歌曲101', exact: true }).tap();
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'netease:101', 'netease:100']);
  await menu(page, '搜索歌曲101', '移到队尾');
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'netease:100', 'netease:101']);
  await choose(page, 'append');
  await menu(page, '搜索歌曲101', '下一首播放');
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'netease:101', 'netease:100']);
  await page.getByRole('button', { name: '加入队列 搜索歌曲101', exact: true }).tap();
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'netease:100', 'netease:101']);
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap(); await search(page);
  await page.getByRole('button', { name: '加入队列 QQ搜索歌曲100', exact: true }).tap();
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'netease:100', 'netease:101', 'qq:qq-100']);
  await choose(page, 'next');
  await page.getByRole('button', { name: '加入队列 QQ搜索歌曲100', exact: true }).tap();
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'qq:qq-100', 'netease:100', 'netease:101']);
  await page.getByRole('button', { name: '本地音乐', exact: true }).tap();
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '加入队列 本地测试音乐', exact: true }).tap();
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'local', 'qq:qq-100', 'netease:100', 'netease:101']);
  expect(await page.evaluate(() => ({ position: (window as any).fixturePlayback.position, playing: (window as any).fixturePlayback.playing,
    id: (window as any).fixturePlayback.currentSong.sourceRef.mediaId }))).toEqual({ position: 42, playing: false, id: 'qq-101' });
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls.every((call: any) => call.method === 'editQueue'))).toBe(true);
  expect(errors).toEqual([]);
});

test('queue preference reports storage failure and an in-flight add retains the choice made at the gesture', async ({ page }) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem, win = window as any;
    win.failQueuePreference = true;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'queue_add_behavior' && win.failQueuePreference) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await preference(page).selectOption('next');
  await expect(preference(page)).toHaveValue('append');
  await expect(settings(page).getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('queue_add_behavior'))).toBeNull();
  await page.evaluate(() => { (window as any).failQueuePreference = false; });
  await preference(page).selectOption('next');
  await expect(settings(page).getByRole('alert')).toHaveCount(0);
  await settings(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await search(page);
  await page.evaluate(() => { (window as any).searchDelayState = true; });
  await page.getByRole('button', { name: '加入队列 搜索歌曲101', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSearchState)).toBe('function');
  await choose(page, 'append');
  await page.evaluate(() => { const win = window as any; win.searchDelayState = false; win.releaseSearchState(); });
  await expect.poll(() => identities(page)).toEqual(['qq:qq-101', 'netease:101', 'netease:100']);
  expect(await page.evaluate(() => localStorage.getItem('queue_add_behavior'))).toBe('append');
});
