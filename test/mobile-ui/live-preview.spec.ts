import { test, expect, clickPlayerTool } from './fixtures';
import type { Page, Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { LyricData, SongResult } from '../../src/types';

// live-preview.spec.ts — the paused QQ cache sample is real; the transport is controlled, not audio acceptance.
const sample = JSON.parse(readFileSync(new URL('./realPreviewSample.json', import.meta.url), 'utf8')) as {
  song: SongResult; lyrics: LyricData; position: number;
};
async function expectModeContent(page: Page, mode: string) {
  const scene = page.locator('[data-viewport-composition=scene]').first();
  if (mode === 'classic') {
    const word = scene.locator('.inline-block.origin-center').first();
    await expect(word).toContainText('这');
    await expect.poll(() => word.evaluate(el => Number(getComputedStyle(el).opacity))).toBeGreaterThan(.8);
  }
  if (mode === 'diorama') {
    const canvas = scene.locator('canvas');
    await expect(canvas).toHaveCount(1);
    await expect.poll(async () => {
      const outer = await scene.boundingBox(), inner = await canvas.boundingBox();
      if (!outer || !inner) return Infinity;
      return Math.max(Math.abs(inner.width - outer.width), Math.abs(inner.height - outer.height));
    }).toBeLessThan(1);
  }
  if (mode === 'monet') {
    // Bounds alone can pass while the original delayed entrance is still fully transparent.
    // The settings sheet makes the stage inert; query the rendered lyric row, not an accessible name.
    const currentLine = scene.locator('div.absolute.top-0.will-change-transform').filter({ hasText: '规' });
    await expect(scene.locator('[data-monet-album]')).toHaveCount(0);
    for (const content of [scene.locator('[data-monet-title]'), currentLine]) {
      await expect(content).toBeVisible();
      await expect.poll(() => content.evaluate(el => {
        let opacity = 1;
        for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      })).toBeGreaterThan(.95);
    }
    await expect.poll(async () => {
      const title = (await scene.locator('[data-monet-title]').boundingBox())!, outer = (await scene.boundingBox())!;
      return title.y >= outer.y - 1 && title.y + title.height <= outer.y + outer.height + 1;
    }).toBe(true);
  }
}
async function expectClearPreview(page: Page, panel: Locator) {
  const scene = page.locator('[data-viewport-composition=scene]').first();
  await expect(scene).toBeVisible();
  // Read both rectangles in one browser turn: a lazy mode commit can replace the scene between
  // separate boundingBox calls. Keep every clearance, viewport and phone-width requirement.
  await expect.poll(() => panel.evaluate(element => {
    const content = document.querySelector('[data-viewport-composition=scene]')?.getBoundingClientRect();
    const sheet = element.getBoundingClientRect();
    if (!content || content.width <= 0 || content.height <= 0) return false;
    const clear = content.right <= sheet.left - 10 || content.bottom <= sheet.top - 10
      || content.left >= sheet.right + 10 || content.top >= sheet.bottom + 10;
    return clear && content.x >= 0 && content.y >= 0 && content.right <= innerWidth + 1 && content.bottom <= innerHeight + 1
      && (innerWidth >= 700 || innerHeight <= innerWidth || content.width > innerWidth * .8);
  })).toBe(true);
  await expect(page.locator('.lyric-stage')).toHaveJSProperty('inert', true);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('playback_entry_view', 'player'); localStorage.setItem('playback_entry_view_chosen', 'true');
    localStorage.setItem('visualizer_mode', 'classic');
  });
  await page.goto('/mobile.html');
  await page.evaluate(async sampleJson => {
    const { song, lyrics, position } = JSON.parse(sampleJson) as typeof sample;
    const w = window as any;
    await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song, token: 'initial', field: 'state', value: {
      lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: lyrics,
    } });
    w.fixtureEmitPlayback({ queue: [song], index: 0, currentSong: song, position, duration: song.durationMs / 1000, playing: false });
    w.fixtureCommands = [];
  }, JSON.stringify(sample));
  await page.locator('.mini-title').tap();
});
test('real lyric composition stays visible through mode changes, rotation and closing settings', async ({ page }, info) => {
  const original = await page.locator('[data-viewport-composition=scene]').elementHandle();
  await expectModeContent(page, 'classic');
  await clickPlayerTool(page, '歌词与动效');
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await expectClearPreview(page, panel);
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  for (const mode of ['classic', 'monet', 'diorama']) {
    await panel.getByRole('combobox', { name: '歌词动画', exact: true }).selectOption(mode);
    await expectModeContent(page, mode);
    await expectClearPreview(page, panel);
    await page.screenshot({ path: info.outputPath(`preview-${mode}.png`) });
  }
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await expectClearPreview(page, panel);
  await expectModeContent(page, 'diorama');
  await page.screenshot({ path: info.outputPath('preview-rotated.png') });
  const canvas = await page.locator('.lyric-stage canvas').last().elementHandle();
  await panel.locator('header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.locator('.lyric-stage')).toHaveJSProperty('inert', false);
  await expect.poll(async () => (await page.locator('[data-viewport-composition=scene]').first().boundingBox())!.width).toBeCloseTo(size.height, 0);
  await expectModeContent(page, 'diorama');
  if (canvas) expect(await canvas.evaluate(el => el.isConnected)).toBe(true);
  await page.screenshot({ path: info.outputPath('full-diorama-rotated.png') });
  await page.setViewportSize(size);
  await expectModeContent(page, 'diorama');
  await page.waitForTimeout(800); // Let the original camera's damped framing settle after the viewport changes.
  await page.screenshot({ path: info.outputPath('full-diorama-restored.png') });
  if (canvas) expect(await canvas.evaluate(el => el.isConnected)).toBe(true);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(sample.position);
});
test('collage preview preserves its poster wall and full-screen background', async ({ page }, info) => {
  await clickPlayerTool(page, '歌词与动效');
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await panel.getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await expectClearPreview(page, panel);
  const wall = await page.locator('.lattice-field').elementHandle();
  const size = page.viewportSize()!;
  expect((await page.locator('.lattice-root').boundingBox())!.width).toBe(size.width);
  await page.screenshot({ path: info.outputPath('collage-preview.png') });
  await panel.locator('header').getByRole('button', { name: '关闭', exact: true }).tap();
  expect(await wall!.evaluate(el => el.isConnected)).toBe(true);
  await expect.poll(async () => (await page.locator('[data-viewport-composition=scene]').boundingBox())!.width).toBeCloseTo(size.width, 0);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('preview readability tint fades out at every edge without a rectangular seam', async ({ page }, info) => {
  await clickPlayerTool(page, '歌词与动效');
  const scene = page.locator('[data-viewport-composition=scene]').first();
  // Isolate the actual rendered CSS on a neutral surface: moving artwork must not mask an abrupt tint edge.
  const probe = await scene.evaluate(element => {
    const protection = [...element.children].find(child => getComputedStyle(child).backgroundImage.includes('radial-gradient'));
    if (!protection) throw Error('preview protection missing');
    const host = document.createElement('div'); host.id = 'preview-edge-probe';
    Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '336px', height: '196px', zIndex: '2147483647', background: 'rgb(96,96,96)' });
    const layer = document.createElement('div');
    Object.assign(layer.style, { position: 'absolute', left: '8px', top: '8px', width: '320px', height: '180px', backgroundImage: getComputedStyle(protection).backgroundImage });
    host.append(layer); document.body.append(host); return host.id;
  });
  const png = await page.locator('#' + probe).screenshot({ path: info.outputPath('preview-edge-probe.png') });
  const contrast = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); if (!context) throw Error('2d context missing');
    context.drawImage(image, 0, 0);
    const delta = (x: number, y: number) => Math.max(...context.getImageData(x, y, 1, 1).data.slice(0, 3).map(value => Math.abs(value - 96)));
    return { edges: [[168, 8], [168, 187], [8, 98], [327, 98]].map(([x, y]) => delta(x, y)), centre: delta(168, 98) };
  }, png.toString('base64'));
  await page.locator('#' + probe).evaluate(element => element.remove());
  await info.attach('edge-contrast', { body: JSON.stringify(contrast), contentType: 'application/json' });
  expect(contrast.centre, 'The reading protection must remain effective in the middle').toBeGreaterThan(20);
  expect(Math.max(...contrast.edges), 'Tint must meet the unchanged background continuously at all four sides').toBeLessThanOrEqual(3);
});

test('paused and advancing real lyric content survive preview mode changes', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const snapshots: unknown[] = [];
  const capture = async (name: string) => {
    await page.waitForTimeout(2200); // Monet's original delayed entrance takes up to 2.2s; capture its settled composition.
    snapshots.push(await page.locator('.lyric-stage').evaluate((stage, name) => ({ name,
      text: stage.textContent,
      nodes: [...stage.querySelectorAll('span,canvas')].filter(el => el.tagName === 'CANVAS' || (el.textContent?.trim() && el.children.length === 0)).map(el => {
        const rect = el.getBoundingClientRect();
        let opacity = 1; for (let node: Element | null = el; node && node !== stage; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return { tag: el.tagName, text: el.textContent, rect: rect.toJSON(), opacity, fontSize: getComputedStyle(el).fontSize };
      }),
    }), name));
    await page.screenshot({ path: info.outputPath(name + '.png') });
  };
  await capture('full-classic-paused');
  await expectModeContent(page, 'classic');
  await clickPlayerTool(page, '歌词与动效');
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  for (const mode of ['classic', 'monet', 'diorama']) {
    await panel.getByRole('combobox', { name: '歌词动画', exact: true }).selectOption(mode);
    await expectClearPreview(page, panel);
    await expectModeContent(page, mode);
    await capture(mode + '-paused');
    await page.evaluate(position => (window as any).fixtureEmitPlayback({ position, playing: true }), sample.position + .3);
    await capture(mode + '-advancing');
    await page.evaluate(position => (window as any).fixtureEmitPlayback({ position, playing: false }), sample.position);
  }
  await info.attach('visibility', { body: JSON.stringify({ snapshots, errors }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
