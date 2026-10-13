import type { Page } from '@playwright/test';
import { test, expect, revealPlayerControls } from './fixtures';
import { startFeedbackPlayback } from './player-feedback-fixture';

// mini-player-feedback.spec.ts — both transport surfaces share one command intent and error lifecycle.
type Surface = 'mini' | 'expanded';
const controls = (page: Page, surface: Surface) => page.locator(surface === 'mini' ? '.mini-player' : '.player-panel');
const feedback = (page: Page, surface: Surface) => page.locator(surface === 'mini' ? '.library-panel' : '.player-panel').getByRole('alert');
async function show(page: Page, surface: Surface) {
  const expanded = await page.locator('.player-panel').evaluate(node => node.classList.contains('expanded'));
  if (surface === 'mini' && expanded) {
    await revealPlayerControls(page);
    await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  } else if (surface === 'expanded' && !expanded) await page.locator('.mini-title').tap();
  if (surface === 'expanded') await revealPlayerControls(page);
}

for (const provider of ['qq', 'netease'] as const) {
  test(`${provider}: either player surface can retry a failure from the other surface`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await startFeedbackPlayback(page, provider);
    for (const origin of ['mini', 'expanded'] as const) {
      const destination = origin === 'mini' ? 'expanded' : 'mini';
      await page.evaluate(() => { (window as any).fixtureEmitPlayback({ playing: true }); (window as any).feedbackFailure = 'pause'; });
      await show(page, origin);
      await controls(page, origin).getByRole('button', { name: '暂停', exact: true }).tap();
      await expect(feedback(page, origin)).toHaveText('操作未成功，请再试一次。');
      await show(page, destination);
      await expect(feedback(page, destination)).toHaveText('操作未成功，请再试一次。');
      if (destination === 'mini') await page.screenshot({ path: info.outputPath('mini-command-error.png') });
      await page.evaluate(() => { (window as any).feedbackFailure = null; });
      await controls(page, destination).getByRole('button', { name: '暂停', exact: true }).tap();
      await expect(controls(page, destination).getByRole('button', { name: '播放', exact: true })).toBeVisible();
      await expect(feedback(page, destination)).toHaveCount(0);
      await show(page, origin); await expect(feedback(page, origin)).toHaveCount(0);
    }
    await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  });

  test(`${provider}: a late failure cannot replace a newer command from the other surface`, async ({ page }) => {
    await startFeedbackPlayback(page, provider);
    for (const origin of ['mini', 'expanded'] as const) {
      const destination = origin === 'mini' ? 'expanded' : 'mini';
      await page.evaluate(() => {
        (window as any).fixtureEmitPlayback({ playing: true });
        (window as any).feedbackReject = null; (window as any).feedbackDelay = 'pause';
      });
      await show(page, origin);
      await controls(page, origin).getByRole('button', { name: '暂停', exact: true }).tap();
      await expect.poll(() => page.evaluate(() => typeof (window as any).feedbackReject)).toBe('function');
      await show(page, destination);
      await controls(page, destination).getByRole('button', { name: '暂停', exact: true }).tap();
      await expect(controls(page, destination).getByRole('button', { name: '播放', exact: true })).toBeVisible();
      await page.evaluate(async () => {
        (window as any).feedbackReject();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await expect(feedback(page, destination)).toHaveCount(0);
      await show(page, origin); await expect(feedback(page, origin)).toHaveCount(0);
    }
  });

  test(`${provider}: mini player ignores an old song occurrence and preserves current native errors`, async ({ page }, info) => {
    await startFeedbackPlayback(page, provider); await show(page, 'mini');
    await page.evaluate(() => { (window as any).feedbackDelay = 'pause'; });
    await controls(page, 'mini').getByRole('button', { name: '暂停', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => typeof (window as any).feedbackReject)).toBe('function');
    const original = await page.evaluate(() => (window as any).fixturePlayback.currentSong);
    await page.evaluate(() => {
      const w = window as any, song = w.fixturePlayback.currentSong;
      w.fixtureEmitPlayback({ currentSong: { ...song, name: '另一首歌曲', sourceRef: { ...song.sourceRef, mediaId: 'other' } } });
    });
    await expect(page.locator('.mini-title strong')).toHaveText('另一首歌曲');
    await page.evaluate(currentSong => (window as any).fixtureEmitPlayback({ currentSong }), original);
    await expect(page.locator('.mini-title strong')).toHaveText(original.name);
    await page.evaluate(async () => {
      (window as any).feedbackReject();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(feedback(page, 'mini')).toHaveCount(0);
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: 'auth-required', playing: false }));
    await expect(feedback(page, 'mini')).toContainText(provider === 'qq' ? 'QQ' : '网易云');
    await expect(feedback(page, 'mini')).toContainText('请返回音乐库重新登录后播放');
    await page.screenshot({ path: info.outputPath('mini-login-expired.png') });
    await controls(page, 'mini').getByRole('button', { name: '播放', exact: true }).tap();
    await expect(controls(page, 'mini').getByRole('button', { name: '暂停', exact: true })).toBeVisible();
    await expect(feedback(page, 'mini')).toContainText('请返回音乐库重新登录后播放');
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: undefined }));
    await expect(feedback(page, 'mini')).toHaveCount(0);
  });
}
