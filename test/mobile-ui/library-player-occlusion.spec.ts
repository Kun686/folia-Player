import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// library-player-occlusion.spec.ts — controlled geometry regression; real accounts are checked separately.
for (const provider of ['netease', 'qq'] as const) {
  test(`${provider}: scrolling a result into view never places it behind the fixed player`, async ({ page }, info) => {
    await searchPlaybackFixture(page);
    await page.goto('/mobile.html');
    await seedSearchQueue(page);
    await page.getByRole('button', { name: provider === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
    await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('歌曲');
    await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
    const rows = page.locator('.song-main');
    await expect(rows).toHaveCount(2);
    const before = await page.evaluate(() => JSON.stringify((window as any).fixturePlayback));
    for (const frame of [
      { width: 402, height: 874, top: 62, bottom: 34, side: 0 },
      { width: 874, height: 402, top: 0, bottom: 21, side: 62 },
      { width: 402, height: 874, top: 62, bottom: 34, side: 0 },
      { width: 375, height: 667, top: 20, bottom: 0, side: 0 },
    ]) {
      await page.setViewportSize(frame);
      await page.locator('.mobile-app').evaluate((node, frame) => {
        const style = (node as HTMLElement).style;
        style.setProperty('--safe-top', `${frame.top}px`); style.setProperty('--safe-bottom', `${frame.bottom}px`);
        style.setProperty('--safe-left', `${frame.side}px`); style.setProperty('--safe-right', `${frame.side}px`);
      }, frame);
      // Rotation is published on the next animation frame by useSheetViewport.
      // Wait for the actual scrollport before asking the browser to reveal a row.
      await expect(page.locator('.library-panel')).toHaveCSS('height',
        `${frame.height - frame.top - 80 - Math.max(10, frame.bottom)}px`);
      await rows.last().evaluate(node => node.scrollIntoView({ block: 'end', behavior: 'instant' }));
      const geometry = await rows.last().evaluate(node => {
        const row = node.getBoundingClientRect(), player = document.querySelector('.mini-player')!.getBoundingClientRect();
        const hit = document.elementFromPoint(row.x + row.width / 2, row.y + row.height / 2);
        return { rowBottom: row.bottom, playerTop: player.top, hit: !!hit && node.contains(hit) };
      });
      await info.attach(`${provider}-${frame.width}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath(`${provider}-${frame.width}.png`) });
      expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.playerTop);
      expect(geometry.hit).toBe(true);
      await rows.last().locator('..').getByRole('button', { name: /^歌曲操作 / }).tap();
      await expect(page.getByRole('dialog', { name: '歌曲操作', exact: true })).toBeVisible();
      await page.getByRole('dialog', { name: '歌曲操作', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
    }
    expect(await page.evaluate(() => JSON.stringify((window as any).fixturePlayback))).toBe(before);
  });
}
