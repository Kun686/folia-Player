import { readFileSync } from 'node:fs';
import { test, expect, clickPlayerTool } from './fixtures';

// cappella-assets.spec.ts — real asset storage/UI with an empty queue; no songs or provider acceptance.
// Exercise real storage with the same image bytes; do not replace persistence with a mock.
const image = { name: 'AppIcon-512@2x.png', mimeType: 'image/png',
  buffer: readFileSync(new URL('../../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', import.meta.url)) };

for (const [index, name, field] of [[0, '头像', 'avatarSource'], [1, '表情包', 'emojiPackSource']] as const) {
  test(`Cappella custom ${field} can be selected, restored and cleared`, async ({ page }, info) => {
    const cacheErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error' && message.text().startsWith('Cache save failed')) {
        cacheErrors.push(message.text());
      }
    });
    await page.addInitScript(() => localStorage.setItem('visualizer_mode', 'cappella'));
    const openSettings = async () => {
      await page.locator('.mini-title').tap();
      await clickPlayerTool(page, '歌词与动效');
    };
    await page.goto('/mobile.html');
    await openSettings();
    const dialog = page.getByRole('dialog', { name: '歌词与动效', exact: true });
    const custom = dialog.getByRole('button', { name: '自定义', exact: true }).nth(index);
    const clear = dialog.getByRole('button', { name: `清空自定义${name}`, exact: true });
    const preview = dialog.getByAltText('AppIcon-512@2x.png', { exact: true });
    await expect(custom).toBeDisabled();
    await expect(clear).toBeDisabled();
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: `上传自定义${name}`, exact: true }).tap();
    await (await chooser).setFiles(image);
    await expect(preview).toHaveCount(1);
    expect(cacheErrors).toEqual([]);
    await expect(custom).toBeEnabled();
    await expect(clear).toBeEnabled();
    await custom.tap();
    await expect.poll(() => page.evaluate(field => JSON.parse(localStorage.getItem('cappella_tuning') || '{}')[field], field)).toBe('custom');

    // Restore through the existing IndexedDB loader, not by injecting asset store state.
    await page.reload();
    await openSettings();
    await expect(preview).toHaveCount(1);
    await expect(custom).toBeEnabled();
    await expect(clear).toBeEnabled();
    await expect.poll(() => page.evaluate(field => JSON.parse(localStorage.getItem('cappella_tuning') || '{}')[field], field)).toBe('custom');
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await clear.scrollIntoViewIfNeeded();
    await expect(clear).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`${field}-restored.png`) });
    await clear.tap();
    await expect(preview).toHaveCount(0);
    await expect(custom).toBeDisabled();
    await expect(clear).toBeDisabled();
    expect(cacheErrors).toEqual([]);
    await expect.poll(() => page.evaluate(field => JSON.parse(localStorage.getItem('cappella_tuning') || '{}')[field], field)).toBe('builtin');
    await page.reload();
    await openSettings();
    await expect(preview).toHaveCount(0);
    await expect(custom).toBeDisabled();
    await expect(clear).toBeDisabled();
  });
}
