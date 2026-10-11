import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// material.spec.ts — separate compositor capability from app material and accessibility checks.
async function openPausedPlayer(page: Page) {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false }));
}

test('frosted controls blur the scene when the browser compositor supports backdrop sampling', async ({ page }, info) => {
  // Some Playwright WebKit builds report CSS support but do not composite even a standalone blur.
  // This independent canary never samples app CSS; incapable engines are NOT a material pass.
  await page.setContent('<div style="position:fixed;inset:0;background:repeating-linear-gradient(90deg,#fff 0 8px,#000 8px 16px)"><div id="probe" style="position:absolute;inset:20px;backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px)"></div></div>');
  const probe = page.locator('#probe');
  const baselineBlur = await probe.screenshot();
  await probe.evaluate(element => {
    (element as HTMLElement).style.setProperty('backdrop-filter', 'none');
    (element as HTMLElement).style.setProperty('-webkit-backdrop-filter', 'none');
  });
  test.skip(baselineBlur.equals(await probe.screenshot()), 'Browser compositor does not render the independent backdrop-blur canary; verify native iOS separately.');
  await openPausedPlayer(page);
  await page.addStyleTag({ content: '.lyric-stage > * { visibility: hidden !important; } .lyric-stage { background: repeating-linear-gradient(90deg, #b0e0e6 0 8px, #164454 8px 16px); }' });
  const controls = page.locator('.player-controls');
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(controls).toHaveCSS('transform', 'none');
  const frosted = await controls.screenshot();
  await controls.evaluate(element => {
    (element as HTMLElement).style.setProperty('backdrop-filter', 'none');
    (element as HTMLElement).style.setProperty('-webkit-backdrop-filter', 'none');
  });
  const clear = await controls.screenshot();
  await info.attach('frosted', { body: frosted, contentType: 'image/png' });
  await info.attach('clear', { body: clear, contentType: 'image/png' });
  expect(frosted.equals(clear)).toBe(false);
});

test('increased contrast replaces transparent controls with a solid surface', async ({ page }) => {
  await openPausedPlayer(page);
  await page.emulateMedia({ contrast: 'more' });
  for (const selector of ['.player-controls', '.track-heading', '.player-heading .chrome-button']) {
    const surface = page.locator(selector).first();
    expect(await surface.evaluate(element => getComputedStyle(element).backdropFilter)).toBe('none');
    await expect(surface).toHaveCSS('background-color', 'rgb(9, 9, 11)');
  }
});
