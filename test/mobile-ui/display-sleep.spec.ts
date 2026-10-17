import { test, expect } from './fixtures';
import { seed } from './playerQueueFixture';

// display-sleep.spec.ts — real touch/store persistence; native timer policy is tested separately in XCTest.
const label = '播放时保持亮屏';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
});
test('default-off preference persists, fits rotation and leaves playback unchanged', async ({ page }, info) => {
  await seed(page);
  const before = await page.evaluate(() => ({ playback: (window as any).fixturePlayback, commands: (window as any).fixtureCommands }));
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  const control = page.getByRole('switch', { name: label, exact: true });
  await expect(control).toBeEnabled(); await expect(control).not.toBeChecked();
  await control.tap(); await expect(control).toBeChecked();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-display-sleep') || '{}').enabled)).toBe(true);
  await page.setViewportSize(info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 });
  const area = page.locator('.display-sleep-preference'); await area.scrollIntoViewIfNeeded();
  expect((await area.locator('label').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.getByRole('dialog', { name: '设置', exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('display-sleep.png') });
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).tap();
  expect(await page.evaluate(() => ({ playback: (window as any).fixturePlayback, commands: (window as any).fixtureCommands }))).toEqual(before);
  await page.reload(); await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  await expect(control).toBeChecked(); await control.tap(); await expect(control).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-display-sleep') || '{}').enabled)).toBe(false);
});
test('failed save restores the accepted value and can be retried', async ({ page }) => {
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  const control = page.getByRole('switch', { name: label, exact: true });
  await expect(control).toBeEnabled();
  await page.evaluate(() => { (window as any).fixtureDisplaySleepSaveFailure = true; });
  await control.tap(); await expect(control).not.toBeChecked();
  await expect(page.locator('.display-sleep-preference [role=alert]')).toBeVisible();
  await page.evaluate(() => { (window as any).fixtureDisplaySleepSaveFailure = false; });
  await control.tap(); await expect(control).toBeChecked();
  await expect(page.locator('.display-sleep-preference [role=alert]')).toHaveCount(0);
});
test('failed native read disables edits until retry succeeds', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureDisplaySleepLoadFailure = true; });
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  const control = page.getByRole('switch', { name: label, exact: true });
  await expect(control).toBeDisabled();
  await expect(page.locator('.display-sleep-preference [role=alert]')).toBeVisible();
  await page.evaluate(() => { (window as any).fixtureDisplaySleepLoadFailure = false; });
  await page.locator('.display-sleep-preference').getByRole('button', { name: '重试', exact: true }).tap();
  await expect(control).toBeEnabled(); await expect(control).not.toBeChecked();
});
