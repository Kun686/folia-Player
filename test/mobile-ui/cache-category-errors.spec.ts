import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// cache-category-errors.spec.ts — real IndexedDB faults, empty queue, no provider requests.
async function cacheRecord(page: Page, key: string, seed = false) {
  return page.evaluate(async ({ key, seed }) => {
    const modulePath = '/src/services/repositories/cacheRepository.ts';
    const repo = await import(modulePath) as typeof import('../../src/services/repositories/cacheRepository');
    if (seed) await repo.putCacheEntry(key, { value: 'category-cleanup-check' });
    return repo.readCacheEntry(key);
  }, { key, seed });
}

test('browser cache read failure shows unknown usage and a working retry', async ({ page }, info) => {
  await page.goto('/mobile.html');
  await expect(page.locator('.brand button')).toBeVisible();
  await cacheRecord(page, 'cover_qa_category', true);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.getAll;
    (window as any).categoryReadFaults = 0;
    IDBObjectStore.prototype.getAll = function (...args: Parameters<typeof original>) {
      if (this.name === 'api_cache') {
        (window as any).categoryReadFaults++;
        IDBObjectStore.prototype.getAll = original;
        throw new DOMException('category-read-failed', 'UnknownError');
      }
      return Reflect.apply(original, this, args);
    };
  });
  await page.locator('.brand button').tap();
  const group = page.locator('.mobile-cache-controls').filter({ has: page.getByRole('button', { name: '清除封面缓存', exact: true }) });
  await expect(group.getByRole('alert')).toHaveText('缓存操作失败，请检查网络或可用空间。');
  await expect(group.getByText('封面: —', { exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: '清除封面缓存', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).categoryReadFaults)).toBe(1);
  await group.getByRole('button', { name: '重试', exact: true }).tap();
  await expect(group.getByRole('alert')).toHaveCount(0);
  await expect(group.getByText('封面: 1.0 MB', { exact: true })).toBeVisible();
  expect(await cacheRecord(page, 'cover_qa_category')).toEqual({ value: 'category-cleanup-check' });
  await page.screenshot({ path: info.outputPath('cache-read-recovered.png') });
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
});

for (const [category, noun, key] of [['cover', '封面', 'cover_qa_category'], ['lyrics', '歌词', 'lyric_qa_category']] as const) {
  test(`${category} clear reports browser deletion failure and succeeds on explicit retry`, async ({ page }, info) => {
    await page.goto('/mobile.html');
    await expect(page.locator('.brand button')).toBeVisible();
    const original = await cacheRecord(page, key, true);
    await page.locator('.brand button').tap();
    const group = page.locator('.mobile-cache-controls').filter({ has: page.getByRole('button', { name: `清除${noun}缓存`, exact: true }) });
    const clear = group.getByRole('button', { name: `清除${noun}缓存`, exact: true });
    await expect(clear).toBeEnabled();
    await page.evaluate(key => {
      const original = IDBObjectStore.prototype.delete;
      (window as any).categoryDeleteFaults = 0;
      IDBObjectStore.prototype.delete = function (query: IDBValidKey | IDBKeyRange) {
        if (query === key) {
          (window as any).categoryDeleteFaults++;
          IDBObjectStore.prototype.delete = original;
          throw new DOMException('category-delete-failed', 'UnknownError');
        }
        return Reflect.apply(original, this, [query]);
      };
    }, key);
    if (category === 'lyrics') page.once('dialog', dialog => dialog.accept());
    await clear.tap();
    await expect(group.getByRole('alert')).toHaveText('缓存操作失败，请检查网络或可用空间。');
    expect(await page.evaluate(() => (window as any).categoryDeleteFaults)).toBe(1);
    expect(await cacheRecord(page, key)).toEqual(original);
    await page.screenshot({ path: info.outputPath(`${category}-clear-error.png`) });
    if (category === 'lyrics') page.once('dialog', dialog => dialog.accept());
    await clear.tap();
    await expect(group.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => cacheRecord(page, key)).toBeNull();
    await expect(group.getByText(`${noun}: 0.0 MB`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
  });
}
