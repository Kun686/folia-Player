import { test, expect } from './fixtures';
import { metadataFixture } from './local-metadata-fixture';

// local-metadata.spec.ts — original batch/manual UI over fixture transport, touch layouts and cancellation.
test.beforeEach(async ({ page }) => {
  await metadataFixture(page);
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '本地音乐', exact: true }).tap();
});
test('batch metadata retains lyrics, restores imports and stays usable after rotation', async ({ page }, info) => {
  await page.locator('.local-entity-edit').tap();
  const dialog = page.locator('.mobile-metadata-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /匹配 3 首歌曲/ }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).metadataWrites.length)).toBe(3);
  const writes = await page.evaluate(() => (window as any).metadataWrites);
  expect(writes.every((write: any) => write.source === 'local' && !write.document.matchedLyrics)).toBe(true);
  expect(await page.evaluate(() => (window as any).metadataRequests.some((r: any) => /lyric|lrc/i.test(r.path)))).toBe(false);
  if (info.project.name === 'phone') await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('metadata-batch.png') });
  await dialog.getByRole('button', { name: /使用本地信息/ }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).metadataWrites.length)).toBe(6);
  expect(await page.evaluate(() => (window as any).metadataWrites.slice(3).every((w: any) => w.document.noAutoMatch))).toBe(true);
});
test('cancel drops late search and close remains available', async ({ page }) => {
  await page.evaluate(() => { (window as any).metadataSearchDelay = true; });
  await page.locator('.local-entity-edit').tap();
  const dialog = page.locator('.mobile-metadata-dialog');
  await dialog.getByRole('button', { name: /匹配 3 首歌曲/ }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).metadataPending.length)).toBe(2);
  await dialog.getByRole('button', { name: /取消/ }).tap();
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.evaluate(() => (window as any).metadataPending.forEach((resolve: () => void) => resolve()));
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).metadataWrites.length)).toBe(0);
});
test('manual metadata save failure can retry and save cannot be dismissed mid-commit', async ({ page }, info) => {
  await page.locator('.local-entity-edit').tap();
  const dialog = page.locator('.mobile-metadata-dialog');
  await dialog.getByRole('button', { name: '手动在线匹配', exact: true }).first().tap();
  await dialog.getByRole('button', { name: '搜索', exact: true }).tap();
  await dialog.getByRole('button', { name: /测试歌曲.*测试歌手.*100/ }).tap();
  await dialog.getByRole('switch').first().tap();
  await page.evaluate(() => { (window as any).metadataSaveFailure = true; });
  await dialog.getByRole('button', { name: '保存选择', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.metadataSaveFailure = false; w.metadataSavePending = true; });
  await dialog.getByRole('button', { name: '保存选择', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).metadataFinishSave());
  await expect(dialog.locator('.mobile-metadata-single')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).metadataWrites[0].source)).toBe('local');
  await page.screenshot({ path: test.info().outputPath('metadata-manual-' + info.project.name + '.png') });
});
test('folder scope includes descendants and does not silently follow the library search filter', async ({ page }) => {
  await page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: '文件夹', exact: true }).tap();
  await page.getByRole('button', { name: '文件夹样本 3 首歌曲' }).tap();
  await page.getByRole('button', { name: 'Album 2 首歌曲' }).tap();
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('no results');
  await page.getByRole('button', { name: '批量自动匹配', exact: true }).tap();
  const dialog = page.locator('.mobile-metadata-dialog');
  await dialog.getByRole('button', { name: '匹配 2 首歌曲', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).metadataWrites.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).metadataWrites.map((w: any) => w.id.slice(-1)))).toEqual(['2', '3']);
});
test('switching source and closing discard a previous manual search response', async ({ page }) => {
  await page.locator('.local-entity-edit').tap();
  const dialog = page.locator('.mobile-metadata-dialog');
  await dialog.getByRole('button', { name: '手动在线匹配', exact: true }).first().tap();
  await page.evaluate(() => { (window as any).metadataSearchDelay = true; });
  await dialog.getByRole('button', { name: '搜索', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).metadataPending.length)).toBe(1);
  await dialog.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).metadataPending.forEach((resolve: () => void) => resolve()));
  await expect(dialog.getByRole('button', { name: /测试歌曲.*测试歌手.*100/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(dialog.locator('.mobile-metadata-single')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).metadataWrites.length)).toBe(0);
});
