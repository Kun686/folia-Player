import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';

// visualizer-single-assets.spec.ts — real IndexedDB and image inputs, empty queue, no provider claims.
const image = { name: 'AppIcon-512@2x.png', mimeType: 'image/png',
  buffer: readFileSync(new URL('../../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', import.meta.url)) };

async function upload(page: Page, button: Locator) {
  const chooser = page.waitForEvent('filechooser');
  await button.tap();
  await (await chooser).setFiles(image);
}

async function openSettings(page: Page) {
  await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  return page.getByRole('dialog', { name: '歌词与动效', exact: true });
}

async function records(page: Page, prefix: string) {
  return page.evaluate(async prefix => {
    const path = '/src/services/repositories/cacheRepository.ts';
    const { readCacheEntriesByPrefix } = await import(path);
    return (await readCacheEntriesByPrefix(prefix)).map((entry: any) => ({
      key: entry.key, version: entry.data.version, bytes: entry.data.data?.byteLength,
    }));
  }, prefix);
}

// Fail the actual browser storage call once and count hits, rather than mocking a repository instance.
async function failStorage(page: Page, method: 'put' | 'delete', prefix: string, occurrence = 1) {
  await page.evaluate(({ method, prefix, occurrence }) => {
    const original = IDBObjectStore.prototype[method];
    (window as any).assetFaultHits = 0;
    (IDBObjectStore.prototype as any)[method] = function (...args: any[]) {
      const key = method === 'put' ? args[0]?.key : args[0];
      if (typeof key === 'string' && key.startsWith(prefix)) {
        (window as any).assetFaultHits++;
        if ((window as any).assetFaultHits === occurrence) {
          (IDBObjectStore.prototype as any)[method] = original;
          throw new DOMException('asset-test-storage-failure', 'UnknownError');
        }
      }
      return Reflect.apply(original, this, args);
    };
  }, { method, prefix, occurrence });
}

for (const [mode, background, noun, key] of [
  ['monet', 'common', '肖像', 'monet_portrait_image'],
  ['classic', 'monet', '背景', 'monet_background_image'],
  ['classic', 'nomand', '背景', 'monet_background_image'],
] as const) {
  test(`${mode}/${background} image survives reload and reports storage failure`, async ({ page }, info) => {
    await page.addInitScript(({ mode, background }) => {
      localStorage.setItem('visualizer_mode', mode);
      localStorage.setItem('visualizer_background_mode', background);
    }, { mode, background });
    const open = async () => {
      const settings = await openSettings(page);
      if (background !== 'common') await settings.locator('summary').getByText('背景效果', { exact: true }).tap();
      return settings;
    };
    await page.goto('/mobile.html');
    const settings = await open();
    const add = settings.getByRole('button', { name: `上传${noun}图`, exact: true });
    const clear = settings.getByRole('button', { name: `清空${noun}图`, exact: true });
    await expect(clear).toBeDisabled();
    await upload(page, add);
    await expect(clear).toBeEnabled();
    const stored = await records(page, key);
    expect(stored).toEqual([{ key, version: 2, bytes: image.buffer.length }]);

    await failStorage(page, 'put', key);
    await upload(page, add);
    await expect(settings.getByText('图片保存失败，请重试。', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).assetFaultHits)).toBe(1);
    expect(await records(page, key)).toEqual(stored);
    await failStorage(page, 'delete', key);
    await clear.tap();
    await expect(settings.getByText('清空图片失败，请重试。', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).assetFaultHits)).toBe(1);
    await expect(clear).toBeEnabled();
    expect(await records(page, key)).toEqual(stored);

    await page.reload();
    await open();
    await expect(settings.getByText(image.name, { exact: true })).toBeVisible();
    await expect(clear).toBeEnabled();
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await clear.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('restored-landscape.png') });
    await clear.tap();
    await expect(clear).toBeDisabled();
    expect(await records(page, key)).toEqual([]);
    await page.reload();
    await open();
    await expect(clear).toBeDisabled();
    expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
  });
}

test('Tempera preserves the pool when one deletion fails, then clears it on retry', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('visualizer_mode', 'tempera'));
  await page.goto('/mobile.html');
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: '添加图片', exact: true }).tap();
  const pool = page.locator('[data-folia-keyboard-window]').filter({ has: page.getByRole('heading', { name: '画布图片', exact: true }) });
  const add = pool.getByRole('button', { name: '添加图片', exact: true });
  const save = pool.getByRole('button', { name: '保存', exact: true });
  await upload(page, add);
  await expect(pool.getByAltText(image.name, { exact: true })).toHaveCount(1);
  await expect(add).toBeEnabled();
  await upload(page, add);
  await expect(pool.getByAltText(image.name, { exact: true })).toHaveCount(2);
  await save.tap();
  await expect(pool).toHaveCount(0);
  await page.reload();
  await openSettings(page);
  await expect(settings.getByAltText(image.name, { exact: true })).toHaveCount(2);
  const stored = await records(page, 'tempera_layer_image_');
  expect(stored).toHaveLength(2);
  const tuning = await page.evaluate(() => localStorage.getItem('tempera_tuning'));
  await settings.getByRole('button').filter({ has: page.getByAltText(image.name) }).tap();
  await expect(pool.getByAltText(image.name, { exact: true })).toHaveCount(2);
  await failStorage(page, 'delete', 'tempera_layer_image_', 2);
  await pool.getByRole('button', { name: '清空全部', exact: true }).tap();
  await save.tap();
  await expect(page.getByText('清空图片失败，请重试。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).assetFaultHits)).toBe(2);
  expect(await records(page, 'tempera_layer_image_')).toEqual(stored);
  expect(await page.evaluate(() => localStorage.getItem('tempera_tuning'))).toBe(tuning);
  await expect(pool).toBeVisible();
  await page.screenshot({ path: info.outputPath('delete-failure.png') });
  await save.tap();
  await expect(pool).toHaveCount(0);
  expect(await records(page, 'tempera_layer_image_')).toEqual([]);
  await page.reload();
  await openSettings(page);
  await expect(settings.getByRole('button', { name: '添加图片', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tempera_tuning')!).layerImages)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
});
