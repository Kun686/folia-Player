import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool, revealPlayerControls } from './fixtures';

// motion-preferences.spec.ts — original settings, CSS and renderer behavior with controlled native playback.
const dialog = (page: Page) => page.getByRole('dialog', { name: '歌词与动效', exact: true });
const section = (page: Page) => page.locator('.mobile-motion-settings');
const button = (page: Page, name: string) => section(page).getByRole('button', { name, exact: true });
const flags = (page: Page) => page.locator('html').getAttribute('data-reduce-motion');
async function play(page: Page) {
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false }));
}
async function open(page: Page) {
  await clickPlayerTool(page, '歌词与动效');
  await section(page).locator('summary').tap();
}
async function close(page: Page) { await dialog(page).locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap(); }
async function hide(page: Page) {
  await page.locator('.lyric-stage').tap({ position: { x: 12, y: 200 } });
  await expect(page.locator('.player-controls')).toHaveCSS('opacity', '0');
}
const driftCount = (page: Page) => page.evaluate(() => document.getAnimations().filter(animation => {
  const effect = animation.effect;
  return effect instanceof KeyframeEffect && effect.target instanceof HTMLElement
    && effect.target.closest('.lyric-stage') && effect.target.style.willChange === 'transform'
    && effect.getTiming().iterations === Infinity && animation.playState === 'running';
}).length);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
    localStorage.setItem('visualizer_mode', 'classic');
  });
});

test('touch preferences persist, retain accepted values on storage failure and fit rotated windows', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mobile.html'); await play(page); await open(page);
  await expect(section(page).getByRole('button')).toHaveCount(4);
  const labels = ['跟随系统设置', '混音过渡', 'Monet 背景漂移', '界面微动效'];
  const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
  await button(page, '界面微动效').tap(); await button(page, 'Monet 背景漂移').tap();
  await expect.poll(() => flags(page)).toBe('monetBackground uiMicroMotion');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreMotionStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('reduce_motion_')) throw Error('controlled-storage-failure');
      original.call(this, key, value);
    };
  });
  await button(page, '界面微动效').tap(); await button(page, '跟随系统设置').tap();
  await expect(button(page, '界面微动效')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, '跟随系统设置')).toHaveAttribute('aria-pressed', 'false');
  await expect(section(page).getByRole('alert')).toHaveText('动效偏好未能保存，请重试。');
  await expect.poll(() => flags(page)).toBe('monetBackground uiMicroMotion');
  await page.evaluate(() => (window as any).restoreMotionStorage());
  await button(page, 'Monet 背景漂移').tap();
  await expect(section(page).getByRole('alert')).toHaveCount(0);
  for (const size of [page.viewportSize()!, info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 }]) {
    await page.setViewportSize(size);
    for (const label of labels) {
      await button(page, label).scrollIntoViewIfNeeded();
      const bounds = (await button(page, label).boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(44); expect(bounds.width).toBeGreaterThanOrEqual(44);
    }
    expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await section(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('motion-settings.png') });
  expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
  await page.reload(); await play(page); await open(page);
  await expect(button(page, '界面微动效')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Monet 背景漂移')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('system preference is opt-in and updates the actual hidden transport at runtime', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/mobile.html'); await play(page);
  expect(await flags(page)).toBeNull();
  await hide(page);
  await expect.poll(() => page.locator('.player-controls').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(0.92, 2);
  await revealPlayerControls(page); await open(page);
  await button(page, '跟随系统设置').tap();
  await expect(section(page).getByText('当前正被上面的系统设置压低。', { exact: true })).toHaveCount(3);
  await close(page); await hide(page);
  await expect(page.locator('.player-controls')).toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => flags(page)).toBeNull();
  await expect.poll(() => page.locator('.player-controls').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(0.92, 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.player-controls')).toHaveCSS('transform', 'none');
  await revealPlayerControls(page); await open(page);
  await button(page, '界面微动效').tap(); await button(page, '跟随系统设置').tap();
  await expect.poll(() => flags(page)).toBe('uiMicroMotion');
  await close(page); await hide(page);
  await expect(page.locator('.player-controls')).toHaveCSS('transform', 'none');
});

test('Monet drift obeys its own saved preference while other animations remain enabled', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('visualizer_background_mode', 'monet');
    localStorage.setItem('monet_background_tuning', JSON.stringify({ backgroundLayout: 'full-overlay', backgroundDriftEnabled: true, backgroundDriftStrength: 1 }));
  });
  await page.goto('/mobile.html'); await play(page);
  await expect.poll(() => driftCount(page)).toBeGreaterThan(0);
  await open(page); await button(page, 'Monet 背景漂移').tap(); await close(page);
  await expect.poll(() => flags(page)).toBe('monetBackground');
  await expect.poll(() => driftCount(page)).toBe(0);
  await hide(page);
  await expect.poll(() => page.locator('.player-controls').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(0.92, 2);
  await revealPlayerControls(page); await open(page);
  await button(page, 'Monet 背景漂移').tap(); await close(page);
  await expect.poll(() => driftCount(page)).toBeGreaterThan(0);
});

test('transition reduction keeps the progress ring while removing its decorative pulse', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('folia_transition_animation', 'true'));
  await page.goto('/mobile.html'); await play(page); await open(page);
  await button(page, '混音过渡').tap(); await close(page);
  await expect.poll(() => flags(page)).toBe('transitionOverlay');
  const emit = (id: number) => page.evaluate(id => (window as any).fixtureEmitPlayback({ transitionCue: {
    id, seconds: 20, crossover: 0.5, periodSec: 0.63, plain: false, elapsed: 5,
  } }), id);
  const ring = page.locator('div.fixed.inset-0.z-\\[170\\]');
  await emit(90); await expect(ring).toBeVisible();
  const pulse = ring.locator('svg').locator('..');
  await expect(pulse).toHaveCSS('transform', 'none');
  // The original animated arc remains a clock, even when the decorative breathing is disabled.
  const arc = ring.locator('svg path').nth(1);
  const offset = await arc.evaluate(el => getComputedStyle(el).strokeDashoffset);
  await expect.poll(() => arc.evaluate(el => getComputedStyle(el).strokeDashoffset)).not.toBe(offset);
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ transitionCue: null }));
  await expect(ring).toHaveCount(0);
  await open(page); await button(page, '混音过渡').tap(); await close(page);
  await emit(91); await expect(ring).toBeVisible();
  await expect.poll(() => pulse.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(1.002);
});
