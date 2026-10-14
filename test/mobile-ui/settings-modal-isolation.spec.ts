import type { Locator, Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import { openOnlineVisualizer, rotationLyric } from './online-visualizer-fixture';

// settings-modal-isolation.spec.ts — settings must not leave covered playback actions focusable.
async function blockedBackground(page: Page, dialog: Locator, selectors: string[]) {
  await dialog.locator(':scope > header button').first().focus();
  const escaped = await page.evaluate(selectors => selectors.map(selector => {
    const button = document.querySelector<HTMLElement>(selector)!;
    button.focus();
    return { selector, focused: document.activeElement === button };
  }), selectors);
  for (const result of escaped) expect.soft(result.focused, result.selector).toBe(false);
}

for (const provider of ['qq', 'netease'] as const) {
  test(`${provider} general settings and its subview isolate library and mini-player controls`, async ({ page }, info) => {
    await openOnlineVisualizer(page, provider, 'classic');
    await page.locator('.player-collapse').tap();
    await page.locator('.brand').getByRole('button', { name: '服务器与外观', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: '服务器与外观', exact: true });
    const selectors = ['.brand button', '.mini-title', '.mini-player > button[aria-label]'];
    const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
    await blockedBackground(page, dialog, selectors);
    await dialog.getByRole('button', { name: '睡眠定时', exact: true }).tap();
    const sleep = page.getByRole('dialog', { name: '睡眠定时', exact: true });
    await blockedBackground(page, sleep, selectors);
    await sleep.getByRole('button', { name: '关闭', exact: true }).tap();
    await blockedBackground(page, dialog, selectors);
    expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
    await page.screenshot({ path: info.outputPath('general-settings.png') });
    await dialog.locator(':scope > header button').tap();
    const play = page.locator('.mini-player > button[aria-label]');
    await play.focus(); await expect(play).toBeFocused(); await play.tap();
    await expect.poll(() => page.evaluate(() => (window as any).fixtureCommands.at(-1)?.action)).toBe('play');
  });

  test(`${provider} visual settings and theme editing isolate the covered player controls`, async ({ page }, info) => {
    await openOnlineVisualizer(page, provider, 'classic');
    await clickPlayerTool(page, '歌词与动效');
    await expect(page.locator('.player-tools')).not.toBeVisible();
    const dialog = page.getByRole('dialog', { name: '歌词与动效', exact: true });
    const selectors = ['.player-collapse', '.primary-play', '.player-controls button[aria-label="下一首"]'];
    const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
    await blockedBackground(page, dialog, selectors);
    await dialog.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true }).tap();
    const theme = page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
    await blockedBackground(page, theme, selectors);
    await theme.getByRole('button', { name: '取消', exact: true }).tap();
    await blockedBackground(page, dialog, selectors);
    expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
    await page.screenshot({ path: info.outputPath('visual-settings.png') });
    await dialog.locator(':scope > header button').tap();
    await expect(page.locator('.lyric-stage').getByText(rotationLyric, { exact: true }).first()).toBeVisible();
    const play = page.locator('.primary-play');
    await play.focus(); await expect(play).toBeFocused(); await play.tap();
    await expect.poll(() => page.evaluate(() => (window as any).fixtureCommands.at(-1)?.action)).toBe('play');
  });
}
