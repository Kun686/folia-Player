import { test, expect, clickPlayerTool } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { LyricData, SongResult } from '../../src/types';

// visualizer-loading.spec.ts — real cached QQ lyrics with controlled module loading, not live audio acceptance.
const sample = JSON.parse(readFileSync(new URL('./realPreviewSample.json', import.meta.url), 'utf8')) as {
  song: SongResult; lyrics: LyricData; position: number;
};

// Hold only a real lazy module: the settings, renderer and all other resources remain unmodified.
async function holdMonetModule(page: Page) {
  let release!: () => void;
  let intercepted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/src\/components\/visualizer\/monet\/VisualizerMonet\.tsx(?:\?|$)/, async route => {
    intercepted = true;
    await gate;
    await route.continue();
  });
  return { release, requested: () => intercepted };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('playback_entry_view', 'player');
    localStorage.setItem('playback_entry_view_chosen', 'true');
    localStorage.setItem('visualizer_mode', 'classic');
  });
  await page.goto('/mobile.html');
  await page.evaluate(async value => {
    const { song, lyrics, position } = JSON.parse(value) as typeof sample;
    const w = window as any;
    await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song, token: 'initial', field: 'state', value: {
      lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: lyrics,
    } });
    w.fixtureEmitPlayback({ queue: [song], index: 0, currentSong: song, position, duration: song.durationMs / 1000, playing: false });
    w.fixtureCommands = [];
  }, JSON.stringify(sample));
  await page.locator('.mini-title').tap();
  await expect(page.locator('.lyric-stage .inline-block.origin-center').first()).toBeVisible();
  await clickPlayerTool(page, '歌词与动效');
  await expect(page.getByRole('dialog', { name: '歌词与动效', exact: true })).toHaveCSS('opacity', '1');
});

test('current lyrics remain visible until the newly selected renderer loads', async ({ page }, info) => {
  const held = await holdMonetModule(page);
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const classic = page.locator('.lyric-stage .inline-block.origin-center').first();
  const original = await classic.elementHandle();
  try {
    await panel.getByRole('combobox', { name: '歌词动画', exact: true }).selectOption('monet');
    await expect.poll(held.requested).toBe(true);
    await expect(panel.getByRole('combobox', { name: '歌词动画', exact: true })).toHaveValue('monet');
    await page.waitForTimeout(400); // Cross React's fallback throttle while the real module remains held.
    await page.screenshot({ path: info.outputPath('pending-mode.png') });
    await expect(classic).toBeVisible({ timeout: 1000 });
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  } finally { held.release(); }
  const title = page.locator('.lyric-stage [data-monet-title]');
  await expect(title).toHaveText(sample.song.name);
  await expect.poll(() => title.evaluate(el => {
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  })).toBeGreaterThan(.95);
  await expect(page.locator('.lyric-stage .inline-block.origin-center')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('loaded-mode.png') });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(sample.position);
});

test('a pending mode cannot override a newer choice or block live adjustments and rotation', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const held = await holdMonetModule(page);
  const panel = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const picker = panel.getByRole('combobox', { name: '歌词动画', exact: true });
  const classic = page.locator('.lyric-stage .inline-block.origin-center').first();
  const original = await classic.elementHandle();
  const size = page.viewportSize()!;
  const common = panel.locator('.typography-controls > details').first();
  const delivered = page.waitForResponse(/\/src\/components\/visualizer\/monet\/VisualizerMonet\.tsx(?:\?|$)/);
  try {
    await picker.selectOption('monet');
    await expect.poll(held.requested).toBe(true);
    await common.locator('summary').tap();
    await common.getByRole('slider', { name: /透明度/ }).fill('0.55');
    await expect(page.locator('.lyric-stage > div').first()).toHaveCSS('opacity', '0.55');
    // Native playback updates are urgent even while the visual selection is suspended.
    await page.evaluate(position => (window as any).fixtureEmitPlayback({ position }), sample.position + .3);
    await expect(classic).toBeVisible();
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(classic).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(size.width + 1);
    await common.locator('summary').tap();
    await picker.selectOption('classic');
    await expect(picker).toHaveValue('classic');
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  } finally { held.release(); }
  const response = await delivered;
  expect(response.ok()).toBe(true);
  await response.finished();
  // The resource-timing buffer can fill during app startup; await the same module, including its
  // dependencies, instead of treating a missing timing entry as a failed request.
  await page.evaluate(async url => { await import(/* @vite-ignore */ url); }, response.url());
  await page.waitForTimeout(400); // Give the obsolete import a chance to commit, if the selection guard is broken.
  await expect(classic).toBeVisible();
  await expect(page.locator('.lyric-stage [data-monet-title]')).toHaveCount(0);
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  await panel.locator('header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.lyric-stage')).toHaveJSProperty('inert', false);
  await page.setViewportSize(size);
  await expect(classic).toBeVisible();
  await page.screenshot({ path: info.outputPath('newest-mode-restored.png') });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(sample.position + .3);
  expect(errors).toEqual([]);
});
