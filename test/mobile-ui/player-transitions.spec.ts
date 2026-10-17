import { test, expect } from './fixtures';
import { seed, queue } from './playerQueueFixture';
import type { Page } from '@playwright/test';

// player-transitions.spec.ts — WebKit gestures/rendering with real QQ metadata and a controlled bridge.
const host = (page: Page) => page.locator('.player-queue-host');
const surface = (page: Page) => page.locator('.player-queue-sheet');
async function openQueue(page: Page) {
  await page.locator('.brand').getByRole('button', { name: '队列拼贴', exact: true }).tap();
  await page.locator('.mobile-lattice-tools').getByRole('button', { name: '播放队列', exact: true }).tap();
  await expect(host(page)).toBeVisible();
}
async function settled(page: Page, anchor: 'full' | 'middle') {
  await expect.poll(() => surface(page).evaluate((el, snap) => {
    const h = (el as HTMLElement).offsetHeight;
    const target = snap === 'full' || h < 460 ? 0 : h * .42;
    return Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 - target);
  }, anchor)).toBeLessThan(1);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/mobile.html'); await seed(page);
  await page.evaluate(() => {
    const w = window as any; w.queueInputEvidence = [];
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      window.addEventListener(name, event => {
        const e = event as PointerEvent, sheet = document.querySelector('.player-queue-sheet');
        if (!sheet || w.queueInputEvidence.length >= 100) return;
        w.queueInputEvidence.push({ type: name, pointer: e.pointerType, x: e.clientX, y: e.clientY,
          target: (e.target as Element).className, time: performance.now(), buttons: e.buttons,
          transform: (sheet as HTMLElement).style.transform });
      }, true);
    }
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('queue-input.json', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => ({
    events: (window as any).queueInputEvidence,
    grab: document.querySelector('.queue-grab')?.getBoundingClientRect().toJSON(),
    viewport: { width: innerWidth, height: innerHeight },
  }))) });
});

async function dragWithFrames(page: Page, x: number, from: number, to: number) {
  await page.mouse.move(x, from); await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x, from + (to - from) * step / 10);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
}

test('queue stays over the player, searches and selects without replacing the queue', async ({ page }, info) => {
  await openQueue(page); await settled(page, 'middle');
  await expect(page.locator('.player-panel')).toHaveAttribute('data-expanded', 'true');
  expect(await page.evaluate(() => (window as any).fixtureStatusBarHidden)).toBe(true);
  const first = await host(page).getByRole('button', { name: '播放 我不难过', exact: true }).boundingBox();
  expect(first!.y + first!.height).toBeLessThan(page.viewportSize()!.height);
  await page.screenshot({ path: info.outputPath('queue-middle.png') });
  await host(page).getByRole('textbox').fill('我怀念的'); await settled(page, 'full');
  await host(page).getByRole('button', { name: '播放 我怀念的', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.currentSong.id)).toBe(queue[1].id);
  expect(await page.evaluate(() => (window as any).fixtureQueueOperations)).toEqual(['selectQueue']);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.id))).toEqual(queue.map(s => s.id));
  await host(page).locator('header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('.mobile-lattice')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureStatusBarHidden)).toBe(true);
});

test('sheet tracks drag, resists overscroll, snaps and survives rotation', async ({ page }, info) => {
  await openQueue(page); await settled(page, 'middle');
  const grab = host(page).locator('.queue-grab');
  const box = (await grab.boundingBox())!;
  await dragWithFrames(page, box.x + box.width / 2, box.y + 22, 5);
  // Motion samples pointer movement on its animation frame; keep the pointer held until it is rendered.
  await expect.poll(() => surface(page).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeLessThan(1);
  const offset = await surface(page).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
  expect(offset).toBeLessThan(1); expect(offset).toBeGreaterThan(-100);
  await page.mouse.up(); await settled(page, 'full');
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width }); await settled(page, 'full');
  const row = await host(page).getByRole('button', { name: '播放 我不难过', exact: true }).boundingBox();
  expect(row!.y + row!.height).toBeLessThan(size.width);
  await page.screenshot({ path: info.outputPath('queue-rotated.png') });
  await page.setViewportSize(size); await settled(page, 'full');
  await grab.focus(); await page.keyboard.press('ArrowDown'); await settled(page, 'middle');
  const middle = (await grab.boundingBox())!;
  await dragWithFrames(page, middle.x + middle.width / 2, middle.y + 22, size.height - 5);
  await expect.poll(() => surface(page).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 / (el as HTMLElement).offsetHeight)).toBeGreaterThan(.85);
  await page.mouse.up();
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('.mobile-lattice')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('circular opening and closing share the mini cover origin and allow reversal', async ({ page }) => {
  const panel = page.locator('.player-panel');
  const cover = (await page.locator('.mini-title .song-art').boundingBox())!;
  await page.locator('.mini-title').tap();
  await expect(panel).toHaveAttribute('data-expanded', 'true');
  const clip = await panel.evaluate(el => getComputedStyle(el).clipPath);
  expect(clip).toMatch(/^circle\(/);
  const coords = clip.match(/at ([\d.]+)px ([\d.]+)px/)!;
  expect(Number(coords[1])).toBeCloseTo(cover.x + cover.width / 2, 0);
  expect(Number(coords[2])).toBeCloseTo(cover.y + cover.height / 2, 0);
  await page.locator('.player-collapse').tap();
  await expect(panel).toHaveAttribute('data-expanded', 'false');
  // The closing scene remains mounted; reversing uses its current radius, not a fresh full circle.
  await expect(panel).toHaveClass(/expanded/);
  await page.locator('.mini-title').tap();
  await expect(panel).toHaveAttribute('data-expanded', 'true');
  await page.locator('.player-collapse').tap();
  await expect(panel).not.toHaveClass(/expanded/);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('reduced motion avoids the circular sweep and sheet overshoot', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('reduce_motion_follow_system', 'true'));
  await page.reload(); await seed(page);
  await page.locator('.mini-title').tap();
  await expect(page.locator('.player-panel')).toHaveCSS('clip-path', 'none');
  await page.locator('.player-controls').getByRole('button', { name: '播放队列', exact: true }).tap();
  await settled(page, 'middle');
  await page.keyboard.press('Escape');
  await expect(host(page)).toHaveCount(0);
  await expect(page.locator('.player-panel')).toHaveAttribute('data-expanded', 'true');
});
