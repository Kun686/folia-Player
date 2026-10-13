import type { Page } from '@playwright/test';
import { test, expect, openPlayerTools } from './fixtures';

// song-info.spec.ts — touch copy/open actions use real metadata and providers with a controlled native clipboard.
const title = '<歌曲> & 一段很长的歌名'.repeat(5);
const song = (provider = 'netease', name = title) => ({ id: 42, name, artists: [{ id: 1, name: '甲' }, { id: 2, name: '乙' }],
  album: { id: 3, name: '专辑 & <Album>' }, durationMs: 180000,
  sourceRef: provider === 'local' ? { kind: 'local', mediaId: 'same-id' } : { kind: 'online', providerId: provider, mediaId: '42' },
  providerData: { url: 'https://cdn.invalid/signed?token=private', cookie: 'private-cookie' } });
const details = (page: Page) => page.locator('.song-info-details');
const copy = (page: Page) => details(page).getByRole('button', { name: '复制歌曲信息', exact: true });
const clipboard = (page: Page) => page.evaluate(() => (window as any).fixtureClipboard);
async function emit(page: Page, provider = 'netease', name = title) {
  await page.evaluate(song => (window as any).fixtureEmitPlayback({ currentSong: song, queue: [song], index: 0, playing: false }), song(provider, name));
}
async function start(page: Page, provider = 'netease') {
  await page.goto('/mobile.html'); await emit(page, provider);
  await page.locator('.mini-title').tap(); await openPlayerTools(page);
  await details(page).locator('summary').tap();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    (window as any).fixtureLyricTools = true;
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
  });
});

test('copies the original metadata format, handles errors and fits long names after rotation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await expect(details(page).getByText(title, { exact: true })).toBeVisible();
  await expect(details(page).locator('img')).toHaveCount(0);
  const link = details(page).getByRole('link', { name: '打开官方歌曲页', exact: true });
  await expect(link).toHaveAttribute('href', 'https://music.163.com/#/song?id=42');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await page.evaluate(() => { (window as any).fixtureClipboardFailure = true; });
  await copy(page).tap(); await expect(details(page).getByRole('alert')).toHaveText('复制失败，请重试');
  await expect(details(page).getByRole('status')).toHaveCount(0);
  await page.evaluate(() => { (window as any).fixtureClipboardFailure = false; });
  await copy(page).tap();
  await expect(details(page).getByRole('status')).toHaveText('已复制歌曲信息');
  await expect(details(page).getByRole('alert')).toHaveCount(0);
  expect(await clipboard(page)).toBe(title + ' - 甲, 乙 - 专辑 & <Album>\nhttps://music.163.com/#/song?id=42');
  for (const viewport of [page.viewportSize()!, info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 }]) {
    await page.setViewportSize(viewport); await link.scrollIntoViewIfNeeded();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await copy(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.getByRole('dialog', { name: '更多播放选项', exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('song-info.png') });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(errors).toEqual([]);
});

test('keeps local and QQ metadata distinct and ignores a previous song’s clipboard receipt', async ({ page }) => {
  await start(page, 'local');
  await expect(details(page).getByRole('link')).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any, original = w.Capacitor.nativePromise;
    w.copyAttempts = 0;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method !== 'copyText') return original(plugin, method, options);
      w.copyAttempts++;
      const result = await original(plugin, method, options);
      if (w.copyAttempts === 1) await new Promise<void>(resolve => { w.releaseCopyReceipt = resolve; });
      return result;
    };
  });
  await copy(page).tap(); await expect(copy(page)).toBeDisabled();
  await copy(page).dispatchEvent('click');
  expect(await page.evaluate(() => (window as any).copyAttempts)).toBe(1);
  expect(await clipboard(page)).toBe(title + ' - 甲, 乙 - 专辑 & <Album>');
  await emit(page, 'qq', 'QQ 曲目');
  await expect(copy(page)).toBeEnabled();
  await expect(details(page).getByRole('link')).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseCopyReceipt());
  await expect(details(page).getByRole('status')).toHaveCount(0);
  await copy(page).tap();
  await expect(details(page).getByRole('status')).toHaveText('已复制歌曲信息');
  expect(await clipboard(page)).toBe('QQ 曲目 - 甲, 乙 - 专辑 & <Album>');
  await emit(page, 'netease', '网易云曲目');
  await expect(details(page).getByRole('status')).toHaveCount(0);
  await expect(details(page).getByRole('link')).toHaveAttribute('href', 'https://music.163.com/#/song?id=42');
  await copy(page).tap();
  expect(await clipboard(page)).toBe('网易云曲目 - 甲, 乙 - 专辑 & <Album>\nhttps://music.163.com/#/song?id=42');
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('a queue row copies its selected song without selecting or playing it', async ({ page }) => {
  await page.goto('/mobile.html');
  const current = song('netease', '正在播放'), selected = song('qq', '所选QQ');
  await page.evaluate(({ current, selected }) => (window as any).fixtureEmitPlayback({
    queue: [current, selected], currentSong: current, index: 0, playing: false,
  }), { current, selected });
  await page.locator('.section-heading').getByRole('button').tap();
  await page.getByRole('button', { name: '歌曲操作 所选QQ', exact: true }).tap();
  const menu = page.getByRole('dialog', { name: '歌曲操作', exact: true });
  await menu.getByRole('button', { name: '复制歌曲信息', exact: true }).tap();
  await expect(menu.getByRole('status')).toHaveText('已复制歌曲信息');
  await expect(menu.getByRole('link', { name: '打开官方歌曲页', exact: true })).toHaveCount(0);
  expect(await clipboard(page)).toBe('所选QQ - 甲, 乙 - 专辑 & <Album>');
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.name)).toBe('正在播放');
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('explicit page link opens a separate context without sending credentials or changing playback', async ({ page, context }) => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  await context.route('https://music.163.com/**', async route => {
    requests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
    await route.fulfill({ contentType: 'text/html', body: '<title>Controlled song page</title><p>Public page fixture</p>' });
  });
  await start(page);
  const popupPromise = page.waitForEvent('popup');
  await details(page).getByRole('link', { name: '打开官方歌曲页', exact: true }).tap();
  const popup = await popupPromise;
  await expect(popup).toHaveTitle('Controlled song page');
  expect(page.url()).toContain('/mobile.html');
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.headers.authorization).toBeUndefined(); expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.referer).toBeUndefined(); expect(request.url).not.toContain('private');
  }
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await popup.close();
});
