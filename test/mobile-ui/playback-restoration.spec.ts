import type { Page } from '@playwright/test';
import { test, expect, revealPlayerControls } from './fixtures';
import { startFeedbackPlayback } from './player-feedback-fixture';

// playback-restoration.spec.ts — foreground reads race with actual playback listener deliveries.
async function start(page: Page, provider: 'qq' | 'netease') {
  await startFeedbackPlayback(page, provider);
  await page.evaluate(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    w.restorePending = []; w.restoreDeferred = true; w.restoreHidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.restoreHidden });
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: unknown) => {
      const value = await bridge(plugin, method, options);
      if (method !== 'getState' || !w.restoreDeferred) return value;
      return new Promise((resolve, reject) => w.restorePending.push({
        resolve: () => resolve(structuredClone(value)), reject: () => reject(new Error('state-read-failed')),
      }));
    };
  });
}
async function visibility(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    (window as any).restoreHidden = hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
async function foregroundRead(page: Page, count = 1) {
  await visibility(page, true); await visibility(page, false);
  await expect.poll(() => page.evaluate(() => (window as any).restorePending.length)).toBe(count);
}
async function finish(page: Page, index: number, result: 'resolve' | 'reject') {
  await page.evaluate(async ({ index, result }) => {
    (window as any).restorePending[index][result]();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { index, result });
}

for (const provider of ['qq', 'netease'] as const) {
  test(`${provider}: a late failed foreground read cannot replace newer playback feedback`, async ({ page }) => {
    await start(page, provider); await foregroundRead(page);
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 42, error: '' }));
    await revealPlayerControls(page);
    await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toHaveValue('42');
    await finish(page, 0, 'reject');
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toHaveValue('42');
  });

  test(`${provider}: a late failed foreground read preserves the current native login error`, async ({ page }) => {
    await start(page, provider); await foregroundRead(page);
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, error: 'auth-required' }));
    await expect(page.locator('.player-panel').getByRole('alert')).toContainText('登录已失效');
    await finish(page, 0, 'reject');
    await expect(page.locator('.player-panel').getByRole('alert')).toContainText('登录已失效');
  });

  test(`${provider}: a newer foreground read supersedes an old failure even at the same native revision`, async ({ page }) => {
    await start(page, provider); await foregroundRead(page);
    await foregroundRead(page, 2); await finish(page, 1, 'resolve');
    await finish(page, 0, 'reject');
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
  });

  test(`${provider}: the current read failure is visible and a successful foreground read clears it`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page, provider); await foregroundRead(page); await finish(page, 0, 'reject');
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveText('无法读取播放状态，请稍后重试。');
    await revealPlayerControls(page);
    await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
    await expect(page.locator('.library-panel').getByRole('alert')).toHaveText('无法读取播放状态，请稍后重试。');
    await page.screenshot({ path: info.outputPath('state-read-failed.png') });
    await foregroundRead(page, 2); await finish(page, 1, 'resolve');
    await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
    await page.locator('.mini-title').tap();
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  });

  test(`${provider}: returning to the background invalidates a pending read failure`, async ({ page }) => {
    await start(page, provider); await foregroundRead(page); await visibility(page, true);
    await finish(page, 0, 'reject');
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
    await visibility(page, false);
    await expect.poll(() => page.evaluate(() => (window as any).restorePending.length)).toBe(2);
    await finish(page, 1, 'resolve');
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
  });

  test(`${provider}: an older successful read cannot rewind the newer foreground position`, async ({ page }) => {
    await start(page, provider);
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 12 }));
    await foregroundRead(page);
    // Native snapshot reads within one publish interval can share a revision but differ in position.
    await page.evaluate(() => { (window as any).fixturePlayback.position = 48; });
    await foregroundRead(page, 2); await finish(page, 1, 'resolve');
    await revealPlayerControls(page);
    await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toHaveValue('48');
    await finish(page, 0, 'resolve');
    await expect(page.getByRole('slider', { name: '播放进度', exact: true })).toHaveValue('48');
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
  });

  test(`${provider}: a read failure cannot hide an already known native error`, async ({ page }) => {
    await start(page, provider);
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, error: 'auth-required' }));
    await expect(page.locator('.player-panel').getByRole('alert')).toContainText('登录已失效');
    await foregroundRead(page); await finish(page, 0, 'reject');
    await expect(page.locator('.player-panel').getByRole('alert')).toContainText('登录已失效');
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: '' }));
    await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
  });
}
