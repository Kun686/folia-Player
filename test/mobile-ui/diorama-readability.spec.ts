import { test, expect, clickPlayerTool } from './fixtures';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// diorama-readability.spec.ts — inspect actual projected lyric ink from the captured QQ sample, without audio claims.
const sample = JSON.parse(readFileSync(new URL('./realPreviewSample.json', import.meta.url), 'utf8'));
const fullSample = JSON.parse(readFileSync(new URL('./realDioramaSample.json', import.meta.url), 'utf8'));
async function openDiorama(page: Page, recording = sample, viewport = { width: 834, height: 1194 }) {
  let fiberUrl: string | undefined;
  page.on('request', request => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(request.url())) fiberUrl = request.url(); });
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('playback_entry_view', 'player'); localStorage.setItem('playback_entry_view_chosen', 'true');
    localStorage.setItem('visualizer_mode', 'diorama'); localStorage.setItem('default_theme_daylight', 'true');
  });
  await page.goto('/mobile.html');
  await page.evaluate(async sample => {
    const w = window as any;
    await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song: sample.song, token: 'initial', field: 'state', value: {
      lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: sample.lyrics,
    } });
    w.fixtureEmitPlayback({ queue: [sample.song], index: 0, currentSong: sample.song, position: sample.position,
      duration: sample.song.durationMs / 1000, playing: false });
    w.fixtureCommands = [];
  }, recording);
  await page.locator('.mini-title').tap();
  await expect(page.locator('[data-viewport-composition=scene] canvas')).toHaveCount(1);
  await page.waitForTimeout(1500); // Original camera orientation and zoom are damped; measure their settled pose.
  return fiberUrl;
}
async function inspectDiorama(page: Page, fiberUrl: string | undefined) {
  return page.evaluate(async moduleUrl => {
    if (!moduleUrl) throw Error('R3F module URL missing');
    const { _roots } = await import(/* @vite-ignore */ moduleUrl);
    const canvas = document.querySelector('[data-viewport-composition=scene] canvas');
    const state = _roots.get(canvas)?.store.getState(); if (!state) throw Error('Live R3F root missing');
    state.scene.updateMatrixWorld(true); state.camera.updateMatrixWorld();
    const active: any[] = [], neighbours: any[] = [];
    state.scene.traverse((mesh: any) => {
      const material = mesh.material, image = material?.map?.image, geometry = mesh.geometry?.parameters;
      if (!mesh.isMesh || !image?.getContext || !geometry?.width || !geometry?.height || ![0, 19].includes(mesh.renderOrder)) return;
      const context = image.getContext('2d'); const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let left = image.width, top = image.height, right = 0, bottom = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] < 128) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
      if (right <= left) return;
      const corners = [[left, top], [right, top], [left, bottom], [right, bottom]].map(([x, y]) =>
        state.camera.position.clone().set((x / image.width - .5) * geometry.width, (.5 - y / image.height) * geometry.height, 0)
          .applyMatrix4(mesh.matrixWorld).project(state.camera));
      if (corners.some((point: any) => point.z < -1 || point.z >= 1)) return;
      const box = { left: Math.min(...corners.map((p: any) => p.x)), right: Math.max(...corners.map((p: any) => p.x)),
        top: Math.min(...corners.map((p: any) => p.y)), bottom: Math.max(...corners.map((p: any) => p.y)), opacity: material.opacity,
        worldPosition: mesh.getWorldPosition(state.camera.position.clone()).toArray() };
      (mesh.renderOrder === 19 ? active : neighbours).push(box);
    });
    const collisions = neighbours.filter(neighbour => neighbour.opacity > .12 && active.some(glyph =>
      Math.min(neighbour.right, glyph.right) > Math.max(neighbour.left, glyph.left)
      && Math.min(neighbour.bottom, glyph.bottom) > Math.max(neighbour.top, glyph.top)));
    return { active, neighbours, collisions, viewport: [innerWidth, innerHeight] };
  }, fiberUrl);
}
test('portrait iPad keeps neighbouring lyric ink clear of the current line', async ({ page }, info) => {
  const fiberUrl = await openDiorama(page);
  const full = await inspectDiorama(page, fiberUrl);
  await page.screenshot({ path: info.outputPath('portrait-full.png') });
  await clickPlayerTool(page, '歌词与动效');
  await page.waitForTimeout(1500);
  const preview = await inspectDiorama(page, fiberUrl);
  await page.screenshot({ path: info.outputPath('portrait-preview.png') });
  await info.attach('projected-ink', { body: JSON.stringify({ full, preview }, null, 2), contentType: 'application/json' });
  expect(full.active).toHaveLength(8); expect(preview.active).toHaveLength(8);
  expect(full.collisions, 'Readable neighbouring lyric overlaps the actual current glyph ink').toEqual([]);
  expect(preview.collisions, 'Preview must preserve the current line reading order').toEqual([]);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('full native lyric corridor keeps the current lyric readable with settings open', async ({ page }, info) => {
  // Exercise the complete authored corridor with the shared hint off. With it on, the separate
  // ownership test below requires the next 3D line to be hidden instead of demanding a duplicate.
  await page.addInitScript(() => localStorage.setItem('hide_player_translation_subtitle', 'true'));
  const viewport = info.project.name === 'ipad' ? { width: 834, height: 1194 } : page.viewportSize()!;
  const fiberUrl = await openDiorama(page, fullSample, viewport);
  const full = await inspectDiorama(page, fiberUrl);
  await page.screenshot({ path: info.outputPath('full-native-corridor.png') });
  await clickPlayerTool(page, '歌词与动效');
  await page.waitForTimeout(1500);
  const preview = await inspectDiorama(page, fiberUrl);
  await page.screenshot({ path: info.outputPath('preview-native-corridor.png') });
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await page.waitForTimeout(1500);
  const rotated = await inspectDiorama(page, fiberUrl);
  await page.screenshot({ path: info.outputPath('rotated-native-corridor.png') });
  await info.attach('full-corridor-ink', { body: JSON.stringify({ full, preview, rotated }, null, 2), contentType: 'application/json' });
  expect(full.active).toHaveLength(8); expect(preview.active).toHaveLength(8);
  expect(full.collisions, 'Full real lyric context must not cross the active lyric').toEqual([]);
  expect(preview.collisions, 'Opening settings must preserve the reading corridor').toEqual([]);
  expect(rotated.collisions, 'Rotation must preserve the reading corridor').toEqual([]);
  for (const scene of [full, preview, rotated]) {
    expect(scene.neighbours.some(line => line.opacity >= .3), 'Keep the readable neighbours, not just the hero').toBe(true);
  }
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('equivalent native source field orders preserve the current lyric scene', async ({ page }, info) => {
  const fiberUrl = await openDiorama(page);
  const before = await inspectDiorama(page, fiberUrl);
  await page.evaluate(async sample => {
    const sourceRef = Object.fromEntries(Object.entries(sample.song.sourceRef).reverse());
    const song = { ...sample.song, sourceRef };
    // NativeProfileIdentity sorts reference keys before hashing. Mirror the same cache hit here;
    // this general-purpose fixture otherwise keys its in-memory map by insertion-order JSON.
    await (window as any).Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song, token: 'initial', field: 'state', value: {
      lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: sample.lyrics,
    } });
    (window as any).fixtureEmitPlayback({ queue: [song], currentSong: song });
  }, sample);
  await page.waitForTimeout(1500);
  const after = await inspectDiorama(page, fiberUrl);
  await info.attach('source-order-scene', { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' });
  expect(before.active).toHaveLength(8); expect(after.active).toHaveLength(8);
  expect(after.active.map(glyph => glyph.worldPosition), 'A native dictionary reordering must not start a new song flight')
    .toEqual(before.active.map(glyph => glyph.worldPosition));
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('settings preview releases the hidden control bar subtitle clearance', async ({ page }) => {
  await openDiorama(page, fullSample, { width: 402, height: 874 });
  await clickPlayerTool(page, '歌词与动效');
  const overlay = page.locator('[data-viewport-composition="scene"] .absolute.left-0.right-0.text-center.space-y-2');
  await expect(overlay).toHaveCount(1);
  await expect.poll(() => overlay.evaluate(element => parseFloat(getComputedStyle(element).bottom))).toBeLessThan(33);
});

test('reopening a song with reordered native metadata preserves its authored corridor', async ({ page }) => {
  const fiberUrl = await openDiorama(page, fullSample);
  const before = await inspectDiorama(page, fiberUrl);
  const reordered = { ...fullSample, song: { ...fullSample.song,
    sourceRef: Object.fromEntries(Object.entries(fullSample.song.sourceRef).reverse()) } };
  const reopenedFiberUrl = await openDiorama(page, reordered);
  const after = await inspectDiorama(page, reopenedFiberUrl);
  expect(before.active).toHaveLength(8); expect(after.active).toHaveLength(8);
  expect(after.active.map(glyph => glyph.worldPosition)).toEqual(before.active.map(glyph => glyph.worldPosition));
});

test('mobile upcoming subtitle and 3D corridor do not show the same next line twice', async ({ page }, info) => {
  const fiberUrl = await openDiorama(page, fullSample, page.viewportSize()!);
  await clickPlayerTool(page, '歌词与动效');
  const nextText = fullSample.lyrics.lines[38].fullText;
  const hint = page.locator('[data-viewport-composition="scene"] p').filter({ hasText: nextText });
  await expect(hint).toHaveCount(1);
  const nextOpacity = () => page.evaluate(async moduleUrl => {
    const { _roots } = await import(/* @vite-ignore */ moduleUrl!);
    const canvas = document.querySelector('[data-viewport-composition=scene] canvas');
    const state = _roots.get(canvas)?.store.getState();
    const next = state?.scene.getObjectByName('diorama-neighbour-38');
    if (!next) throw Error('Full real lyric corridor next line is missing');
    return next.visible ? next.material.opacity : 0;
  }, fiberUrl);
  await expect.poll(nextOpacity, { message: 'The same next line is already shown by the shared subtitle' }).toBe(0);
  await page.waitForTimeout(1500); // Wait for both the sheet and authored camera to settle before accepting a screenshot.
  await expect.poll(() => page.locator('.visual-settings').evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
  expect((await inspectDiorama(page, fiberUrl)).active).toHaveLength(8);
  await page.screenshot({ path: info.outputPath('single-upcoming-line.png') });
  // Hiding shared subtitles must return the authored 3D neighbour, without changing playback.
  const subtitles = page.locator('.typography-controls > details').nth(1);
  await subtitles.locator('summary').tap();
  const hidden = subtitles.getByRole('checkbox').first();
  await hidden.check();
  await expect(hint).toHaveCount(0);
  await expect.poll(nextOpacity).toBeGreaterThan(.12);
  await hidden.uncheck();
  await expect(hint).toHaveCount(1);
  await expect.poll(nextOpacity).toBe(0);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});
