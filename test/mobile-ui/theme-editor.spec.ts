import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import { BASE_DUAL_THEME } from '../../src/services/baseThemes';
import { decompressConfig } from '../../src/utils/appearanceCodec';

// theme-editor.spec.ts — real original panels with native transport fixtures; no AI requests or real account use.
const editor = (page: Page) => page.getByRole('dialog', { name: 'Theme Park · 自定义主题', exact: true });
async function play(page: Page) {
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
}
async function open(page: Page) {
  await clickPlayerTool(page, '歌词与动效');
  await page.getByRole('button', { name: 'Theme Park · 自定义主题', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html'); await play(page); await open(page);
});
test('edits both themes, shared content and colors, then persists and exports original appearance data', async ({ page }) => {
  const panel = editor(page);
  await panel.getByLabel('HEX', { exact: true }).fill('#123456');
  await panel.getByLabel('HEX', { exact: true }).blur();
  await panel.getByRole('button', { name: '亮色主题', exact: true }).click();
  await panel.getByLabel('HEX', { exact: true }).fill('#654321');
  await panel.getByLabel('HEX', { exact: true }).blur();
  await panel.getByRole('button', { name: '暗色主题', exact: true }).click();
  await panel.getByRole('button', { name: '信息', exact: true }).click();
  const names = panel.getByRole('textbox').filter({ visible: true });
  await names.nth(0).fill('Mobile Light'); await names.nth(1).fill('Light description');
  await names.nth(2).fill('Mobile Dark'); await names.nth(3).fill('Dark description');
  await panel.getByRole('button', { name: '内容', exact: true }).click();
  await panel.getByRole('button', { name: '添加词语', exact: true }).click();
  await panel.locator('input[type=text]').first().fill('听歌');
  await panel.getByPlaceholder('lucide 图标名，例如 CloudLightning').fill('Heart');
  await panel.getByRole('button', { name: '添加', exact: true }).click();
  await panel.getByRole('button', { name: '保存并应用', exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('custom_dual_theme')!));
  expect(stored.dark.accentColor).toBe('#123456');
  expect(stored.light.accentColor).toBe('#654321');
  expect(stored.light.name).toBe('Mobile Light'); expect(stored.dark.name).toBe('Mobile Dark');
  expect(stored.light.wordColors).toEqual(stored.dark.wordColors); expect(stored.dark.wordColors[0].word).toBe('听歌');
  expect(stored.dark.lyricsIcons).toContain('Heart'); expect(stored.light.lyricsIcons).toEqual(stored.dark.lyricsIcons);
  await page.getByText('导入／导出外观', { exact: true }).click();
  await page.getByRole('button', { name: '生成外观短码', exact: true }).click();
  const code = await page.getByRole('textbox', { name: 'Folia 外观短码或 JSON' }).inputValue();
  expect(decompressConfig(code).theme.dark.accentColor).toBe('#123456');
  await page.reload(); await play(page); await open(page);
  await editor(page).getByRole('button', { name: '信息', exact: true }).click();
  await expect(editor(page).getByRole('textbox').nth(2)).toHaveValue('Mobile Dark');
});
test('invalid names, cancel and storage failures preserve unsaved input and allow retry', async ({ page }) => {
  const panel = editor(page);
  await panel.getByRole('button', { name: '信息', exact: true }).click();
  await panel.getByRole('textbox').nth(0).fill('');
  await expect(panel.getByRole('button', { name: '保存并应用', exact: true })).toBeDisabled();
  await panel.getByRole('textbox').nth(0).fill('Retry draft');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).fixtureThemeFail = true;
    Storage.prototype.setItem = function(key, value) {
      if ((window as any).fixtureThemeFail && key === 'last_applied_theme_pointer') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const before = await page.evaluate(() => localStorage.getItem('custom_dual_theme'));
  await panel.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('草稿已保留');
  await expect(panel.getByRole('textbox').nth(0)).toHaveValue('Retry draft');
  expect(await page.evaluate(() => localStorage.getItem('custom_dual_theme'))).toBe(before);
  await page.evaluate(() => { (window as any).fixtureThemeFail = false; });
  await panel.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('button', { name: 'Theme Park · 自定义主题', exact: true }).click();
  await panel.getByRole('button', { name: '信息', exact: true }).click();
  await panel.getByRole('textbox').nth(0).fill('Cancelled draft');
  await panel.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('custom_dual_theme')!).light.name)).toBe('Retry draft');
});
test('original manual JSON and prompt workflow uses the native clipboard and keeps imports as drafts', async ({ page }) => {
  const panel = editor(page);
  await panel.getByRole('button', { name: 'AI', exact: true }).click();
  await panel.getByRole('button', { name: '复制提示词', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureClipboard)).toContain('测试本地歌词');
  await page.evaluate(() => { (window as any).fixtureClipboardFailure = true; });
  await panel.getByRole('button', { name: '复制 JSON', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('复制失败');
  await page.evaluate(() => { (window as any).fixtureClipboardFailure = false; });
  const field = panel.locator('textarea');
  await field.fill('invalid');
  await panel.getByRole('button', { name: '载入编辑器', exact: true }).click();
  await expect(panel.getByText('无效的 JSON 格式', { exact: false })).toBeVisible();
  await field.fill(JSON.stringify({ ...BASE_DUAL_THEME, dark: { ...BASE_DUAL_THEME.dark, name: 'Imported draft' } }));
  await panel.getByRole('button', { name: '载入编辑器', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('custom_dual_theme'))).toBeNull();
  await panel.getByRole('button', { name: '复制 JSON', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse((window as any).fixtureClipboard).dark.name)).toBe('Imported draft');
  await panel.getByRole('button', { name: '保存并应用', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('custom_dual_theme')!).dark.name)).toBe('Imported draft');
});
test('preview can pause, closes on background and fits rotated and short windows', async ({ page }) => {
  const panel = editor(page);
  await panel.getByText('预览主题', { exact: true }).click();
  await expect(panel.locator('.mobile-theme-preview')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('theme-editor-preview.png') });
  await panel.getByRole('button', { name: '暂停预览', exact: true }).click();
  await expect(panel.getByRole('button', { name: '播放预览', exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(panel.locator('.mobile-theme-preview')).toHaveCount(0);
  await page.evaluate(() => { delete (document as any).hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(panel.locator('.mobile-theme-preview')).toBeVisible();
  await panel.getByText('预览主题', { exact: true }).click();
  for (const size of [{ width: 844, height: 390 }, { width: 390, height: 360 }]) {
    await page.setViewportSize(size);
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await panel.getByRole('button', { name: '信息', exact: true }).click();
    // A touch focuses the actual field and scrolls it into view; fill() alone does not scroll in WebKit.
    await panel.getByRole('textbox').last().tap();
    await panel.getByRole('textbox').last().fill('Keyboard and short-window draft');
    await expect(panel.getByRole('textbox').last()).toBeInViewport();
  }
  await page.screenshot({ path: test.info().outputPath('theme-editor-short-window.png') });
});

test('daylight touch color picker applies the selected color without horizontal overflow', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('default_theme_daylight', 'true'));
  await page.reload(); await play(page); await open(page);
  const panel = editor(page), hex = panel.getByLabel('HEX', { exact: true });
  const before = await hex.inputValue();
  await panel.locator('.react-colorful__hue').tap({ position: { x: 60, y: 10 } });
  await panel.locator('.react-colorful__saturation').tap({ position: { x: 60, y: 60 } });
  await expect(hex).not.toHaveValue(before);
  const selected = await hex.inputValue();
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('theme-editor-daylight-picker.png') });
  await panel.getByRole('button', { name: '保存并应用', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('custom_dual_theme')!).light.accentColor)).toBe(selected);
});
