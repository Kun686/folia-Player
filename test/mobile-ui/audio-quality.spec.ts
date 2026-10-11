import { test, expect, openPlayerTools } from './fixtures';

// audio-quality.spec.ts — touch UI and native-settings acknowledgement; no real-provider quality claim.
test('original quality options restore native preference, apply and roll back failed edits', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true;
    (window as any).fixtureAudio.audioQuality = 'lossless';
    localStorage.setItem('default_audio_quality', 'high');
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await openPlayerTools(page);
  const quality = page.locator('.quality-controls select');
  await expect(quality).toHaveValue('lossless');
  await expect(quality.locator('option')).toHaveText(['标准', '极高', '无损', 'Hi-Res']);
  expect((await quality.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await quality.selectOption('hires');
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAudio.audioQuality)).toBe('hires');
  await page.evaluate(() => { (window as any).fixtureAudioFailure = true; });
  await quality.selectOption('standard');
  await expect(page.locator('.audio-controls [role="alert"]')).toHaveText('声音设置未能应用，已保留上次确认的设置。');
  await expect(quality).toHaveValue('hires');
  await expect(page.locator('#mobile-quality-hint')).toContainText('已有音频缓存优先');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('audio-quality.png') });
});
