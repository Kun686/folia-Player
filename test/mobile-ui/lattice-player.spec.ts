import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { seed, queue } from './playerQueueFixture';

// lattice-player.spec.ts — public metadata from the verified QQ queue; controlled transport/empty lyrics, not live playback acceptance.
const expanded = (page: Page) => page.locator('.mobile-lattice .lattice-poster.is-expanded');
async function expectPosterInside(page: Page) {
  await expect.poll(async () => {
    const box = await expanded(page).boundingBox(), size = page.viewportSize()!;
    return !!box && box.width > 100 && box.x >= -1 && box.y >= -1
      && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1;
  }).toBe(true);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/mobile.html'); await seed(page);
});

test('original wall fits rotation and its touch controls command the native transport', async ({ page }, info) => {
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await expectPosterInside(page);
  await expect(page.locator('.mobile-lattice-tools')).toHaveCSS('border-radius', '28px');
  await expect(expanded(page)).toHaveAttribute('aria-label', '我不难过 · 孙燕姿');
  await expect(expanded(page)).toHaveCSS('background-image', /data:image\/png;base64/);
  await expanded(page).tap({ position: { x: 70, y: 70 } });
  await expanded(page).getByRole('button', { name: '播放', exact: true }).tap();
  await expanded(page).getByRole('button', { name: '暂停', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureCommands.map((c: any) => c.action))).toEqual(['play', 'pause']);
  await expanded(page).getByRole('button', { name: '下一首', exact: true }).tap();
  await expanded(page).getByRole('button', { name: '上一首', exact: true }).tap();
  const seek = expanded(page).locator('input[type=range]');
  await seek.tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureCommands.some((c: any) => c.action === 'seek'))).toBe(true);
  const original = page.viewportSize()!;
  await page.setViewportSize({ width: original.height, height: original.width });
  await expectPosterInside(page);
  await page.screenshot({ path: info.outputPath('rotated-wall.png') });
  await page.setViewportSize(original); await expectPosterInside(page);
  const play = await expanded(page).getByRole('button', { name: '播放', exact: true }).boundingBox();
  expect(play!.width).toBeGreaterThanOrEqual(43.5); expect(play!.height).toBeGreaterThanOrEqual(43.5);
  await page.screenshot({ path: info.outputPath('poster-wall.png') });
  await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  await expect(page.locator('.mobile-lattice')).toHaveCount(0);
});

test('poster selection keeps queue order and reports native refusal without changing songs', async ({ page }) => {
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await expectPosterInside(page);
  const id = await page.locator('.lattice-poster:not(.is-expanded)').evaluateAll(nodes => nodes.find(node => {
    const r = node.getBoundingClientRect();
    return node.getAttribute('aria-label') === '我怀念的 · 孙燕姿' && r.x > 16 && r.y > 60
      && r.right < innerWidth - 16 && r.bottom < innerHeight - 70;
  })?.getAttribute('data-instance-id'));
  expect(id).toBeTruthy();
  await page.locator(`[data-instance-id="${id}"]`).tap();
  await expect(expanded(page)).toHaveAttribute('aria-label', '我怀念的 · 孙燕姿');
  await expectPosterInside(page);
  await page.evaluate(() => { (window as any).fixtureRejectSelection = true; });
  await expanded(page).getByRole('button', { name: '播放', exact: true }).tap();
  await expect(page.locator('.mobile-lattice-error')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.id)).toBe(queue[0].id);
  await page.evaluate(() => { (window as any).fixtureRejectSelection = false; });
  await expanded(page).getByRole('button', { name: '播放', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.currentSong.id)).toBe(queue[1].id);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.id))).toEqual(queue.map(s => s.id));
  expect(await page.evaluate(() => (window as any).fixtureQueueOperations)).toEqual(['selectQueue', 'selectQueue']);
  await expect(page.locator('.mobile-lattice-error')).toHaveCount(0);
});

test('library and settings have neutral copy and preserve the chosen playback view', async ({ page }, info) => {
  await expect(page.locator('body')).not.toContainText(/folia/i);
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: '服务器与外观', exact: true });
  await expect(settings).not.toContainText(/folia/i);
  await settings.getByRole('button', { name: '批量导出歌词', exact: true }).tap();
  const batch = page.getByRole('dialog', { name: '批量导出歌词', exact: true });
  await expect(batch).not.toContainText(/folia/i);
  await batch.locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap();
  await settings.getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await page.screenshot({ path: info.outputPath('playback-settings.png') });
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.reload(); await seed(page);
  await page.locator('.mini-title').tap(); await expectPosterInside(page);
  await page.locator('.mobile-lattice-tools').getByRole('button', { name: '更多播放选项', exact: true }).tap();
  await page.getByRole('button', { name: '歌词与动效', exact: true }).tap();
  const visual = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await expect(visual).not.toContainText(/folia/i);
  await visual.getByRole('button', { name: '歌词播放器', exact: true }).tap();
  await visual.locator(':scope > header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.locator('.player-heading')).toBeVisible();
  await expect(page.locator('.mobile-lattice')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('immersive wall fills safe-area edges and restores system chrome on either exit', async ({ page }, info) => {
  await page.addStyleTag({ content: '.mobile-app { --safe-top: 59px; --safe-bottom: 34px; --safe-left: 20px; --safe-right: 16px; }' });
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  const wall = page.locator('.mobile-lattice .lattice-root');
  await expect(wall).toBeVisible();
  expect(await wall.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  await expect.poll(() => page.evaluate(() => (window as any).fixtureStatusBarHidden)).toBe(true);
  await expect(page.locator('.lattice-back')).toHaveCSS('top', '71px');
  await expect(page.locator('.mobile-lattice-tools')).toHaveCSS('bottom', '46px');
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  expect(await wall.boundingBox()).toEqual({ x: 0, y: 0, width: size.height, height: size.width });
  await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureStatusBarHidden)).toBe(false);
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureStatusBarHidden)).toBe(true);
  await page.locator('.mobile-lattice-tools').getByRole('button', { name: '歌词播放器', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureStatusBarHidden)).toBe(false);
  await expect(page.locator('.player-heading')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await page.screenshot({ path: info.outputPath('restored-lyric-player.png') });
});

test('corner tools hide while paused, wake without playback, and stay visible during touch or keyboard use', async ({ page }, info) => {
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await expectPosterInside(page);
  await page.clock.install();
  const tools = page.locator('.mobile-lattice-tools');
  const wall = page.locator('.mobile-lattice .lattice-root');
  const touch = { pointerId: 91, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
  // Root-targeted events represent empty wall space, leaving all poster and transport handlers untouched.
  await wall.dispatchEvent('pointerdown', touch);
  await page.clock.fastForward(6000);
  await expect(tools).toHaveAttribute('aria-hidden', 'false');
  await wall.dispatchEvent('pointercancel', { ...touch, buttons: 0 });
  await page.clock.fastForward(3200);
  await expect(tools).toHaveAttribute('aria-hidden', 'true');
  await expect(tools).toHaveJSProperty('inert', true);
  await expect(tools).toHaveCSS('opacity', '0');
  await page.screenshot({ path: info.outputPath('immersive-idle.png') });
  await wall.dispatchEvent('pointerdown', touch);
  await wall.dispatchEvent('pointerup', { ...touch, buttons: 0 });
  await expect(tools).toHaveAttribute('aria-hidden', 'false');
  await expect(tools).toHaveJSProperty('inert', false);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await tools.getByRole('button', { name: '更多播放选项', exact: true }).tap();
  await page.clock.fastForward(6000);
  await expect(tools).toHaveAttribute('aria-hidden', 'false');
  await page.getByRole('dialog', { name: '更多播放选项' }).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.clock.fastForward(3200);
  await expect(tools).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Tab');
  await page.clock.fastForward(6000);
  await expect(tools).toHaveAttribute('aria-hidden', 'false');
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
});

test('first idle needs no touch and an actionable touch stays stable until its click', async ({ page }) => {
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  const tools = page.locator('.mobile-lattice-tools');
  await expect(tools).toHaveAttribute('aria-hidden', 'true', { timeout: 6000 });
  const back = page.getByRole('button', { name: '返回音乐库', exact: true });
  const touch = { pointerId: 92, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
  await back.dispatchEvent('pointerdown', touch);
  await expect(tools).toHaveAttribute('aria-hidden', 'true');
  await back.dispatchEvent('pointerup', { ...touch, buttons: 0 });
  await back.dispatchEvent('mousemove', { buttons: 0 });
  await expect(tools).toHaveAttribute('aria-hidden', 'true');
  // A native tap must still activate the button on its first attempt after idle.
  await back.tap();
  await expect(page.locator('.mobile-lattice')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).fixtureStatusBarHidden)).toBe(false);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});
