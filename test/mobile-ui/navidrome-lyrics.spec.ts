import { test, expect, clickPlayerTool } from './fixtures';

// navidrome-lyrics.spec.ts — existing touch tools with a controlled native song; no real server acceptance.
test('Navidrome uses the existing import, source selection and export tools', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await page.evaluate(() => {
    const win = window as any;
    win.fixtureEmitPlayback({ playing: false, position: 5, currentSong: { ...win.fixturePlayback.currentSong,
      name: 'Navidrome QA', sourceRef: { kind: 'navidrome', mediaId: 'track', scope: '11111111-1111-4111-8111-111111111111' } } });
  });
  await clickPlayerTool(page, '歌词');
  const tools = page.getByRole('dialog', { name: '歌词', exact: true });
  await expect(tools.getByRole('button', { name: 'Navidrome', exact: true })).toBeEnabled();
  await tools.getByLabel('导入歌词', { exact: true }).setInputFiles({ name: 'navidrome.lrc', mimeType: 'text/plain',
    buffer: Buffer.from('[00:01.00]Navidrome import\n[00:04.00]Second line') });
  await expect(tools).toBeHidden();
  await clickPlayerTool(page, '歌词');
  await expect(tools.getByRole('button', { name: '导入', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tools.getByRole('button', { name: '导出这首歌', exact: true }).tap();
  const dialog = page.locator('[data-ponder="lyric-file-dialog"]');
  await dialog.getByRole('button', { name: /Folia 无损/ }).tap();
  await expect(dialog.getByRole('status')).toHaveText('歌词已导出');
  const shared = await page.evaluate(() => (window as any).fixtureSharedLyrics.at(-1));
  expect(JSON.parse(shared.content).lyrics.lines[0].fullText).toBe('Navidrome import');
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(5);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});
