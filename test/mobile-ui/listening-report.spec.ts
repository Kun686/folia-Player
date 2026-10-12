import { test, expect, openPlayerTools } from './fixtures';

// listening-report.spec.ts — original opt-in UI with controlled native state; no provider writes.
test('listening reports remain opt-in, restore native settings, and allow disabling after account loss', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    (window as any).fixtureAudio.neteaseScrobbleEnabled = false;
    (window as any).fixturePlayback.listening = { ready: true, error: null };
    localStorage.setItem('folia_netease_scrobble', 'true');
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await openPlayerTools(page);
  await page.getByText('听歌打卡', { exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: '上报播放记录(仅网易云)' });
  await expect(toggle).not.toBeChecked(); await expect(toggle).toBeEnabled();
  await expect(page.locator('.listening-toggle')).toHaveCSS('flex-direction', 'row');
  expect((await page.locator('.listening-toggle').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.check();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.neteaseScrobbleEnabled)).toBe(true);
  await page.evaluate(() => { (window as any).fixtureEmitPlayback({ listening: { ready: false, error: 'auth-required' } }); });
  await expect(page.getByText('需要先登录网易云音乐账号。')).toBeVisible();
  await toggle.uncheck(); await expect(toggle).toBeDisabled();
  await page.evaluate(() => { (window as any).fixtureEmitPlayback({ listening: { ready: true, error: null } }); (window as any).fixtureAudioFailure = true; });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.audio-controls [role="alert"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('listening-report.png') });
});

test('an older native snapshot cannot silently enable account writes', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await openPlayerTools(page);
  await page.getByText('听歌打卡', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '上报播放记录(仅网易云)' })).toBeDisabled();
  await expect(page.getByText('当前连接暂不支持听歌打卡，请检查连接和音乐服务器版本。')).toBeVisible();
});
