import { test, expect, openPlayerTools } from './fixtures';

// audio-route.spec.ts — route UI delegates once, recovers from failure, and never changes the playback queue.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await openPlayerTools(page);
});
test('system picker stays pending until dismissal without changing playback', async ({ page }, info) => {
  const control = page.getByRole('button', { name: '播放设备', exact: true });
  await control.scrollIntoViewIfNeeded();
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const before = await page.evaluate(() => ({ queue: (window as any).fixturePlayback.queue, commands: (window as any).fixtureCommands }));
  await control.tap(); await expect(control).toBeDisabled();
  const options = await page.evaluate(() => (window as any).fixtureRouteRequests);
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({ labels: { title: '播放设备', close: '关闭', fallback: '系统默认' } });
  expect(typeof options[0].light).toBe('boolean');
  await page.setViewportSize(info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => (window as any).fixtureFinishAudioRoute()); await expect(control).toBeEnabled();
  expect(await page.evaluate(() => ({ queue: (window as any).fixturePlayback.queue, commands: (window as any).fixtureCommands }))).toEqual(before);
  await control.tap(); await expect(control).toBeDisabled();
  expect(await page.evaluate(() => (window as any).fixtureRouteRequests.length)).toBe(2);
  await page.evaluate(() => (window as any).fixtureFinishAudioRoute()); await expect(control).toBeEnabled();
  await control.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('audio-route.png') });
});
test('a failed system presentation can be retried and does not claim a device change', async ({ page }) => {
  const control = page.getByRole('button', { name: '播放设备', exact: true });
  await page.evaluate(() => { (window as any).fixtureRouteFailure = true; });
  await control.tap();
  await expect(page.locator('.audio-route-control [role=alert]')).toContainText('无法打开播放设备选择器');
  await expect(control).toBeEnabled();
  await page.evaluate(() => { (window as any).fixtureRouteFailure = false; });
  await control.tap(); await expect(control).toBeDisabled();
  await expect(page.locator('.audio-route-control [role=alert]')).toHaveCount(0);
  await page.evaluate(() => (window as any).fixtureFinishAudioRoute()); await expect(control).toBeEnabled();
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
});
