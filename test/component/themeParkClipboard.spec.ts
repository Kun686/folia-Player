import { test, expect } from './fixtures';

// themeParkClipboard.spec.ts — the desktop Theme Park keeps its browser clipboard default after mobile injection.
test('desktop clipboard success, failure and retry use the original prompt and theme JSON', async ({ page, mount }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => {
        if ((window as any).clipboardFailure) throw new DOMException('Denied', 'NotAllowedError');
        (window as any).copiedThemeText = text;
      },
    } });
  });
  await mount('themePark');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: 'Copy prompt', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedThemeText)).toContain('probe lyrics snippet');
  await page.evaluate(() => { (window as any).clipboardFailure = true; });
  await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Copy failed');
  await page.evaluate(() => { (window as any).clipboardFailure = false; });
  await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse((window as any).copiedThemeText).dark.name)).toBe('暮霭子夜');
});
