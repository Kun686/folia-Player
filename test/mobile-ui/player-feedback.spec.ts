import type { Page } from '@playwright/test';
import { test, expect, revealPlayerControls } from './fixtures';
import { searchPlaybackFixture } from './search-playback-fixture';

// player-feedback.spec.ts — real player UI over controlled command failures; no native audio claim.
async function start(page: Page, provider: 'qq' | 'netease', language = 'zh-CN') {
  await searchPlaybackFixture(page);
  await page.addInitScript(language => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    localStorage.setItem('folia_app_language', language);
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'command') {
        if (w.feedbackDelay === options.action) {
          w.feedbackDelay = null;
          await new Promise<void>((_resolve, reject) => { w.feedbackReject = () => reject(new Error('old-command-failed')); });
        }
        if (w.feedbackFailure === options.action) throw new Error('command-failed');
      }
      return bridge(plugin, method, options);
    };
  }, language);
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: provider === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
  const search = language === 'en' ? 'Search songs' : language === 'in' ? 'Cari lagu' : '搜索歌曲';
  const play = language === 'en' ? 'Play' : language === 'in' ? 'Putar' : '播放';
  await page.getByRole('textbox', { name: search }).fill('歌曲');
  await page.getByRole('button', { name: search, exact: true }).tap();
  await page.getByRole('button', { name: `${play} ${provider === 'qq' ? 'QQ' : ''}搜索歌曲100`, exact: true }).tap();
  await expect(page.locator('.player-panel')).toHaveClass(/expanded/);
  await expect(page.locator('.player-panel').getByRole('alert')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/mobile.html');
  await expect(page).toHaveTitle(/Folia/i);
}

for (const [language, expected] of [['zh-CN', '请返回音乐库重新登录后播放'], ['en', 'Return to the library'], ['in', 'Kembali ke pustaka']]) {
  test(`${language}: translated playback feedback fits portrait and landscape without blocking transport`, async ({ page }, info) => {
    const errors: string[] = [], warnings: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) warnings.push(message.text()); });
    await start(page, 'qq', language);
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: 'auth-required', playing: false }));
    const original = page.viewportSize()!;
    for (const viewport of [original, { width: original.height, height: original.width }]) {
      await page.setViewportSize(viewport);
      const feedback = page.locator('.player-error');
      await expect(feedback).toContainText(expected);
      expect(await feedback.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const bounds = (await feedback.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      const transport = page.locator('.primary-play');
      expect(await transport.evaluate(node => {
        const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
    }
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(warnings.filter(message => !message.startsWith('DecompressionStream warning (ignored):'))).toEqual([]);
    await page.screenshot({ path: info.outputPath('feedback-translated.png') });
  });
}

for (const provider of ['qq', 'netease'] as const) {
  test(`${provider}: clears a rejected playback command after successful retry and restores chrome hiding`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await start(page, provider);
    const panel = page.locator('.player-panel');
    await page.evaluate(() => { (window as any).feedbackFailure = 'pause'; });
    await panel.getByRole('button', { name: '暂停', exact: true }).tap();
    await expect(panel.getByRole('alert')).toBeVisible();
    await page.evaluate(() => { (window as any).feedbackFailure = null; });
    await panel.getByRole('button', { name: '暂停', exact: true }).tap();
    await expect(panel.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await panel.getByRole('button', { name: '播放', exact: true }).tap();
    await page.locator('.lyric-stage').tap({ position: { x: 12, y: 200 } });
    await expect(panel).toHaveAttribute('data-controls-hidden', 'true');
    await revealPlayerControls(page);
    expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('command-recovered.png') });
  });

  test(`${provider}: a delayed command failure cannot override a newer successful action`, async ({ page }) => {
    await start(page, provider);
    const panel = page.locator('.player-panel');
    await page.evaluate(() => { (window as any).feedbackDelay = 'pause'; });
    await panel.getByRole('button', { name: '暂停', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => typeof (window as any).feedbackReject)).toBe('function');
    await panel.getByRole('button', { name: '暂停', exact: true }).tap();
    await expect(panel.getByRole('button', { name: '播放', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      (window as any).feedbackReject();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(panel.getByRole('alert')).toHaveCount(0);
    // A subsequent, current failure must still be visible.
    await page.evaluate(() => { (window as any).feedbackFailure = 'play'; });
    await panel.getByRole('button', { name: '播放', exact: true }).tap();
    await expect(panel.getByRole('alert')).toHaveText('操作未成功，请再试一次。');
  });

  test(`${provider}: switching away and back discards feedback from an older song occurrence`, async ({ page }) => {
    await start(page, provider);
    const panel = page.locator('.player-panel');
    await page.evaluate(() => { (window as any).feedbackDelay = 'pause'; });
    await panel.getByRole('button', { name: '暂停', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => typeof (window as any).feedbackReject)).toBe('function');
    const original = await page.evaluate(() => (window as any).fixturePlayback.currentSong);
    await page.evaluate(() => {
      const w = window as any, current = w.fixturePlayback.currentSong;
      w.fixtureEmitPlayback({ currentSong: { ...current, name: '远程切换歌曲', sourceRef: { ...current.sourceRef,
        providerId: current.sourceRef.providerId === 'qq' ? 'netease' : 'qq', mediaId: '100' } } });
    });
    await expect(panel.locator('.track-heading h2')).toHaveText('远程切换歌曲');
    await page.evaluate(currentSong => (window as any).fixtureEmitPlayback({ currentSong }), original);
    await expect(panel.locator('.track-heading h2')).toHaveText(original.name);
    await page.evaluate(async () => {
      (window as any).feedbackReject();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });

  test(`${provider}: native playback errors explain recovery and survive successful UI commands`, async ({ page }, info) => {
    await start(page, provider);
    const panel = page.locator('.player-panel');
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: 'auth-required', playing: false }));
    await expect(panel.getByRole('alert')).toContainText(provider === 'qq' ? 'QQ' : '网易云');
    await expect(panel.getByRole('alert')).toContainText('请返回音乐库重新登录后播放');
    await expect(panel.getByRole('alert')).not.toContainText('auth-required');
    await page.screenshot({ path: info.outputPath('sign-in-expired.png') });
    for (const [code, message] of [
      ['gateway-auth-required', '请在设置中检查访问凭据'], ['network', '请检查网络后重试播放'],
      ['network-timeout', '请检查网络后重试播放'], ['rate-limited', '请稍后重试播放'],
      ['unavailable', '这首歌暂时无法播放'], ['audio-failed', '音频播放失败'],
      ['audio-session', '无法启用音频输出'], ['state-unavailable', '无法读取播放状态'],
      ['unrecognized-private-detail', '播放遇到问题'], ['toString', '播放遇到问题'],
    ]) {
      await page.evaluate(error => (window as any).fixtureEmitPlayback({ error }), code);
      await expect(panel.getByRole('alert')).toContainText(message);
      await expect(panel.getByRole('alert')).not.toContainText(code);
    }
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: 'network' }));
    await panel.getByRole('button', { name: '播放', exact: true }).tap();
    await expect(panel.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
    await expect(panel.getByRole('alert')).toContainText('请检查网络后重试播放');
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ error: undefined }));
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
}
