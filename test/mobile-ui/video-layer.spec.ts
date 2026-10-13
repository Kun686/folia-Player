import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';

// video-layer.spec.ts — real silent H.264 decoding on WebKit, with the existing controlled native playback clock.
const section = (page: Page) => page.locator('.mobile-video-settings');
const video = (page: Page) => page.locator('.lyric-stage video');
const source = '/test/fixtures/video-layer.mp4';
const file = fileURLToPath(new URL('../fixtures/video-layer.mp4', import.meta.url));
async function play(page: Page) {
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 2 }));
}
async function open(page: Page) {
  await clickPlayerTool(page, '歌词与动效');
  await section(page).locator('summary').tap();
}
async function close(page: Page) {
  await page.getByRole('dialog', { name: '歌词与动效', exact: true }).locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap();
}
async function aligned(page: Page, position: number) {
  await expect.poll(() => video(page).evaluate((node, position) => {
    const v = node as HTMLVideoElement;
    return Number.isFinite(v.duration) ? Math.abs(v.currentTime - position % v.duration) : Infinity;
  }, position)).toBeLessThan(0.36);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(source => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
    localStorage.setItem('visualizer_mode', 'classic');
    localStorage.setItem('video_layer_enabled', 'true');
    localStorage.setItem('video_layer_url', source);
    localStorage.setItem('global_lyric_timeline_offset_ms', '1000');
  }, source);
});

test('actual video follows native time, fast seeks, pause and song changes, then releases while hidden', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mobile.html'); await play(page);
  await expect.poll(() => video(page).evaluate(n => (n as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  expect(await video(page).evaluate(n => ({ muted: (n as HTMLVideoElement).muted, inline: (n as HTMLVideoElement).playsInline })))
    .toEqual({ muted: true, inline: true });
  await aligned(page, 2);
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: true, position: 0.5 }));
  await expect.poll(() => video(page).evaluate(n => (n as HTMLVideoElement).paused)).toBe(false);
  await expect.poll(() => video(page).evaluate(n => (n as HTMLVideoElement).currentTime)).toBeGreaterThan(0.7);
  await page.evaluate(() => {
    (window as any).fixtureEmitPlayback({ playing: false, position: 14.4 });
    (window as any).fixtureEmitPlayback({ playing: false, position: 9.2 });
    (window as any).fixtureEmitPlayback({ playing: false, position: 10.8 });
  });
  await aligned(page, 10.8);
  await expect.poll(() => video(page).evaluate(n => (n as HTMLVideoElement).paused)).toBe(true);
  await page.evaluate(() => {
    const w = window as any; w.retainedVideo = document.querySelector('.lyric-stage video');
    const song = { ...w.fixturePlayback.currentSong, id: '22222222-2222-4222-8222-222222222222',
      sourceRef: { kind: 'local', mediaId: '22222222-2222-4222-8222-222222222222' } };
    w.fixtureEmitPlayback({ currentSong: song, queue: [song], index: 0, position: 0.6 });
  });
  await aligned(page, 0.6);
  expect(await video(page).evaluate(n => n === (window as any).retainedVideo)).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(video(page)).toHaveCount(0);
  expect(await page.evaluate(() => { const v = (window as any).retainedVideo as HTMLVideoElement; return v.paused && !v.getAttribute('src'); })).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await aligned(page, 0.6);
  expect(errors).toEqual([]);
});

test('touch settings fit rotated windows, recover from write failures and stay outside appearance exports', async ({ page }, info) => {
  await page.goto('/mobile.html'); await play(page); await open(page);
  const toggle = section(page).getByRole('button', { name: '在歌词后方显示视频', exact: true });
  const contain = section(page).getByRole('button', { name: '完整显示', exact: true });
  await contain.tap(); await expect(contain).toHaveAttribute('aria-pressed', 'true');
  const slider = section(page).getByRole('slider', { name: '不透明度', exact: true });
  await slider.scrollIntoViewIfNeeded();
  const bounds = (await slider.boundingBox())!;
  await page.touchscreen.tap(bounds.x + 8, bounds.y + bounds.height / 2);
  await expect(slider).toHaveValue('0.1');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreVideoStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('video_layer_')) throw Error('controlled-write-failure'); original.call(this, key, value); };
  });
  await toggle.tap(); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(section(page).getByRole('alert')).toHaveText('视频设置未能保存，请重试。');
  await page.evaluate(() => (window as any).restoreVideoStorage());
  await toggle.tap(); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.tap(); await expect(section(page).getByRole('alert')).toHaveCount(0);
  for (const size of [page.viewportSize()!, info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 }]) {
    await page.setViewportSize(size);
    for (const control of [toggle, contain, slider]) {
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    expect(await section(page).evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  }
  await section(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('video-settings.png') });
  const exported = await page.evaluate(async () => {
    const path = '/src/services/obs/visualSettingsConfig.ts';
    return Object.keys((await import(path)).buildVisualSettingsConfig()).filter(key => /videoLayer/i.test(key));
  });
  expect(exported).toEqual([]);
  await close(page); await expect(video(page)).toHaveCSS('object-fit', 'contain'); await expect(video(page)).toHaveCSS('opacity', '0.1');
  await page.reload(); await play(page); await open(page);
  await expect(contain).toHaveAttribute('aria-pressed', 'true'); await expect(slider).toHaveValue('0.1');
});

test('local video takes priority, cancellation preserves it, and clear restores the URL', async ({ page }) => {
  await page.goto('/mobile.html'); await play(page); await open(page);
  await expect(section(page).getByText('优先于 URL 使用。当前浏览器无法记住所选文件，重启后需要重新选择。')).toBeVisible();
  const pick = section(page).getByRole('button', { name: '选择视频', exact: true });
  const chosen = page.waitForEvent('filechooser'); await pick.tap(); await (await chosen).setFiles(file);
  await expect(section(page).getByText('video-layer.mp4', { exact: true })).toBeVisible();
  await close(page);
  await expect(video(page)).toHaveAttribute('src', /^blob:/); await aligned(page, 2);
  await open(page);
  const cancelled = page.waitForEvent('filechooser'); await pick.tap(); await (await cancelled).setFiles([]);
  await expect(section(page).getByText('video-layer.mp4', { exact: true })).toBeVisible();
  await section(page).getByRole('button', { name: '清除本地视频', exact: true }).tap();
  await expect(section(page).getByText('video-layer.mp4', { exact: true })).toHaveCount(0);
  await close(page); await expect(video(page)).toHaveAttribute('src', source); await aligned(page, 2);
});
