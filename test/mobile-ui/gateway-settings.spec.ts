import { test, expect } from './fixtures';

// gateway-settings.spec.ts — a rejected save must not log out existing platform accounts.
test('failed gateway save preserves every platform session', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any, original = w.Capacitor.nativePromise;
    w.fixtureClearedSessions = [];
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'configure') throw new Error('secure-storage');
      if (method === 'clearSession') w.fixtureClearedSessions.push(options.provider);
      return original(plugin, method, options);
    };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '扫码登录' }).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '服务器与外观', exact: true }).click();
  await page.locator('input[type=url]').fill('https://replacement.example');
  await page.locator('input[type=password]').fill('generated-fixture-token-0000000000000000');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureClearedSessions)).toEqual([]);
  await page.getByRole('dialog', { name: '服务器与外观' }).getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.getByText('测试用户', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
});

for (const changedOrigin of [true, false]) test(`successful gateway save reloads authoritative state (changed origin: ${changedOrigin})`, async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any, original = w.Capacitor.nativePromise;
    // Only generated test values are stored here to model native persistence across WebView reload.
    const state = JSON.parse(sessionStorage.getItem('fixture-gateway') || 'null') ?? {
      server: 'https://fixture.invalid', scope: 'fixture-scope', sessions: { qq: { cookie: 'synthetic' } },
    };
    sessionStorage.setItem('fixture-gateway-boots', String(Number(sessionStorage.getItem('fixture-gateway-boots') || 0) + 1));
    w.fixtureGatewayState = state;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'bootstrap') return state;
      if (method === 'configure') {
        if (options.scope !== state.scope) throw new Error('gateway-settings-changed');
        const next = { server: options.server, scope: 'next', sessions: options.server === state.server ? state.sessions : {} };
        sessionStorage.setItem('fixture-gateway', JSON.stringify(next)); return next;
      }
      return original(plugin, method, options);
    };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  const server = changedOrigin ? 'https://replacement.example' : 'https://fixture.invalid';
  await page.locator('input[type=url]').fill(server);
  await page.locator('input[type=password]').fill('generated-fixture-token-0000000000000000');
  await page.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('fixture-gateway-boots'))).toBe('2');
  await expect(page.locator('.mobile-app')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureGatewayState)).toEqual({ server, scope: 'next', sessions: changedOrigin ? {} : { qq: { cookie: 'synthetic' } } });
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await expect(page.locator('input[type=url]')).toHaveValue(server);
  await expect(page.locator('input[type=password]')).toHaveValue('');
});
