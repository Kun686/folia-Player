import type { Locator } from '@playwright/test';
import { test, expect, openPlayerTools, clickPlayerTool } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// settings-layout.spec.ts — real WebKit layout with synthetic online accounts; no provider/device acceptance.
async function scrollToEnd(dialog: Locator) {
  await dialog.evaluate(element => {
    const body = element.querySelector('.sheet-body') ?? element;
    body.scrollTop = body.scrollHeight;
  });
}
async function reachableClose(dialog: Locator) {
  const close = dialog.locator(':scope > header').getByRole('button', { name: '关闭', exact: true });
  await expect.poll(() => close.evaluate(button => {
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.height >= 44 && r.width >= 44 && !!hit && button.contains(hit);
  })).toBe(true);
}
test('settings close stays reachable at the end and through rotation', async ({ page }) => {
  await page.goto('/mobile.html');
  await page.locator('.brand').getByRole('button', { name: '服务器与外观', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '服务器与外观', exact: true });
  await expect(dialog.getByRole('heading', { name: '外观与语言', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('settings-top-dark.png') });
  await dialog.getByRole('combobox', { name: /^主题/ }).selectOption('light');
  await page.screenshot({ path: test.info().outputPath('settings-top-light.png') });
  await dialog.getByRole('combobox', { name: /^主题/ }).selectOption('dark');
  await scrollToEnd(dialog);
  await page.screenshot({ path: test.info().outputPath('settings-end.png') });
  await reachableClose(dialog);
  const initial = page.viewportSize()!;
  await page.setViewportSize({ width: initial.height, height: initial.width });
  await scrollToEnd(dialog); await reachableClose(dialog);
  await page.screenshot({ path: test.info().outputPath('settings-rotated.png') });
  await page.setViewportSize(initial); await reachableClose(dialog);
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
});

test('visual settings and player tools keep their close controls above scrolling content', async ({ page }) => {
  await searchPlaybackFixture(page);
  await page.goto('/mobile.html'); await seedSearchQueue(page); await page.locator('.mini-title').tap();
  const stage = page.locator('.lyric-stage'); const initial = await stage.boundingBox();
  await openPlayerTools(page);
  const tools = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  await scrollToEnd(tools); await reachableClose(tools);
  await page.screenshot({ path: test.info().outputPath('tools-end.png') });
  await tools.getByRole('button', { name: '关闭', exact: true }).tap();
  await clickPlayerTool(page, '歌词与动效');
  const visual = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await scrollToEnd(visual); await reachableClose(visual);
  await page.screenshot({ path: test.info().outputPath('visual-end.png') });
  expect(await stage.boundingBox()).toEqual(initial);
  await visual.locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(visual).toHaveCount(0);
});

test('returning from a settings subview retains the parent scroll position', async ({ page }) => {
  await page.goto('/mobile.html');
  await page.locator('.brand').getByRole('button', { name: '服务器与外观', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '服务器与外观', exact: true });
  const button = dialog.getByRole('button', { name: '睡眠定时', exact: true });
  await button.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const position = await dialog.locator('.sheet-body').evaluate(body => body.scrollTop);
  expect(position).toBeGreaterThan(0);
  await button.tap();
  await page.getByRole('dialog', { name: '睡眠定时', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
  await expect.poll(() => dialog.locator('.sheet-body').evaluate(body => body.scrollTop)).toBe(position);
  await expect(button).toBeInViewport();
  await reachableClose(dialog);
});

test('returning from theme editing retains the visual settings scroll position', async ({ page }) => {
  await searchPlaybackFixture(page);
  await page.goto('/mobile.html'); await seedSearchQueue(page); await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  const dialog = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const button = dialog.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true });
  await button.scrollIntoViewIfNeeded();
  const position = await dialog.locator('.sheet-body').evaluate(body => body.scrollTop);
  expect(position).toBeGreaterThan(0);
  await button.tap();
  await page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true }).getByRole('button', { name: '取消', exact: true }).tap();
  await expect.poll(() => dialog.locator('.sheet-body').evaluate(body => body.scrollTop)).toBe(position);
  await expect(button).toBeInViewport();
  await reachableClose(dialog);
});

test('compact settings content fits without horizontal scrolling in every original language', async ({ page }) => {
  await page.goto('/mobile.html'); await page.locator('.brand button').tap();
  const dialog = page.locator('.settings-sheet');
  const language = dialog.getByRole('combobox', { name: /^(界面语言|Interface language|Bahasa antarmuka)$/ });
  const initial = page.viewportSize()!;
  for (const value of ['zh-CN', 'en', 'in']) {
    await language.selectOption(value);
    for (const size of [{ width: 320, height: 568 }, { width: 568, height: 320 }, initial]) {
      await page.setViewportSize(size);
      await expect.poll(() => dialog.locator('.sheet-body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
      const close = dialog.locator(':scope > header button');
      await scrollToEnd(dialog);
      await expect.poll(() => close.evaluate(button => {
        const r = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
    }
  }
});
