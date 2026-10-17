import type { Locator } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';

// settings-contrast.spec.ts — measured WebKit text contrast on mobile chrome; no songs or live accounts.
async function contrastRatio(target: Locator) {
  return target.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map(value => value / 255);
    };
    const blend = (foreground: number[], background: number[], alpha: number) =>
      background.map((channel, i) => foreground[i] * alpha + channel * (1 - alpha));
    const ancestors: Element[] = [];
    for (let parent: Element | null = element; parent; parent = parent.parentElement) ancestors.unshift(parent);
    let background = [1, 1, 1], opacity = 1;
    for (const parent of ancestors) {
      const style = getComputedStyle(parent), color = rgba(style.backgroundColor);
      background = blend(color, background, color[3]); opacity *= Number(style.opacity);
    }
    const color = rgba(getComputedStyle(element).color);
    const foreground = blend(color, background, color[3] * opacity);
    const luminance = (channels: number[]) => channels.map(channel => channel <= 0.04045
      ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, i) =>
      sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
    const values = [luminance(foreground), luminance(background)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
  });
}

for (const theme of ['dark', 'light']) test(`visual setting labels remain legible on ${theme} chrome`, async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('combobox', { name: /^主题/ }).selectOption(theme);
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.locator('.mini-title').tap(); await clickPlayerTool(page, '歌词与动效');
  const visual = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await visual.getByRole('combobox', { name: '歌词动画', exact: true }).selectOption('lumiere');
  const label = visual.getByText('前景散景', { exact: true });
  await label.scrollIntoViewIfNeeded();
  await expect.poll(() => contrastRatio(label)).toBeGreaterThanOrEqual(4.5);
  const hint = visual.getByText(/^暗场强度压暗光后面的共享背景/);
  await hint.scrollIntoViewIfNeeded();
  await expect.poll(() => contrastRatio(hint)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: test.info().outputPath(`visual-settings-${theme}.png`) });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = visual.locator('.mobile-motion-settings');
  await motion.locator('summary').tap();
  await motion.getByRole('button', { name: '跟随系统设置', exact: true }).tap();
  const notices = motion.getByText('当前正被上面的系统设置压低。', { exact: true });
  await expect(notices).toHaveCount(3);
  for (const notice of await notices.all()) {
    await notice.scrollIntoViewIfNeeded();
    await expect.poll(() => contrastRatio(notice)).toBeGreaterThanOrEqual(4.5);
    expect(await notice.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
  }
  expect(await visual.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`motion-settings-${theme}.png`) });
});

for (const theme of ['dark', 'light']) test(`theme editor labels remain legible on ${theme} chrome without removing name validation`, async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('combobox', { name: /^主题/ }).selectOption(theme);
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.locator('.mini-title').tap(); await clickPlayerTool(page, '歌词与动效');
  await page.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true }).tap();
  const panel = page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
  await panel.getByRole('button', { name: '信息', exact: true }).tap();
  for (const label of await panel.locator('label span').all()) {
    await label.scrollIntoViewIfNeeded();
    await expect.poll(() => contrastRatio(label)).toBeGreaterThanOrEqual(4.5);
  }
  const hint = panel.getByText(/^描述就是 AI 主题/);
  await hint.scrollIntoViewIfNeeded();
  await expect.poll(() => contrastRatio(hint)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: test.info().outputPath(`theme-editor-${theme}.png`) });
  const name = panel.locator('input[type=text]').first();
  const count = name.locator('..').locator('.font-mono');
  const validColor = await count.evaluate(node => getComputedStyle(node).color);
  await name.fill('');
  await expect(panel.getByRole('button', { name: '保存并应用', exact: true })).toBeDisabled();
  expect(await count.evaluate(node => getComputedStyle(node).color)).not.toBe(validColor);
});
