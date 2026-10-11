import { deflateSync } from 'node:zlib';
import { test, expect } from './fixtures';

// local-import.spec.ts — original decoding and actual WebKit parser Worker; synthetic native picker/persistence.
const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
const krc = Buffer.concat([Buffer.from('krc1'), Buffer.from(deflateSync('[0,8000]<0,8000,0>原版加密歌词').map((v, i) => v ^ key[i % 16]))]);
test('system-picked GBK and encrypted KRC replace local lyrics through original decoding', async ({ page }, info) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  await page.getByLabel('歌词动画', { exact: true }).selectOption('still');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 2 }));
  await expect(page.locator('.lyric-stage').getByText('测试本地歌词', { exact: true })).toBeVisible();
  for (const [fileName, bytes, text] of [
    ['GBK歌词.lrc', Buffer.concat([Buffer.from('[00:00.00]'), Buffer.from([0xb9, 0xfd, 0xbb, 0xf0])]), '过火'],
    ['加密歌词.KRC', krc, '原版加密歌词'],
  ] as const) {
    await page.evaluate(file => { (window as any).fixturePickedLyric = file; }, { fileName, data: bytes.toString('base64'), token: 'local-token' });
    await page.getByRole('button', { name: '导入歌词', exact: true }).click();
    await expect(page.locator('.lyric-stage').getByText(text, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: '.mobile-test-results/local-import-' + info.project.name + '.png' });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('local lyric tools retain old lyrics on failure and discard picks after switching songs', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.fixtureNoServer = true; w.fixtureMany = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  await page.getByLabel('歌词动画', { exact: true }).selectOption('still');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '歌词', exact: true });
  await page.evaluate(() => { (window as any).fixtureLocalSaveFailure = true; });
  await dialog.getByRole('button', { name: '导入歌词', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureLyricImports || 0)).toBe(0);
  await page.evaluate(() => { (window as any).fixtureLocalSaveFailure = false; });
  await dialog.getByRole('button', { name: '导入歌词', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.lyric-stage').getByText('新导入的歌词', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).fixturePendingPick = true; });
  await page.getByRole('button', { name: '导入歌词', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureFinishPick)).toBe('function');
  await page.evaluate(() => {
    const w = window as any;
    w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong,
      sourceRef: { kind: 'local', mediaId: '00000000-0000-4000-8000-000000000002' } } });
  });
  await page.evaluate(() => (window as any).fixtureFinishPick());
  // Read/parse completion is asynchronous; a fresh click completes another picker in the new song.
  await page.evaluate(() => { (window as any).fixturePendingPick = false; (window as any).fixturePickedLyric = { cancelled: true }; });
  await page.getByRole('button', { name: '导入歌词', exact: true }).click();
  expect(await page.evaluate(() => (window as any).fixtureLyricImports)).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
