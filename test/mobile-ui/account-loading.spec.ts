import { test, expect } from './fixtures';
import { accountLibraryFixture } from './account-library-fixture';

// account-loading.spec.ts — delayed/error account transport through Omni; empty queue, no real account acceptance.
test.beforeEach(async ({ page }) => {
  await accountLibraryFixture(page);
  await page.addInitScript(() => {
    const w = window as any, previous = w.fixtureOnlineRequest;
    w.accountChecks = [];
    w.accountMode = {};
    w.releaseAccount = {};
    w.accountRows = [];
    new MutationObserver(() => {
      const row = document.querySelector('.account-row');
      if (row) w.accountRows.push(row.textContent);
    }).observe(document, { childList: true, subtree: true, characterData: true });
    w.fixtureOnlineRequest = async (payload: any) => {
      const path = new URL(payload.path, 'https://fixture.invalid').pathname;
      if (path === '/login/status') {
        w.accountChecks.push(payload.provider);
        if (w.accountMode[payload.provider] === 'pending') {
          await new Promise<void>(resolve => { w.releaseAccount[payload.provider] = resolve; });
        }
        if (w.accountMode[payload.provider] === 'error') throw Error('account-read-offline');
      }
      if (path === '/user/playlist' && w.delayAccountPlaylists) {
        await new Promise<void>(resolve => { w.releaseAccountPlaylists = resolve; });
      }
      return previous(payload);
    };
  });
});

for (const [provider, label, nickname] of [['netease', '网易云', '测试用户'], ['qq', 'QQ 音乐', 'QQ fixture']] as const) {
  test(`${provider} never offers login while account is pending, including switching back`, async ({ page }, info) => {
    await page.addInitScript(provider => { (window as any).accountMode[provider] = 'pending'; }, provider);
    await page.goto('/mobile.html');
    if (provider === 'qq') await page.getByRole('button', { name: label, exact: true }).tap();
    const row = page.locator('.account-row');
    await expect.poll(() => page.evaluate(provider => typeof (window as any).releaseAccount[provider], provider)).toBe('function');
    await expect(row.getByRole('button', { name: '正在加载…', exact: true })).toBeDisabled();
    await expect(row.getByRole('button', { name: '扫码登录', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${provider}-pending.png`) });
    expect(await page.evaluate(() => (window as any).accountRows.some((text: string) => text.includes('扫码登录')))).toBe(false);
    await page.evaluate(provider => { const w = window as any; w.accountMode[provider] = 'ready'; w.releaseAccount[provider](); }, provider);
    await expect(row).toContainText(nickname);
    await expect(row.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: provider === 'qq' ? '网易云' : 'QQ 音乐', exact: true }).tap();
    await expect(row.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
    await page.evaluate(provider => { const w = window as any; w.accountMode[provider] = 'pending'; delete w.releaseAccount[provider]; w.accountRows = []; }, provider);
    await page.getByRole('button', { name: label, exact: true }).tap();
    await expect.poll(() => page.evaluate(provider => typeof (window as any).releaseAccount[provider], provider)).toBe('function');
    await expect(row.getByRole('button', { name: '扫码登录', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).accountRows.some((text: string) => text.includes('扫码登录')))).toBe(false);
    await page.evaluate(provider => { const w = window as any; w.accountMode[provider] = 'ready'; w.releaseAccount[provider](); }, provider);
    await expect(row).toContainText(nickname);
    expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
  });

  test(`${provider} failed status offers retry and only confirmed anonymous state offers login`, async ({ page }) => {
    await page.addInitScript(provider => { (window as any).accountMode[provider] = 'error'; }, provider);
    await page.goto('/mobile.html');
    if (provider === 'qq') await page.getByRole('button', { name: label, exact: true }).tap();
    const row = page.locator('.account-row');
    await expect(row.getByRole('button', { name: '重试', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '扫码登录', exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toBeVisible();
    await page.evaluate(provider => { const w = window as any; w.accountMode[provider] = 'ready'; w.accountSignedOut = true; }, provider);
    await row.getByRole('button', { name: '重试', exact: true }).tap();
    await expect(row.getByRole('button', { name: '扫码登录', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(provider => (window as any).accountChecks.filter((id: string) => id === provider).length, provider)).toBe(2);
    expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
  });

  test(`${provider} keeps the resolved account visible while playlists load`, async ({ page }) => {
    await page.addInitScript(() => { (window as any).delayAccountPlaylists = true; });
    await page.goto('/mobile.html');
    if (provider === 'qq') await page.getByRole('button', { name: label, exact: true }).tap();
    const row = page.locator('.account-row');
    await expect(row).toContainText(nickname);
    await expect.poll(() => page.evaluate(() => typeof (window as any).releaseAccountPlaylists)).toBe('function');
    await expect(row.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
    await expect(row.getByRole('button', { name: '扫码登录', exact: true })).toHaveCount(0);
  });
}

test('an unconfigured connection has a disabled login action, not an endless account check', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  const row = page.locator('.account-row');
  await expect(row.getByRole('button', { name: '扫码登录', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).accountChecks)).toEqual([]);
});
