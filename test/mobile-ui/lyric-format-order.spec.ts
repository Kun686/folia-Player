import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { folderRescanFixture } from './folder-rescan-fixture';

// lyric-format-order.spec.ts — original order editor and store with the existing native rescan protocol fixture.
const defaults = ['lrc', 'vtt', 'ttml', 'qrc', 'yrc', 'krc'];
const dialog = (page: Page) => page.getByRole('dialog', { name: '本地歌词文件格式优先级', exact: true });
const rows = (page: Page) => dialog(page).locator('li > span:nth-of-type(2)');
const scan = (page: Page) => dialog(page).getByRole('button', { name: '立即重新同步', exact: true });
async function open(page: Page) {
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await page.getByRole('button', { name: '本地歌词文件格式优先级', exact: true }).tap();
}
const orders = (page: Page) => page.evaluate(() => (window as any).fixtureBatchCalls
  .filter((call: any) => call.method === 'beginFolderImport').map((call: any) => call.options.order));
test.beforeEach(async ({ page }) => { await folderRescanFixture(page); await page.goto('/mobile.html'); });

test('touch order persists, resets and native batches retain the order captured before later edits', async ({ page }, info) => {
  await open(page);
  await expect(rows(page)).toHaveText(defaults.map(format => '.' + format));
  await expect(dialog(page).getByRole('button', { name: '上移 .lrc', exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: '下移 .krc', exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: '恢复默认', exact: true })).toBeDisabled();
  const up = dialog(page).getByRole('button', { name: '上移 .ttml', exact: true });
  expect((await up.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await up.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await up.tap(); await expect(rows(page)).toHaveText(['.lrc', '.ttml', '.vtt', '.qrc', '.yrc', '.krc']);
  await up.tap(); await expect(rows(page)).toHaveText(['.ttml', '.lrc', '.vtt', '.qrc', '.yrc', '.krc']);
  await page.reload(); await open(page);
  await expect(rows(page)).toHaveText(['.ttml', '.lrc', '.vtt', '.qrc', '.yrc', '.krc']);
  await dialog(page).getByRole('button', { name: '恢复默认', exact: true }).tap();
  await expect(rows(page)).toHaveText(defaults.map(format => '.' + format));
  await dialog(page).getByRole('button', { name: '上移 .vtt', exact: true }).tap();
  await page.evaluate(() => { (window as any).fixtureWaitingRoot = 'root-0'; });
  await scan(page).tap();
  await expect(dialog(page).getByText('正在扫描 1 / 3：First')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: '正在同步…', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: '下移 .vtt', exact: true }).tap();
  await page.evaluate(() => { const win = window as any; win.fixtureWaitingRoot = undefined; win.fixtureBatchRelease(); });
  await expect(dialog(page).getByText('已重新扫描 3 / 3 个文件夹')).toBeVisible();
  expect(await orders(page)).toEqual(Array(3).fill(['vtt', 'lrc', 'ttml', 'qrc', 'yrc', 'krc']));
  await expect(scan(page)).toBeEnabled();
  await scan(page).tap();
  await expect(scan(page)).toHaveCount(0);
  expect((await orders(page)).slice(3)).toEqual(Array(3).fill(defaults));
  const size = page.viewportSize()!; await page.setViewportSize({ width: size.height, height: size.width });
  await dialog(page).getByRole('button', { name: '下移 .qrc', exact: true }).tap();
  await expect(rows(page)).toHaveText(['.lrc', '.vtt', '.ttml', '.yrc', '.qrc', '.krc']);
  await expect.poll(() => dialog(page).getByRole('listitem').evaluateAll(items => {
    const bounds = items.map(item => item.getBoundingClientRect());
    return bounds.every((item, index) => index === 0 || item.top >= bounds[index - 1].bottom);
  })).toBe(true);
  expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('lyric-format-order.png') });
});

test('storage failure preserves the old order and cancelled rescan keeps the pending change', async ({ page }) => {
  await page.evaluate(() => {
    const set = Storage.prototype.setItem, win = window as any; win.failFormatOrder = true;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'local_lyric_format_order' && win.failFormatOrder) throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await open(page);
  await dialog(page).getByRole('button', { name: '上移 .vtt', exact: true }).tap();
  await expect(dialog(page).getByRole('alert')).toHaveText('格式顺序未能保存，请重试。');
  await expect(rows(page)).toHaveText(defaults.map(format => '.' + format));
  await page.evaluate(() => { const win = window as any; win.failFormatOrder = false; win.fixtureWaitingRoot = 'root-1'; });
  await dialog(page).getByRole('button', { name: '上移 .vtt', exact: true }).tap();
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  await scan(page).tap();
  await expect(dialog(page).getByText('正在扫描 2 / 3：Second')).toBeVisible();
  await dialog(page).getByRole('button', { name: '取消', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureBatchRelease());
  await expect(dialog(page).getByText('已停止，完成 1 / 3 个文件夹')).toBeVisible();
  await expect(scan(page)).toBeEnabled();
  expect((await orders(page)).length).toBe(2);
  await expect(rows(page)).toHaveText(['.vtt', '.lrc', '.ttml', '.qrc', '.yrc', '.krc']);
});

test('no imported folders keeps order editing available and rescan disabled', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureFolders = { revision: 'empty', roots: [] }; });
  await page.reload(); await open(page);
  await expect(dialog(page).getByText('还没有导入本地文件夹', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: '上移 .vtt', exact: true }).tap();
  await expect(scan(page)).toBeDisabled();
  expect(await orders(page)).toEqual([]);
});
