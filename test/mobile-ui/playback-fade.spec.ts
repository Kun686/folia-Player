import { test, expect, openPlayerTools } from './fixtures';

// playback-fade.spec.ts — original setting, controlled bridge persistence and failure rollback.
test('pause fade restores native state and rolls failed edits back without changing the player layout', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    (window as any).fixtureAudio.playbackFadeEnabled = false;
    localStorage.setItem('folia_playback_fade_enabled', 'true');
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await openPlayerTools(page);
  const toggle = page.getByRole('checkbox', { name: '暂停/播放淡入淡出' });
  await expect(toggle).not.toBeChecked(); await toggle.check();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.playbackFadeEnabled)).toBe(true);
  await page.evaluate(() => { (window as any).fixtureAudioFailure = true; });
  await toggle.click(); await expect(toggle).toBeChecked();
  await expect(page.locator('.audio-controls [role="alert"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('playback-fade.png') });
});
