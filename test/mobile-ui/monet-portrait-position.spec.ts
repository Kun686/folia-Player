import { test, expect, clickPlayerTool } from './fixtures';
import type { Page } from '@playwright/test';
import { DEFAULT_MONET_TUNING } from '../../src/types';
import { writeFile } from 'node:fs/promises';

// monet-portrait-position.spec.ts — actual paused-queue metadata, controlled empty lyrics/clock; not provider/audio acceptance.
const hanger = (page: Page) => page.locator('.lyric-stage .cursor-pointer.h-14.w-3');
const portrait = (page: Page) => page.locator('.lyric-stage .select-none').filter({ has: page.locator('.h-14.w-3') });
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('monet_tuning') || '{}'));
async function openStage(page: Page) {
  await page.evaluate(async () => {
    const w = window as any;
    const song = { id: '001fsNdn1zuZnA', name: '我不难过', artists: [{ id: '001pWERg3vFgg8', name: '孙燕姿' }],
      album: { id: '004VSvF52mQoQp', name: '未完成' }, durationMs: 320000,
      sourceRef: { kind: 'online', providerId: 'qq', mediaId: '001fsNdn1zuZnA' } };
    await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song, token: 'initial', field: 'state', value: {
      lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: { lines: [] },
    } });
    w.fixtureEmitPlayback({ queue: [song], index: 0, currentSong: song, playing: false, position: 276.4506575963719 });
  });
  await page.locator('.mini-title').tap();
  await expect(hanger(page)).toBeVisible();
  await hanger(page).evaluate(element => {
    for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'click']) {
      element.addEventListener(name, event => {
        const time = performance.timeOrigin + event.timeStamp;
        // Record after React handles the event; session storage survives the reload assertions.
        setTimeout(() => {
          const events = JSON.parse(sessionStorage.getItem('monet-position-pointer-events') || '[]');
          events.push({ type: event.type, time, prevented: event.defaultPrevented,
            pointerType: (event as PointerEvent).pointerType,
            savedOffset: JSON.parse(localStorage.getItem('monet_tuning') || '{}').portraitOffsetX });
          sessionStorage.setItem('monet-position-pointer-events', JSON.stringify(events));
        }, 0);
      });
    }
  });
}
test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  const events = await page.evaluate(() => sessionStorage.getItem('monet-position-pointer-events') || '[]');
  const path = info.outputPath('portrait-pointer-events.json');
  // The list reporter does not retain inline attachment bodies; persist diagnostics explicitly.
  await writeFile(path, events);
  await info.attach('portrait-pointer-events', { path, contentType: 'application/json' });
});
test.beforeEach(async ({ page }) => {
  const size = page.viewportSize()!;
  if (size.width < 768) await page.setViewportSize({ width: size.height, height: size.width });
  await page.addInitScript(defaultTuning => {
    localStorage.setItem('visualizer_mode', 'monet');
    localStorage.setItem('lyrics_font_scale', '1.2');
    if (!sessionStorage.getItem('monet-position-seeded')) {
      localStorage.setItem('monet_tuning', JSON.stringify({ ...defaultTuning, portraitOffsetX: -65, fontScale: 1.1, showPortraitDragHanger: true }));
      sessionStorage.setItem('monet-position-seeded', 'true');
    }
  }, DEFAULT_MONET_TUNING);
  await page.goto('/mobile.html'); await openStage(page);
});

test('reset and save persists through remount without compounding lyric font scale', async ({ page }, info) => {
  const before = await saved(page);
  await hanger(page).tap();
  await page.locator('.lyric-stage').getByRole('button', { name: '默认', exact: true }).tap();
  await hanger(page).tap();
  await expect.poll(() => saved(page)).toMatchObject({ ...before, portraitOffsetX: 0 });
  await clickPlayerTool(page, '歌词与动效');
  await page.getByRole('dialog', { name: '歌词与动效', exact: true }).locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(hanger(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath('reset-position.png') });
  await page.reload(); await openStage(page);
  expect(await saved(page)).toMatchObject({ ...before, portraitOffsetX: 0 });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('drag commits only the portrait offset and restores its rendered position after reload', async ({ page }, info) => {
  const before = await saved(page);
  await hanger(page).tap();
  // Playwright mouse uses the same Pointer Events drag path; native touch is checked separately.
  const start = (await hanger(page).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 35, start.y + start.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await hanger(page).boundingBox())!.x).toBeLessThan(start.x - 20);
  expect(await saved(page)).toEqual(before);
  await hanger(page).tap();
  await expect.poll(async () => (await saved(page)).portraitOffsetX).toBeLessThan(-85);
  await expect(page.locator('.lyric-stage').getByRole('button', { name: '默认', exact: true })).toBeHidden();
  const after = await saved(page);
  expect(after).toEqual({ ...before, portraitOffsetX: after.portraitOffsetX });
  // Saving remounts the renderer: compare resting positions, not its 50px entrance translation.
  await expect(portrait(page)).toHaveCSS('transform', 'none');
  await expect(portrait(page)).toHaveCSS('opacity', '1');
  const shifted = (await hanger(page).boundingBox())!;
  await page.screenshot({ path: info.outputPath('dragged-position.png') });
  await page.reload(); await openStage(page);
  await expect(portrait(page)).toHaveCSS('transform', 'none');
  await expect.poll(async () => Math.abs((await hanger(page).boundingBox())!.x - shifted.x)).toBeLessThan(2);
  expect(await saved(page)).toEqual(after);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});
