import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// login-fixture.ts — shared QR transport shapes; real session, Omni and provider logic remain active.
export async function installLoginFixture(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
    w.loginKeys = 0; w.loginShares = 0; w.loginCancelFailures = 0; w.loginShareFailures = 0;
    w.loginKeyChannels = []; w.loginKeysBeforeChannels = 0;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'cancelRequests' && w.loginHoldAllCancels) {
        await new Promise(resolve => { (w.loginCancelWaiters ??= []).push(resolve); });
      }
      if (method === 'cancelRequests' && w.loginHoldNextCancel) {
        w.loginHoldNextCancel = false;
        await new Promise(resolve => { w.finishOldLoginCancel = resolve; });
      }
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
      const url = new URL(payload.path, 'https://fixture.invalid'), path = url.pathname;
      if (path === '/login/channels') {
        if (w.loginChannelDelay) await new Promise(resolve => { w.finishLoginChannels = resolve; });
        if (w.loginLegacyChannels) return { status: 404, headers: {}, body: '{}' };
        w.loginChannelsReady = true;
        return reply({ code: 200, data: { channels: w.loginChannels ?? ['qq', 'wechat'] } });
      }
      if (path === '/login/qr/key') {
        if (payload.provider === 'qq' && !w.loginChannelsReady) w.loginKeysBeforeChannels++;
        w.loginKeyChannels.push(url.searchParams.get('channel'));
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
}

export async function openLogin(page: Page, provider: string) {
  await page.goto('/mobile.html');
  await expect(page).toHaveTitle('Folia');
  await page.getByRole('button', { name: provider === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  return page.getByRole('dialog', { name: '扫码登录', exact: true });
}

export async function loginFixture(page: Page, provider: string) {
  await installLoginFixture(page); return openLogin(page, provider);
}
