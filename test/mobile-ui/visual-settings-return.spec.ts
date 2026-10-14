import { test, expect, clickPlayerTool } from './fixtures';
import { openOnlineVisualizer, rotationLyric } from './online-visualizer-fixture';

// visual-settings-return.spec.ts — retain unsaved presentation state across the existing theme subview.
for (const provider of ['qq', 'netease'] as const) {
  test(`${provider} theme return retains the appearance draft, open sections and scroll`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openOnlineVisualizer(page, provider, 'classic');
    await clickPlayerTool(page, '歌词与动效');
    const dialog = page.getByRole('dialog', { name: '歌词与动效', exact: true });
    const transfer = dialog.locator('.appearance-transfer');
    const typography = dialog.locator('.typography-controls > details').first();
    await transfer.locator('summary').tap();
    const draft = JSON.stringify({ visualizerMode: 'classic', lyricsFontScale: 1.3 });
    await transfer.locator('textarea').fill(draft);
    await typography.locator('summary').tap();
    const editor = dialog.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true });
    await editor.scrollIntoViewIfNeeded();
    const position = await dialog.locator('.sheet-body').evaluate(body => body.scrollTop);
    const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
    await editor.tap();
    const theme = page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
    await expect(theme).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await theme.getByRole('button', { name: '取消', exact: true }).tap();
    await expect.soft(transfer.locator('textarea')).toHaveValue(draft);
    await expect.soft(transfer).toHaveAttribute('open', '');
    await expect.soft(typography).toHaveAttribute('open', '');
    await expect.poll(() => dialog.locator('.sheet-body').evaluate(body => body.scrollTop)).toBe(position);
    await page.screenshot({ path: info.outputPath('returned-settings.png') });

    // Applying is still explicit; navigating to the editor must never apply the pending code.
    expect(await page.evaluate(() => localStorage.getItem('lyrics_font_scale'))).not.toBe('1.3');
    await transfer.getByRole('button', { name: '应用外观配置', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lyrics_font_scale'))).toBe('1.3');
    await expect(transfer.locator('textarea')).toHaveValue('');
    const initial = page.viewportSize()!;
    await page.setViewportSize({ width: initial.height, height: initial.width });
    await expect(typography).toHaveAttribute('open', '');
    await page.setViewportSize(initial);
    await dialog.locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap();
    await expect(page.locator('.lyric-stage').getByText(rotationLyric, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
    await clickPlayerTool(page, '歌词与动效');
    await expect(transfer).not.toHaveAttribute('open', '');
    await expect(typography).not.toHaveAttribute('open', '');
    await expect(transfer.locator('textarea')).toHaveValue('');
    expect(errors).toEqual([]);
  });
}
