import { test, expect, openPlayerTools } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// launch-playback.spec.ts — online queue UI; the fixture never claims native cold-start acceptance.
test('launch preference defaults off, survives rotation and rolls back failed native saves without playing', async ({ page }) => {
  await searchPlaybackFixture(page);
  await page.addInitScript(() => localStorage.setItem('folia_auto_play_on_launch', 'true'));
  await page.goto('/mobile.html'); await seedSearchQueue(page);
  await page.locator('.mini-title').tap();
  await openPlayerTools(page);
  const toggle = page.getByRole('checkbox', { name: '进入应用后自动播放', exact: true });
  await expect(toggle).not.toBeChecked(); await toggle.check();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.autoPlayOnLaunch)).toBe(true);
  const initial = page.viewportSize()!;
  await page.setViewportSize({ width: initial.height, height: initial.width });
  await toggle.scrollIntoViewIfNeeded(); await expect(toggle).toBeChecked();
  await page.evaluate(() => { (window as any).fixtureAudioFailure = true; });
  await toggle.click(); await expect(toggle).toBeChecked();
  await expect(page.locator('.audio-controls [role="alert"]')).toHaveText('声音设置未能应用，已保留上次确认的设置。');
  await page.setViewportSize(initial); await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('launch-preference.png') });
});
