import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture } from './search-playback-fixture';

// connection-recovery.spec.ts — recover capability discovery without replacing gateway or platform sessions.
async function connectionFixture(page: Page) {
  await searchPlaybackFixture(page);
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    w.connectionFailure = 'network'; w.connectionCalls = 0; w.connectionMutations = [];
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (['configure', 'clearSession'].includes(method)) w.connectionMutations.push(method);
      if (method === 'health') {
        w.connectionCalls++;
        const failure = w.connectionFailure;
        if (w.connectionDelay) await new Promise<void>(resolve => { w.finishConnection = resolve; });
        if (failure === 'network') throw new Error('network');
        if (failure === 'invalid') return { protocol: 2, providers: ['netease', 'qq'] };
      }
      return bridge(plugin, method, options);
    };
  });
}
async function signal(page: Page, event: 'online' | 'foreground', hidden = false) {
  await page.evaluate(({ event, hidden }) => {
    if (event === 'foreground') {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    } else window.dispatchEvent(new Event('online'));
  }, { event, hidden });
}
async function rendered(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const provider of ['netease', 'qq']) test(`${provider} retries a failed connection and restores account, search and playback`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await connectionFixture(page); await page.goto('/mobile.html');
  await page.getByRole('button', { name: provider === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
  await expect(page.locator('.library-panel').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeDisabled();
  const retry = page.locator('.connection-hint').getByRole('button', { name: '重试', exact: true });
  await expect(retry).toBeVisible();
  await page.screenshot({ path: info.outputPath('connection-error.png') });
  // An incompatible server reply must keep the retry path, without trusting its provider list.
  await page.evaluate(() => { (window as any).connectionFailure = 'invalid'; });
  await retry.tap(); await expect.poll(() => page.evaluate(() => (window as any).connectionCalls)).toBe(2);
  await expect(retry).toBeEnabled();
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).connectionFailure = ''; });
  await retry.tap();
  await expect(page.getByText(provider === 'qq' ? 'QQ fixture' : '测试用户', { exact: true })).toBeVisible();
  await expect(page.locator('.connection-hint')).toHaveCount(0);
  await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('歌曲');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  const title = provider === 'qq' ? 'QQ搜索歌曲100' : '搜索歌曲100';
  await page.getByRole('button', { name: `播放 ${title}`, exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.currentSong?.sourceRef.providerId)).toBe(provider);
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
  expect(await page.evaluate(() => (window as any).connectionMutations)).toEqual([]);
  await expect(page).toHaveURL(/\/mobile\.html$/);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const event of ['online', 'foreground'] as const) test(`${event} retries only a failed visible connection and coalesces pending checks`, async ({ page }) => {
  await connectionFixture(page); await page.goto('/mobile.html');
  await expect(page.locator('.library-panel').getByRole('alert')).toBeVisible();
  await signal(page, 'foreground', true); await signal(page, 'online'); await rendered(page);
  expect(await page.evaluate(() => (window as any).connectionCalls)).toBe(1);
  await page.evaluate(() => {
    const w = window as any; w.connectionFailure = ''; w.connectionDelay = true;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
  await signal(page, event);
  await expect.poll(() => page.evaluate(() => (window as any).connectionCalls)).toBe(2);
  await expect(page.locator('.connection-hint').getByRole('button', { name: '正在加载…', exact: true })).toBeDisabled();
  await signal(page, event); await rendered(page);
  expect(await page.evaluate(() => (window as any).connectionCalls)).toBe(2);
  await page.evaluate(() => (window as any).finishConnection());
  await expect(page.getByText('测试用户', { exact: true })).toBeVisible();
  await signal(page, 'foreground'); await signal(page, 'online'); await rendered(page);
  expect(await page.evaluate(() => (window as any).connectionCalls)).toBe(2);
  expect(await page.evaluate(() => (window as any).connectionMutations)).toEqual([]);
});

test('an unconfigured app keeps settings guidance and never sends a capability request', async ({ page }) => {
  await connectionFixture(page);
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html'); await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await expect(page.locator('.connection-hint')).toContainText('使用此在线音源需要配置音乐 API 连接。');
  await expect(page.locator('.connection-hint').getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
  await signal(page, 'online'); await signal(page, 'foreground'); await rendered(page);
  expect(await page.evaluate(() => (window as any).connectionCalls)).toBe(0);
});
