import { test, expect } from './fixtures';
import { accountLibraryFixture } from './account-library-fixture';

// logout-cancellation.spec.ts — real catalog/runtime logout over a failing native cancellation fixture, not Keychain proof.
for (const provider of ['qq', 'netease'] as const)
for (const cancelFails of [false, true]) {
  test(`${provider} logout clears its session despite late requests (cancellation failure: ${cancelFails})`, async ({ page }) => {
    await accountLibraryFixture(page);
    await page.addInitScript(({ cancelFails }) => {
      const w = window as any, bridge = w.Capacitor.nativePromise, request = w.fixtureOnlineRequest;
      const sessions = JSON.parse(sessionStorage.getItem('logout-sessions') || 'null') ?? structuredClone(w.fixtureSessions);
      const persist = () => sessionStorage.setItem('logout-sessions', JSON.stringify(sessions));
      const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
      w.logoutCancellationFails = cancelFails; w.logoutClears = []; w.logoutCancels = 0;
      w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
        if (method === 'bootstrap') return { server: 'https://fixture.invalid', scope: 'fixture-scope', sessions: structuredClone(sessions) };
        if (method === 'saveSession') { sessions[options.provider] = options.values; persist(); return {}; }
        if (method === 'clearSession') { w.logoutClears.push(options.provider); delete sessions[options.provider]; persist(); return {}; }
        if (method === 'cancelRequests') {
          w.logoutCancels++;
          if (w.logoutCancellationFails) throw Error('cancel-bridge-failed');
          return {}; // A response may already be queued even when native cancellation succeeds.
        }
        if (method === 'request' && options.payload.path.includes('pendingLogoutProbe=1')) {
          return new Promise(resolve => { w.finishLogoutRequest = () => resolve(reply({ code: 200, playlist: [] })); });
        }
        return bridge(plugin, method, options);
      };
      w.fixtureOnlineRequest = async (payload: any) => {
        const path = new URL(payload.path, 'https://fixture.invalid').pathname;
        const loggedIn = !!sessions[payload.provider]?.cookie;
        if (path === '/login/status') return reply(payload.provider === 'qq'
          ? { code: 0, data: { profile: loggedIn ? { uin: '77', nick: 'QQ fixture' } : null } }
          : { code: 200, data: { code: 200, profile: loggedIn ? { userId: 9, nickname: '测试用户' } : null } });
        if (path === '/user/account') return reply({ code: 200, profile: loggedIn ? { userId: 9, nickname: '测试用户' } : null });
        return request(payload);
      };
    }, { cancelFails });
    await page.goto('/mobile.html');
    const platform = provider === 'qq' ? 'QQ 音乐' : '网易云';
    await page.getByRole('button', { name: platform, exact: true }).tap();
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
    await page.evaluate(async provider => {
      const w = window as any;
      const module = await new Function('url', 'return import(url)')('/src/services/mobileRuntime.ts');
      w.logoutPending = module.getMobileRuntime().fetch(`/mobile/${provider}/user/playlist?pendingLogoutProbe=1`)
        .then(() => 'accepted', (error: Error) => error.name);
    }, provider);
    await expect.poll(() => page.evaluate(() => typeof (window as any).finishLogoutRequest)).toBe('function');
    await page.getByRole('button', { name: '退出登录', exact: true }).tap();
    await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).logoutClears)).toEqual([provider]);
    const retry = page.getByRole('button', { name: '重试 · 退出登录', exact: true });
    if (cancelFails) await expect(retry).toBeVisible(); else await expect(retry).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const w = window as any; w.finishLogoutRequest(); return await w.logoutPending;
    })).toBe('AbortError');
    if (cancelFails) { await retry.tap(); await expect(retry).toHaveCount(0); }
    const other = provider === 'qq' ? 'netease' : 'qq';
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('logout-sessions')!));
    expect(stored[provider]).toBeUndefined(); expect(stored[other]?.cookie).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: platform, exact: true }).tap();
    await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: other === 'qq' ? 'QQ 音乐' : '网易云', exact: true }).tap();
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  });
}
