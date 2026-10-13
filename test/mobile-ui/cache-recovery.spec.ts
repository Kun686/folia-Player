import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// cache-recovery.spec.ts — cache read/settings failures stay independent; only online platform fixtures are used.
async function cacheFixture(page: Page, provider = 'qq') {
  await searchPlaybackFixture(page);
  await page.addInitScript(provider => {
    const w = window as any, bridge = w.Capacitor.nativePromise, callback = w.Capacitor.nativeCallback;
    const song = { id: 'cached', name: provider + '缓存歌曲', artists: [], album: { id: '', name: '' },
      durationMs: 180000, sourceRef: { kind: 'online', providerId: provider, mediaId: 'cached' } };
    Object.assign(w.fixtureCache, { count: 1, bytes: 1048576, songs: [song] });
    w.cacheReadCalls = 0; w.cacheSettingsLoads = 0;
    w.Capacitor.nativeCallback = (plugin: string, method: string, options: any, listener: () => void) => {
      if (method === 'addListener' && options.eventName === 'mediaCache') w.emitCacheState = listener;
      return callback(plugin, method, options, listener);
    };
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'setMediaCacheSettings' && w.holdCacheSave) {
        w.holdCacheSave = false;
        await new Promise<void>(resolve => { w.releaseCacheSave = resolve; });
      }
      if (method === 'getMediaCacheSettings') {
        w.cacheSettingsLoads++;
        if (w.cacheSettingsLoadFailure) throw new Error('controlled-settings-read');
      }
      if (method === 'mediaCacheState') {
        w.cacheReadCalls++;
        const snapshot = structuredClone(w.fixtureCache), failure = w.cacheReadFailure;
        if (w.holdCacheRead) {
          w.holdCacheRead = false;
          await new Promise<void>(resolve => { w.releaseCacheRead = resolve; });
        }
        if (failure) throw new Error('controlled-cache-read');
        return snapshot;
      }
      return bridge(plugin, method, options);
    };
  }, provider);
}
async function openCache(page: Page) {
  await page.goto('/mobile.html'); await seedSearchQueue(page);
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  const section = page.locator('section[aria-labelledby="settings-cache"]');
  await section.scrollIntoViewIfNeeded();
  return section;
}
async function renderTurn(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const provider of ['qq', 'netease']) test(`${provider} clears a recovered cache read error and keeps playback intact`, async ({ page }, info) => {
  await cacheFixture(page, provider); const section = await openCache(page);
  const media = section.locator('fieldset'); await expect(media).toContainText('1.0 MB');
  const before = await page.evaluate(() => ({ playback: (window as any).fixturePlayback, commands: (window as any).fixtureCommands }));
  await page.evaluate(() => { const w = window as any; w.cacheReadFailure = true; w.emitCacheState(); });
  await expect(media.getByRole('alert')).toBeVisible();
  await page.evaluate(event => {
    const w = window as any; w.cacheReadFailure = false; w.fixtureCache.bytes = 2097152;
    if (event === 'qq') w.emitCacheState();
    else document.dispatchEvent(new Event('visibilitychange'));
  }, provider);
  await expect(media).toContainText('2.0 MB');
  await expect(media.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('cache-read-recovered.png') });
  expect(await page.evaluate(() => ({ playback: (window as any).fixturePlayback, commands: (window as any).fixtureCommands }))).toEqual(before);
});

test('a ready cache offers retry after a read failure and retains event updates', async ({ page }, info) => {
  await cacheFixture(page); const section = await openCache(page), media = section.locator('fieldset');
  await expect(media.getByRole('switch')).toBeEnabled();
  await page.evaluate(() => { const w = window as any; w.cacheReadFailure = true; w.emitCacheState(); });
  await expect(media.getByRole('alert')).toBeVisible();
  const retry = section.getByRole('button', { name: '重试', exact: true });
  await expect(retry).toBeEnabled();
  await retry.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('cache-retry.png') });
  await page.evaluate(() => { (window as any).cacheReadFailure = false; });
  await retry.tap(); await expect(media.getByRole('alert')).toHaveCount(0);
  await expect(media.getByRole('switch')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).cacheSettingsLoads)).toBe(1);
  await page.evaluate(() => { const w = window as any; w.fixtureCache.bytes = 3145728; w.emitCacheState(); });
  await expect(media).toContainText('3.0 MB');
  await expect(retry).toHaveCount(0);
});

test('retrying cache reads preserves an in-flight settings edit', async ({ page }) => {
  await cacheFixture(page); const section = await openCache(page), media = section.locator('fieldset');
  const toggle = media.getByRole('switch'); await expect(toggle).toBeEnabled();
  await page.evaluate(() => { (window as any).holdCacheSave = true; });
  await toggle.tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseCacheSave)).toBe('function');
  await page.evaluate(() => { const w = window as any; w.cacheReadFailure = true; w.emitCacheState(); });
  await expect(media.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).cacheReadFailure = false; });
  await section.getByRole('button', { name: '重试', exact: true }).tap();
  await expect(media.getByRole('alert')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => (window as any).releaseCacheSave());
  await expect.poll(() => page.evaluate(() => (window as any).fixtureCache.settings.enabled)).toBe(true);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => (window as any).cacheSettingsLoads)).toBe(1);
});

test('successful cache reads do not conceal failed settings hydration', async ({ page }) => {
  await cacheFixture(page);
  await page.addInitScript(() => { (window as any).cacheSettingsLoadFailure = true; });
  const section = await openCache(page), media = section.locator('fieldset');
  await expect(media).toContainText('1.0 MB');
  await expect(media.getByRole('switch')).toBeDisabled();
  await expect(media.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.fixtureCache.bytes = 2097152; w.emitCacheState(); });
  await expect(media).toContainText('2.0 MB'); await expect(media.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).cacheSettingsLoadFailure = false; });
  await section.getByRole('button', { name: '重试', exact: true }).tap();
  await expect(media.getByRole('switch')).toBeEnabled(); await expect(media.getByRole('alert')).toHaveCount(0);
});

test('a rejected settings edit stays visible across successful cache reads until retry', async ({ page }) => {
  await cacheFixture(page); const section = await openCache(page), media = section.locator('fieldset');
  const toggle = media.getByRole('switch'); await expect(toggle).toBeEnabled();
  await page.evaluate(() => { (window as any).fixtureCacheFailure = true; });
  await toggle.tap(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(media.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.fixtureCache.bytes = 2097152; w.emitCacheState(); });
  await expect(media).toContainText('2.0 MB'); await expect(media.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).fixtureCacheFailure = false; });
  await toggle.tap(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(media.getByRole('alert')).toHaveCount(0);
});

for (const failure of [false, true]) test(`late cache read ${failure ? 'failure' : 'success'} cannot undo a newer clear`, async ({ page }) => {
  await cacheFixture(page); const section = await openCache(page), media = section.locator('fieldset');
  await expect(media).toContainText('1.0 MB');
  await page.evaluate(failure => {
    const w = window as any; w.cacheReadFailure = failure; w.holdCacheRead = true; w.emitCacheState();
  }, failure);
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseCacheRead)).toBe('function');
  await page.evaluate(() => { (window as any).cacheReadFailure = false; });
  page.once('dialog', popup => popup.accept());
  await media.getByRole('button', { name: '清除音频缓存', exact: true }).tap();
  await expect(media).toContainText('0.0 MB');
  await page.evaluate(() => (window as any).releaseCacheRead()); await renderTurn(page);
  await expect(media).toContainText('0.0 MB'); await expect(media.getByRole('alert')).toHaveCount(0);
  await expect(media.getByRole('button', { name: '清除音频缓存', exact: true })).toBeDisabled();
});
