import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// login-recovery.spec.ts — real mobile QR session and provider adapters with controlled bridge failures.
async function loginFixture(page: Page, provider: string) {
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
    w.loginKeys = 0; w.loginShares = 0; w.loginCancelFailures = 0; w.loginShareFailures = 0;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'cancelRequests' && w.loginCancelFailures > 0) {
        w.loginCancelFailures--; throw Error('cancel-bridge-failed');
      }
      if (method === 'shareQR') {
        w.loginShares++;
        if (w.loginShareDelay) await new Promise((_resolve, reject) => { w.failOldShare = () => reject(Error('old-share-failed')); });
        if (w.loginShareFailures > 0) { w.loginShareFailures--; throw Error('share-failed'); }
        return {};
      }
      if (method === 'request' && options.payload.path.includes('pendingLoginProbe=1')) {
        return await new Promise(resolve => { w.finishLoginProbe = () => resolve(reply({ code: 200 })); });
      }
      return bridge(plugin, method, options);
    };
    w.fixtureOnlineRequest = async (payload: any) => {
      const path = new URL(payload.path, 'https://fixture.invalid').pathname;
      if (path === '/login/channels') return reply({ code: 200, data: { channels: ['qq', 'wechat'] } });
      if (path === '/login/qr/key') {
        w.loginKeys++; return reply({ code: 200, data: { unikey: 'synthetic-qr-' + w.loginKeys } });
      }
      if (path === '/login/qr/check') return reply(w.loginConfirmed
        ? { code: 803, cookie: payload.provider === 'qq' ? 'qqmusic_session=synthetic-login' : 'synthetic-login' }
        : { code: 801 });
      if (path === '/login/status') return reply({ code: 200, data: { code: 200, profile: !w.loginConfirmed ? null :
        payload.provider === 'qq' ? { uin: '77', nick: '登录恢复账号' } : { userId: 9, nickname: '登录恢复账号' } } });
      if (path === '/user/account') return reply({ code: 200, profile: w.loginConfirmed ? { userId: 9, nickname: '登录恢复账号' } : null });
      if (path === '/user/playlist') return reply({ code: 200, playlist: [], more: false });
      return undefined; // QR image and other native methods use the shared fixture.
    };
  });
  await page.goto('/mobile.html');
  await expect(page).toHaveTitle('Folia');
  await page.getByRole('button', { name: provider === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  return page.getByRole('dialog', { name: '扫码登录', exact: true });
}

for (const provider of ['qq', 'netease']) {
  test(`${provider} QR retry clears a cancellation error and still confirms login`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const dialog = await loginFixture(page, provider);
    await page.evaluate(async provider => {
      const w = window as any;
      const runtime = await new Function('url', 'return import(url)')('/src/services/mobileRuntime.ts');
      w.loginProbe = runtime.getMobileRuntime().fetch(`/mobile/${provider}/user/playlist?pendingLoginProbe=1`)
        .then(() => 'accepted', (error: Error) => error.name);
      w.loginCancelFailures = 1;
    }, provider);
    await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(async () => { const w = window as any; w.finishLoginProbe(); return await w.loginProbe; })).toBe('AbortError');
    await page.evaluate(() => { (window as any).loginConfirmed = true; document.dispatchEvent(new Event('visibilitychange')); });
    await expect(dialog.getByText('已登录', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
    await expect(page.getByText('登录恢复账号', { exact: true })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${provider} retrying QR sharing removes its previous failure`, async ({ page }, info) => {
    const dialog = await loginFixture(page, provider);
    await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
    await expect(dialog.getByRole('img')).toBeVisible();
    await page.evaluate(() => { (window as any).loginShareFailures = 1; });
    const share = dialog.getByRole('button', { name: '分享二维码', exact: true });
    await share.tap(); await expect(dialog.getByRole('alert')).toBeVisible();
    if (process.env.LOGIN_RECOVERY_SCREENSHOTS) await page.screenshot({ path: `/tmp/folia-login-recovery-${provider}-${info.project.name}-failed.png` });
    await share.tap();
    await expect.poll(() => page.evaluate(() => (window as any).loginShares)).toBe(2);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('img')).toBeVisible();
    if (process.env.LOGIN_RECOVERY_SCREENSHOTS) await page.screenshot({ path: `/tmp/folia-login-recovery-${provider}-${info.project.name}-recovered.png` });
  });

  test(`${provider} an old share failure cannot mark a regenerated QR as failed`, async ({ page }) => {
    const dialog = await loginFixture(page, provider);
    const refresh = dialog.getByRole('button', { name: '重新生成二维码', exact: true });
    await refresh.tap(); await expect(dialog.getByRole('img')).toBeVisible();
    await page.evaluate(() => { (window as any).loginShareDelay = true; });
    await dialog.getByRole('button', { name: '分享二维码', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => typeof (window as any).failOldShare)).toBe('function');
    await refresh.tap();
    await expect.poll(() => page.evaluate(() => (window as any).loginKeys)).toBe(2);
    await expect(dialog.getByRole('img')).toBeVisible();
    await page.evaluate(() => (window as any).failOldShare());
    // Drain the rejected bridge promise and React's update before observing the new QR.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });
}
