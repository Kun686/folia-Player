import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// language-preference.spec.ts — original i18n/store behavior in mobile settings, with no native playback writes.
const picker = (page: Page) => page.getByRole('combobox', { name: /^(界面语言|Interface language|Bahasa antarmuka)$/ });
const settings = (page: Page) => page.getByRole('dialog', { name: /^(服务器与外观|Server & appearance|Server & tampilan)$/ });
async function openSettings(page: Page) { await page.locator('.brand button').tap(); }
async function closeSettings(page: Page) { await settings(page).locator('header button').tap(); }

test.beforeEach(async ({ page }) => {
  await searchPlaybackFixture(page);
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    w.languageNativeWrites = [];
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (['bootstrap', 'command', 'setQueue', 'editQueue', 'selectQueue', 'configure', 'clearSession', 'saveSession'].includes(method)) {
        w.languageNativeWrites.push(method);
      }
      return bridge(plugin, method, options);
    };
  });
});

test('switches all original languages immediately, persists on reload and keeps queue/session state', async ({ page }) => {
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openSettings(page);
  await expect(picker(page)).toHaveValue('system');
  const writes = await page.evaluate(() => (window as any).languageNativeWrites);
  for (const [language, heading] of [['en', 'Library'], ['in', 'Pustaka'], ['zh-CN', '音乐库']]) {
    await picker(page).selectOption(language);
    await expect(picker(page)).toHaveValue(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('.brand h1')).toHaveText(heading);
    expect(await page.evaluate(() => localStorage.getItem('folia_app_language'))).toBe(language);
  }
  expect(await page.evaluate(() => (window as any).languageNativeWrites)).toEqual(writes);
  expect(await page.evaluate(() => {
    const state = (window as any).fixturePlayback;
    return { position: state.position, playing: state.playing, index: state.index, count: state.queue.length };
  })).toEqual({ position: 42, playing: false, index: 0, count: 2 });
  await picker(page).selectOption('en'); await page.reload(); await openSettings(page);
  await expect(picker(page)).toHaveValue('en');
  await expect(page.locator('.brand h1')).toHaveText('Library');
  await picker(page).selectOption('system');
  await expect(page.locator('.brand h1')).toHaveText('音乐库');
  await expect(page.locator('#language-preference-hint')).toContainText('简体中文');
});

for (const [locale, language, heading] of [['zh-CN', 'zh-CN', '音乐库'], ['en-US', 'en', 'Library'], ['id-ID', 'in', 'Pustaka']]) {
  test.describe('system ' + locale, () => {
    test.use({ locale });
    test('follows the current system language on startup despite an old detected-language cache', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('folia_app_language', 'system');
        localStorage.setItem('i18nextLng', 'en');
      });
      await page.goto('/mobile.html'); await openSettings(page);
      await expect(picker(page)).toHaveValue('system');
      await expect(page.locator('.brand h1')).toHaveText(heading);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await picker(page).selectOption('zh-CN'); await expect(picker(page)).toHaveValue('zh-CN');
      await picker(page).selectOption('system');
      await expect(page.locator('.brand h1')).toHaveText(heading);
    });
  });
}

test('failed preference persistence retains the old selection, reports failure and allows retry', async ({ page }) => {
  await page.goto('/mobile.html'); await openSettings(page);
  await page.evaluate(() => {
    const write = Storage.prototype.setItem, w = window as any;
    w.failLanguageStorage = true;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'folia_app_language' && w.failLanguageStorage) throw new DOMException('Full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await picker(page).selectOption('en');
  await expect(settings(page).getByRole('alert')).toBeVisible();
  await expect(picker(page)).toHaveValue('system');
  await expect(picker(page)).toBeEnabled();
  await expect(page.locator('.brand h1')).toHaveText('音乐库');
  expect(await page.evaluate(() => localStorage.getItem('folia_app_language'))).toBeNull();
  await page.evaluate(() => { (window as any).failLanguageStorage = false; });
  await picker(page).selectOption('en');
  await expect(picker(page)).toHaveValue('en');
  await expect(settings(page).getByRole('alert')).toHaveCount(0);
});

test('translated settings remain touch-accessible after rotation and the selected language survives reopening', async ({ page }, info) => {
  await page.goto('/mobile.html'); await openSettings(page);
  await picker(page).selectOption('in');
  for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }, info.project.use.viewport!]) {
    await page.setViewportSize(size);
    for (const control of [picker(page), settings(page).getByRole('combobox', { name: 'Tema', exact: true })]) {
      await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    }
    expect(await settings(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await settings(page).getByRole('combobox', { name: 'Tema', exact: true }).selectOption('light');
  await expect(page.locator('.mobile-app')).toHaveClass(/daylight/);
  await picker(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('language-preference.png') });
  await settings(page).getByRole('combobox', { name: 'Tema', exact: true }).selectOption('dark');
  await expect(page.locator('.mobile-app')).not.toHaveClass(/daylight/);
  await closeSettings(page); await openSettings(page);
  await expect(picker(page)).toHaveValue('in');
});
