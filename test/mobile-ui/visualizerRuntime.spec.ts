import { test, expect, clickPlayerTool } from './fixtures';
import { writeFile } from 'node:fs/promises';

// visualizerRuntime.spec.ts — real renderers with fixture audio; no native/device acceptance.
for (const scenario of ['all modes', 'tilt only', 'lumiere only']) {
  test(`original visualizers switch without lifecycle or filter warnings: ${scenario}`, async ({ page }, info) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      const win = window as any;
      win.fixtureNoServer = true;
      win.rendererMode = 'classic';
      win.rendererDiagnostics = [];
      for (const level of ['warn', 'error', 'groupCollapsed'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
          if (win.rendererDiagnostics.length < 200) win.rendererDiagnostics.push({
            mode: win.rendererMode, level,
            message: args.map(value => value instanceof Error ? `${value.message}\n${value.stack}` : String(value)).join(' '),
            stack: new Error('renderer diagnostic').stack,
          });
          original(...args);
        };
      }
    });
    await page.goto('/mobile.html');
    await page.getByRole('button', { name: '导入音乐', exact: true }).click();
    await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
    await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
    if (scenario === 'all modes') {
      await clickPlayerTool(page, '导入歌词');
      await expect.poll(() => page.evaluate(() => (window as any).fixtureLyricImports)).toBe(1);
    }
    await clickPlayerTool(page, '歌词与动效');
    const select = page.getByLabel('歌词动画', { exact: true });
    const modes = await select.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
    expect(modes).toHaveLength(14);
    for (const mode of scenario === 'all modes' ? modes : [scenario.split(' ')[0]!]) {
      await page.evaluate(mode => { (window as any).rendererMode = mode; }, mode);
      await select.selectOption(mode);
      await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.locator('.lyric-stage')).toBeVisible();
      if (['lumiere', 'sonnet', 'tempera', 'diorama'].includes(mode)) {
        await expect(page.locator('.lyric-stage canvas').first()).toBeVisible();
      }
      await page.waitForTimeout(250);
      if (scenario !== 'all modes') {
        await page.locator('.player-panel').getByRole('button', { name: '暂停', exact: true }).click();
        for (const [position, text] of [[0, '测试本地歌词'], [12, '第二句'], [0, '测试本地歌词']] as const) {
          await page.getByRole('slider', { name: '播放进度' }).fill(String(position));
          if (mode === 'tilt') {
            // Tilt splits one line into separately timed segments; only the first is visible at time zero.
            const segments = page.locator('.lyric-stage .whitespace-nowrap');
            await expect.poll(() => segments.evaluateAll(nodes => nodes.map(node => node.textContent).join(''))).toBe(text);
            await expect.poll(() => segments.first().evaluate(el => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.95);
          }
        }
        const viewport = page.viewportSize()!;
        await page.setViewportSize({ width: viewport.height, height: viewport.width });
        await expect(page.locator('.lyric-stage')).toBeVisible();
        await page.setViewportSize(viewport);
        await page.screenshot({ path: info.outputPath(`${mode}.png`) });
      }
      await clickPlayerTool(page, '歌词与动效');
    }
    const diagnostics = await page.evaluate(() => (window as any).rendererDiagnostics as { mode: string; level: string; message: string; stack: string }[]);
    await writeFile(info.outputPath('diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await info.attach('renderer-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
    expect(pageErrors).toEqual([]);
    expect(diagnostics.filter(row => row.level === 'error')).toEqual([]);
    expect(diagnostics.filter(row => row.stack?.includes('getOptimalTexture') && row.stack.includes('bloomFilter'))).toEqual([]);
  });
}
