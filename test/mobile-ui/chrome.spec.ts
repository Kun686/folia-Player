import { test, expect, openPlayerTools, revealPlayerControls } from './fixtures';
import type { Page } from '@playwright/test';

// chrome.spec.ts — actual WebKit events and timers; native audio remains the existing fixture.
async function start(page: Page, mockClock = true) {
  if (mockClock) await page.clock.install();
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await expect(page.locator('.player-panel')).toHaveAttribute('data-controls-hidden', 'false');
}
test('full-window stage keeps its size when transport hides and first touch only wakes it', async ({ page }) => {
  await start(page);
  const stage = await page.locator('.lyric-stage').boundingBox();
  expect(stage).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
  await page.clock.fastForward(3200);
  await expect(page.locator('.player-panel')).toHaveAttribute('data-controls-hidden', 'true');
  await expect(page.locator('.player-controls')).toHaveJSProperty('inert', true);
  expect(await page.locator('.lyric-stage').boundingBox()).toEqual(stage);
  await revealPlayerControls(page);
  await expect(page.locator('.player-panel')).toHaveAttribute('data-controls-hidden', 'false');
  expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
  await page.clock.fastForward(3200);
  await expect(page.locator('.player-panel')).toHaveAttribute('data-controls-hidden', 'true');
});
test('a held seek, pointer cancellation, pause and tools follow the desktop idle clock', async ({ page }) => {
  await start(page);
  const panel = page.locator('.player-panel');
  const seek = page.getByRole('slider', { name: '播放进度', exact: true });
  await seek.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', buttons: 1 });
  await page.clock.fastForward(6000);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await seek.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'touch', buttons: 0 });
  await page.clock.fastForward(3200);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  await revealPlayerControls(page);
  await openPlayerTools(page);
  await page.clock.fastForward(6000);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await page.getByRole('dialog', { name: '更多播放选项' }).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.clock.fastForward(3200);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  await revealPlayerControls(page);
  await panel.getByRole('button', { name: '暂停', exact: true }).tap();
  await page.clock.fastForward(6000);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
});
test('rotation does not reveal hidden transport or change the native queue; queue stays reachable', async ({ page }) => {
  await start(page);
  await page.clock.fastForward(3200);
  await expect(page.locator('.player-panel')).toHaveAttribute('data-controls-hidden', 'true');
  const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
  await page.setViewportSize({ width: 896, height: 414 });
  expect(await page.locator('.lyric-stage').boundingBox()).toEqual({ x: 0, y: 0, width: 896, height: 414 });
  await expect(page.locator('.player-panel')).toHaveAttribute('data-controls-hidden', 'true');
  expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
  await revealPlayerControls(page);
  await page.locator('.player-panel').getByRole('button', { name: '播放队列', exact: true }).tap();
  await expect(page.getByRole('heading', { name: '播放队列', exact: true })).toBeVisible();
  await expect(page.locator('.library-panel')).toHaveJSProperty('inert', false);
});

test('reduced motion fades without shrinking and keyboard focus keeps controls available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Real time is required here: WebKit's compositor opacity animation does not follow the JS fake clock.
  await start(page, false);
  const panel = page.locator('.player-panel');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(3500);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await page.locator('.track-heading').tap();
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  await expect(page.locator('.player-controls')).toHaveCSS('transform', 'none');
  await expect(page.locator('.player-controls')).toHaveCSS('opacity', '0');
  await page.keyboard.press('Tab');
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await page.waitForTimeout(3500);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
});

test('blank taps hide immediately and wake without playback commands, including while paused', async ({ page }, info) => {
  await start(page);
  const panel = page.locator('.player-panel');
  const blank = () => page.locator('.lyric-stage').tap({ position: { x: 12, y: 200 } });
  const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
  await blank();
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  // Manual hiding survives incidental mouse movement, timers and orientation changes.
  await page.mouse.move(20, 220);
  await page.clock.fastForward(6000);
  await page.setViewportSize({ width: 896, height: 414 });
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  await revealPlayerControls(page);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
  await panel.getByRole('button', { name: '暂停', exact: true }).tap();
  await blank();
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  await revealPlayerControls(page);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await page.screenshot({ path: '.mobile-test-results/mobile18-glass-' + info.project.name + '.png' });
  await blank();
  await page.keyboard.press('Tab');
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await page.clock.fastForward(6000);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
});

test('drag and cancelled touches do not dismiss chrome; controls and dialogs keep their own actions', async ({ page }) => {
  await start(page);
  const panel = page.locator('.player-panel'), stage = page.locator('.lyric-stage');
  const down = { pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0, clientX: 12, clientY: 200 };
  await stage.dispatchEvent('pointerdown', down);
  await stage.dispatchEvent('pointermove', { ...down, clientY: 240 });
  await stage.dispatchEvent('pointerup', down); // Moving away and back is still a gesture, not a tap.
  await stage.dispatchEvent('click', { clientX: 12, clientY: 200 });
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await stage.dispatchEvent('pointerdown', down);
  await stage.dispatchEvent('pointercancel', down);
  await stage.dispatchEvent('click', { clientX: 12, clientY: 200 });
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await page.locator('.track-heading').tap();
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await openPlayerTools(page);
  await page.clock.fastForward(6000);
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await expect(page.getByRole('dialog', { name: '更多播放选项' })).toBeVisible();
});

test('external pause and errors reveal a manually hidden transport', async ({ page }) => {
  await start(page);
  const panel = page.locator('.player-panel');
  await page.locator('.lyric-stage').tap({ position: { x: 12, y: 200 } });
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false }));
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await page.locator('.lyric-stage').tap({ position: { x: 12, y: 200 } });
  await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: 'network-unavailable' }));
  await expect(panel).toHaveAttribute('data-controls-hidden', 'false');
  await expect(panel.getByRole('alert')).toBeVisible();
});
