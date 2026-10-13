import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { installLoginFixture, loginFixture, openLogin } from './login-fixture';

// login-intent.spec.ts — delayed capability discovery and cancellation must not replace the latest QR intent.
async function holdCancellation(page: Page, provider: string) {
  await page.evaluate(async provider => {
    const w = window as any;
    const runtime = await new Function('url', 'return import(url)')('/src/services/mobileRuntime.ts');
    w.loginProbe = runtime.getMobileRuntime().fetch(`/mobile/${provider}/user/playlist?pendingLoginProbe=1`)
      .then(() => 'accepted', (error: Error) => error.name);
    w.loginHoldNextCancel = true;
  }, provider);
}
async function drainCallbacks(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('QQ waits for declared login channels and rejects a stale unsupported selection', async ({ page }) => {
  await installLoginFixture(page);
  await page.addInitScript(() => {
    const w = window as any; w.loginChannelDelay = true; w.loginChannels = ['wechat'];
  });
  const dialog = await openLogin(page, 'qq');
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishLoginChannels)).toBe('function');
  await dialog.getByRole('combobox', { name: '扫码登录', exact: true }).selectOption('qq');
  await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await drainCallbacks(page);
  const early = await page.evaluate(() => (window as any).loginKeys);
  await page.evaluate(() => {
    const w = window as any; w.loginChannelDelay = false; w.finishLoginChannels();
  });
  await expect(dialog.getByRole('img')).toBeVisible();
  expect(early).toBe(0);
  expect(await page.evaluate(() => (window as any).loginKeysBeforeChannels)).toBe(0);
  expect(await page.evaluate(() => (window as any).loginKeyChannels)).toEqual(['wechat']);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('QQ preserves the latest method when an older cancellation finishes later', async ({ page }) => {
  const dialog = await loginFixture(page, 'qq');
  const method = dialog.getByRole('combobox', { name: '扫码登录', exact: true });
  await holdCancellation(page, 'qq');
  await method.selectOption('qq');
  await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishOldLoginCancel)).toBe('function');
  await method.selectOption('wechat');
  await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(dialog.getByRole('img')).toBeVisible();
  expect(await page.evaluate(() => (window as any).loginKeyChannels)).toEqual(['wechat']);
  await page.evaluate(() => (window as any).finishOldLoginCancel());
  await drainCallbacks(page);
  expect(await page.evaluate(() => (window as any).loginKeyChannels)).toEqual(['wechat']);
  await expect(method).toHaveValue('wechat');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(async () => { const w = window as any; w.finishLoginProbe(); return await w.loginProbe; })).toBe('AbortError');
});

for (const provider of ['qq', 'netease']) {
  test(`${provider} preparing a fresh QR hides the retired image and share action`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const dialog = await loginFixture(page, provider);
    const refresh = dialog.getByRole('button', { name: '重新生成二维码', exact: true });
    await refresh.tap(); await expect(dialog.getByRole('img')).toBeVisible();
    await holdCancellation(page, provider);
    await page.evaluate(() => {
      const w = window as any; w.loginHoldNextCancel = false; w.loginHoldAllCancels = true;
    });
    await refresh.tap();
    await expect.poll(() => page.evaluate(() => (window as any).loginCancelWaiters?.length ?? 0)).toBe(2);
    await expect(dialog.getByRole('img')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '分享二维码', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('status')).toHaveText('正在加载…');
    if (process.env.LOGIN_INTENT_SCREENSHOTS) await page.screenshot({ path: `/tmp/folia-login-intent-${provider}-${info.project.name}-preparing.png` });
    await page.evaluate(() => {
      const w = window as any; w.loginHoldAllCancels = false;
      for (const resolve of w.loginCancelWaiters) resolve();
    });
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '分享二维码', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).loginKeys)).toBe(2);
    expect(await page.evaluate(async () => { const w = window as any; w.finishLoginProbe(); return await w.loginProbe; })).toBe('AbortError');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test(`${provider} closing while cancellation is pending cannot start another QR`, async ({ page }) => {
    const dialog = await loginFixture(page, provider);
    await holdCancellation(page, provider);
    await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => typeof (window as any).finishOldLoginCancel)).toBe('function');
    await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
    await page.evaluate(() => (window as any).finishOldLoginCancel());
    await drainCallbacks(page);
    expect(await page.evaluate(() => (window as any).loginKeys)).toBe(0);
    expect(await page.evaluate(async () => { const w = window as any; w.finishLoginProbe(); return await w.loginProbe; })).toBe('AbortError');
    await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
    await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
    await expect(dialog.getByRole('img')).toBeVisible();
    expect(await page.evaluate(() => (window as any).loginKeys)).toBe(1);
  });
}

test('QQ legacy backends without a channels route still support explicit WeChat login', async ({ page }) => {
  await installLoginFixture(page);
  await page.addInitScript(() => { (window as any).loginLegacyChannels = true; });
  const dialog = await openLogin(page, 'qq');
  await dialog.getByRole('combobox', { name: '扫码登录', exact: true }).selectOption('wechat');
  await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(dialog.getByRole('img')).toBeVisible();
  expect(await page.evaluate(() => (window as any).loginKeyChannels)).toEqual(['wechat']);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
